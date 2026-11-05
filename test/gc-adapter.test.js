'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gcAdapter = require('../src/gc-adapter');

// A /sys and /dev with one USB device and its hidraw node, each device file
// readable by this user or not.
function linuxTree({ vendor = '057e', product = '0337', hidraw = true, usbAllowed = false, hidrawAllowed = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-adapter-'));
  const sys = path.join(root, 'sys'), dev = path.join(root, 'dev');
  const write = (file, text, mode) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); if (mode != null) fs.chmodSync(file, mode); };
  write(path.join(sys, 'bus/usb/devices/usb1/idVendor'), '1d6b\n'); // a root hub
  write(path.join(sys, 'bus/usb/devices/usb1/idProduct'), '0002\n');
  write(path.join(sys, 'bus/usb/devices/1-4/idVendor'), `${vendor}\n`);
  write(path.join(sys, 'bus/usb/devices/1-4/idProduct'), `${product}\n`);
  write(path.join(sys, 'bus/usb/devices/1-4/busnum'), '1\n');
  write(path.join(sys, 'bus/usb/devices/1-4/devnum'), '7\n');
  write(path.join(dev, 'bus/usb/001/007'), '', usbAllowed ? 0o600 : 0o000);
  write(path.join(sys, 'class/hidraw/hidraw0/device/uevent'), 'DRIVER=hid-generic\nHID_ID=0003:00001532:00000203\n');
  write(path.join(dev, 'hidraw0'), '', 0o000);
  if (hidraw) {
    write(path.join(sys, 'class/hidraw/hidraw3/device/uevent'), `DRIVER=hid-generic\nHID_ID=0003:0000${vendor.toUpperCase()}:0000${product.toUpperCase()}\nHID_NAME=Nintendo WUP-028\n`);
    write(path.join(dev, 'hidraw3'), '', hidrawAllowed ? 0o600 : 0o000);
  }
  return { sys, dev, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const asRoot = process.getuid?.() === 0; // root may open any file, so permissions can't be tested

test('Linux: no adapter plugged in', () => {
  const tree = linuxTree({ vendor: '045e', product: '028e' });
  try { assert.deepEqual(gcAdapter.linuxStatus(tree), { present: false }); }
  finally { tree.done(); }
});

test('Linux: an adapter nobody gave this user needs the udev rule', { skip: asRoot }, () => {
  const tree = linuxTree();
  try {
    const status = gcAdapter.linuxStatus(tree);
    assert.equal(status.present, true);
    assert.equal(status.readable, false);
    assert.equal(status.fix, 'udev');
    assert.equal(status.hidraw.file, path.join(tree.dev, 'hidraw3'));
    assert.equal(status.usb.file, path.join(tree.dev, 'bus/usb/001/007'));
  } finally { tree.done(); }
});

test('Linux: hidraw or the USB device (Steam\'s rule, through libusb) is enough', () => {
  for (const [options, via] of [[{ hidrawAllowed: true }, 'hidraw'], [{ usbAllowed: true }, 'libusb'], [{ usbAllowed: true, hidraw: false }, 'libusb']]) {
    const tree = linuxTree(options);
    try {
      const status = gcAdapter.linuxStatus(tree);
      assert.equal(status.readable, true);
      assert.equal(status.fix, null);
      if (!asRoot) assert.equal(status.via, via);
    } finally { tree.done(); }
  }
});

test('Windows: the stock HID driver and WinUSB both work; no driver needs fixing', () => {
  assert.deepEqual(gcAdapter.windowsStatus(''), { present: false });
  assert.deepEqual(gcAdapter.windowsStatus('HidUsb|OK\r\n'), { present: true, readable: true, driver: 'HID', status: 'OK', fix: null });
  assert.equal(gcAdapter.windowsStatus('WINUSB|OK\r\n').driver, 'WinUSB');
  assert.deepEqual(gcAdapter.windowsStatus('|Error\r\n'), { present: true, readable: false, driver: null, status: 'Error', fix: 'driver' });
});

test('Windows: the query looks the adapter up by its USB id', () => {
  assert.match(gcAdapter.WINDOWS_QUERY, /USB\\\\VID_057E&PID_0337%/);
});

test('Mac: found in ioreg, readable only with libusb installed', () => {
  const ioreg = [
    '+-o Root  <class IORegistryEntry>',
    '  +-o USB Receiver@01100000  <class IOUSBHostDevice>',
    '      "idProduct" = 50475', '      "idVendor" = 1133',
    '  +-o WUP-028@01200000  <class IOUSBHostDevice>',
    '      "idProduct" = 823', '      "idVendor" = 1406'
  ].join('\n');
  const none = { existsSync: () => false }, brew = { existsSync: file => file.startsWith('/opt/homebrew/') };
  assert.deepEqual(gcAdapter.macStatus(ioreg, { fsys: none }), { present: true, readable: false, fix: 'libusb' });
  assert.deepEqual(gcAdapter.macStatus(ioreg, { fsys: brew }), { present: true, readable: true, fix: null });
  // the vendor of one device and the product of another are not an adapter
  assert.deepEqual(gcAdapter.macStatus('+-o A\n "idVendor" = 1406\n "idProduct" = 1\n+-o B\n "idVendor" = 2\n "idProduct" = 823\n', { fsys: brew }), { present: false });
});

test('the udev rule opens hidraw and the USB device to the logged-in user', () => {
  assert.match(gcAdapter.RULES, /^SUBSYSTEM=="usb", ATTRS\{idVendor\}=="057e", ATTRS\{idProduct\}=="0337", TAG\+="uaccess"$/m);
  assert.match(gcAdapter.RULES, /^KERNEL=="hidraw\*", ATTRS\{idVendor\}=="057e", ATTRS\{idProduct\}=="0337", TAG\+="uaccess"$/m);
  // before 73-seat-late.rules, which applies uaccess
  assert.ok(path.basename(gcAdapter.RULES_FILE) < '73');
});

test('Allow access runs pkexec with the rule as an argument, not through the shell', () => {
  const { command, args } = gcAdapter.allowCommand();
  assert.equal(command, 'pkexec');
  assert.deepEqual(args.slice(0, 2), ['/bin/sh', '-c']);
  assert.deepEqual(args.slice(3), ['sh', gcAdapter.RULES, gcAdapter.RULES_FILE]);
  assert.doesNotMatch(args[2], /057e/);
  assert.ok(gcAdapter.terminalCommand().startsWith(`sudo tee ${gcAdapter.RULES_FILE}`));
  assert.ok(gcAdapter.terminalCommand().includes(gcAdapter.RULES));
});
