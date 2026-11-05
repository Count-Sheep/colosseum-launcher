'use strict';

// GameCube adapters in Wii U mode: Nintendo's official adapter (WUP-028) and
// the copies of it, such as Mayflash's with its switch on Wii U; all are USB
// 057e:0337. The game reads them itself (the port's host/gc_adapter.cpp),
// through Windows' own driver or WinUSB, hidraw or libusb on Linux, and libusb
// on a Mac. This finds a plugged-in adapter for Settings → Controls and says
// whether the game can open it. On Linux it can only with permission, as for
// Dolphin: udev keeps hidraw root-only, and Steam's rules open just the USB
// device, which the game reads through libusb. allowCommand() makes the udev
// rule that lets the logged-in user read both.
const fs = require('node:fs');
const path = require('node:path');

const VENDOR = 0x057e, PRODUCT = 0x0337;
const RULES_FILE = '/etc/udev/rules.d/51-gcadapter.rules';
const RULES = [
  '# GameCube adapters in Wii U mode (057e:0337), for Colosseum Launcher and Dolphin',
  `SUBSYSTEM=="usb", ATTRS{idVendor}=="057e", ATTRS{idProduct}=="0337", TAG+="uaccess"`,
  `KERNEL=="hidraw*", ATTRS{idVendor}=="057e", ATTRS{idProduct}=="0337", TAG+="uaccess"`,
  ''
].join('\n');

const read = (fsys, file) => { try { return fsys.readFileSync(file, 'utf8').trim(); } catch { return null; } };
const list = (fsys, dir) => { try { return fsys.readdirSync(dir); } catch { return []; } };
const hex = text => text == null ? NaN : parseInt(text, 16);
const usable = (fsys, file) => { try { fsys.accessSync(file, fs.constants.R_OK | fs.constants.W_OK); return true; } catch { return false; } };

// Linux, from sysfs. `hidraw` and `usb` are the adapter's device files the game
// could open, each with whether this user may read and write it.
function linuxStatus({ fsys = fs, sys = '/sys', dev = '/dev' } = {}) {
  let usb = null;
  for (const name of list(fsys, path.join(sys, 'bus/usb/devices'))) {
    const dir = path.join(sys, 'bus/usb/devices', name);
    if (hex(read(fsys, path.join(dir, 'idVendor'))) !== VENDOR || hex(read(fsys, path.join(dir, 'idProduct'))) !== PRODUCT) continue;
    const bus = Number(read(fsys, path.join(dir, 'busnum'))), device = Number(read(fsys, path.join(dir, 'devnum')));
    const file = path.join(dev, 'bus/usb', String(bus).padStart(3, '0'), String(device).padStart(3, '0'));
    usb = { file, allowed: usable(fsys, file) };
    break;
  }
  if (!usb) return { present: false };
  let hidraw = null;
  for (const name of list(fsys, path.join(sys, 'class/hidraw'))) {
    const id = /HID_ID=([0-9a-f]+):([0-9a-f]+):([0-9a-f]+)/i.exec(read(fsys, path.join(sys, 'class/hidraw', name, 'device/uevent')) || '');
    if (!id || hex(id[2]) !== VENDOR || hex(id[3]) !== PRODUCT) continue;
    const file = path.join(dev, name);
    hidraw = { file, allowed: usable(fsys, file) };
    break;
  }
  const readable = Boolean(hidraw?.allowed || usb.allowed);
  return {
    present: true, readable, hidraw, usb,
    via: hidraw?.allowed ? 'hidraw' : usb.allowed ? 'libusb' : null,
    fix: readable ? null : 'udev'
  };
}

// Windows: the driver Windows gave the adapter, from
// `Get-CimInstance Win32_PnPEntity` (windowsQuery): HidUsb is Windows' own
// ("USB Input Device"), WinUSB the one Zadig or Dolphin installs. Either works.
const WINDOWS_QUERY = "Get-CimInstance Win32_PnPEntity -Filter \"DeviceID LIKE 'USB\\\\VID_057E&PID_0337%'\" | " +
  "ForEach-Object { \"$($_.Service)|$($_.Status)\" }";

function windowsStatus(output) {
  const lines = String(output || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return { present: false };
  const [service = '', status = ''] = lines[0].split('|');
  const driver = /^winusb$/i.test(service) ? 'WinUSB' : /^hidusb$/i.test(service) ? 'HID' : null;
  return { present: true, readable: Boolean(driver), driver, status, fix: driver ? null : 'driver' };
}

// macOS: the adapter in `ioreg -p IOUSB -l -w0` output; the game reads it with
// libusb, which is there only if installed (Homebrew).
const MAC_LIBUSB = ['/opt/homebrew/lib/libusb-1.0.0.dylib', '/usr/local/lib/libusb-1.0.0.dylib'];

function macStatus(ioreg, { fsys = fs } = {}) {
  const text = String(ioreg || '');
  const present = text.split(/\+-o /).some(block =>
    new RegExp(`"idVendor" = ${VENDOR}\\b`).test(block) && new RegExp(`"idProduct" = ${PRODUCT}\\b`).test(block));
  if (!present) return { present: false };
  const libusb = MAC_LIBUSB.some(file => fsys.existsSync(file));
  return { present: true, readable: libusb, fix: libusb ? null : 'libusb' };
}

// The command that installs the udev rule as root through pkexec (which asks
// for the password) and applies it to the adapter already plugged in. The rule
// text goes in as an argument, not through the shell.
function allowCommand() {
  const script = 'printf "%s" "$1" > "$2" && udevadm control --reload-rules && ' +
    'udevadm trigger --action=change --subsystem-match=usb --subsystem-match=hidraw';
  return { command: 'pkexec', args: ['/bin/sh', '-c', script, 'sh', RULES, RULES_FILE] };
}

// The same, to paste into a terminal: for a system without pkexec, or a Steam
// Deck whose user has no password yet (pkexec can't ask for one then).
function terminalCommand() {
  return `sudo tee ${RULES_FILE} > /dev/null <<'EOF'\n${RULES}EOF\n` +
    'sudo udevadm control --reload-rules && sudo udevadm trigger --action=change --subsystem-match=usb --subsystem-match=hidraw';
}

module.exports = { VENDOR, PRODUCT, RULES, RULES_FILE, WINDOWS_QUERY, linuxStatus, windowsStatus, macStatus, allowCommand, terminalCommand };
