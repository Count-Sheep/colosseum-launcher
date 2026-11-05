'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const port = require('../src/port');
const portable = require('../src/portable');
const saves = require('../src/saves');

const exeDir = path.resolve('/usb/games');
const env = { PORTABLE_EXECUTABLE_DIR: exeDir, APPDATA: path.resolve('/appdata') };
const root = path.join(exeDir, 'Colosseum-Launcher-Portable');

test('only the Windows portable build gets a portable folder beside the exe', () => {
  assert.equal(portable.root(env, 'win32'), root);
  assert.equal(portable.root({}, 'win32'), null);
  assert.equal(portable.root(env, 'linux'), null);
});

test('portable saves and backups stay in the portable folder', () => {
  assert.equal(saves.saveDirectory(env, 'win32'), path.join(root, 'saves', 'colo-port', 'card-a'));
  // the game finds the card there through APPDATA, where it adds colo-port/card-a itself
  assert.equal(path.join(saves.gameDataEnvironment(env, 'win32').APPDATA, 'colo-port', 'card-a'), saves.saveDirectory(env, 'win32'));
  assert.deepEqual(saves.gameDataEnvironment({}, 'win32'), {});
  assert.equal(saves.backupRoot(env, 'win32'), path.join(root, 'Save Backups'));
  assert.notEqual(saves.backupRoot({}, 'win32'), path.join(root, 'Save Backups'));
});

test('paths inside the portable folder are saved relative and follow it when moved', () => {
  const outside = path.resolve('/discs/sms.iso');
  const config = { repo: path.join(root, 'game'), rom: outside, installRoot: null, saveDirectory: root,
    settings: { arch: '64' }, previousInstall: { repo: path.join(root, 'old'), rom: path.join(root, 'sms.iso') } };
  const stored = portable.storedPaths(config, root);
  assert.equal(stored.repo, 'game');
  assert.equal(stored.rom, outside);
  assert.equal(stored.installRoot, null);
  assert.equal(stored.saveDirectory, '.');
  assert.deepEqual(stored.settings, { arch: '64' });
  assert.deepEqual(stored.previousInstall, { repo: 'old', rom: 'sms.iso' });
  assert.equal(config.repo, path.join(root, 'game'));

  const moved = path.resolve('/other/Colosseum-Launcher-Portable');
  const loaded = portable.resolvedPaths(JSON.parse(JSON.stringify(stored)), moved);
  assert.equal(loaded.repo, path.join(moved, 'game'));
  assert.equal(loaded.rom, outside);
  assert.equal(loaded.saveDirectory, moved);
  assert.equal(loaded.previousInstall.rom, path.join(moved, 'sms.iso'));
});

test('a sibling folder with a similar name is not treated as inside', () => {
  const sibling = `${root}-old${path.sep}game`;
  assert.equal(portable.storedPaths({ repo: sibling }, root).repo, sibling);
  assert.equal(portable.storedPaths({ rom: '' }, root).rom, '');
  assert.deepEqual(portable.storedPaths({ repo: 'x' }, null), { repo: 'x' });
});

test('paths recorded inside the portable folder follow it to another drive or computer', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sms portable move-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const moved = path.join(home, 'Colosseum-Launcher-Portable');
  fs.mkdirSync(path.join(moved, 'build-tools', 'windows-x64'), { recursive: true });
  const target = path.join(moved, 'build-tools', 'windows-x64');
  assert.equal(portable.relocated('C:/Users/me/Desktop/Colosseum-Launcher-Portable/build-tools/windows-x64', moved), target);
  assert.equal(portable.relocated('D:\\colosseum-launcher-portable\\build-tools\\windows-x64', moved), target);
  // Left alone: paths that still exist, are outside any portable folder, or aren't in the moved one either.
  assert.equal(portable.relocated(target, moved), target);
  assert.equal(portable.relocated('C:/msys64', moved), 'C:/msys64');
  assert.equal(portable.relocated('C:/Old/Colosseum-Launcher-Portable/gone', moved), 'C:/Old/Colosseum-Launcher-Portable/gone');
  assert.equal(portable.relocated('C:/Old/Colosseum-Launcher-Portable/build-tools/windows-x64', null),
    'C:/Old/Colosseum-Launcher-Portable/build-tools/windows-x64');
});

test("the launcher's scripts outlive the temporary folder a second start of the .exe deletes", t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sms portable scripts-'));
  t.after(() => { port.useLauncherScripts(null); fs.rmSync(home, { recursive: true, force: true }); });
  const resources = path.join(home, 'Temp', '3LF9DEMpouSi8ltUsux9N94UxIw', 'resources', 'scripts');
  const base = path.join(home, 'Colosseum-Launcher-Portable');
  fs.mkdirSync(resources, { recursive: true });
  for (const name of ['install-textures.py', 'build-colosseum.sh'])
    fs.writeFileSync(path.join(resources, name), `# ${name}\n`);
  const copy = portable.copyScripts(resources, base);
  assert.equal(copy, path.join(base, 'launcher-scripts'));
  fs.rmSync(path.join(home, 'Temp'), { recursive: true });   // the second start's stub, on its way out
  port.useLauncherScripts(copy);
  const repo = path.join(base, 'game');
  const installer = port.textureCommand(repo, 'linux', {}).args[0];
  assert.equal(installer, path.join(copy, 'install-textures.py'));
  assert.equal(fs.readFileSync(installer, 'utf8'), '# install-textures.py\n');
  assert.equal(port.buildCommand(repo, 'linux', {}).args[0], path.join(copy, 'build-colosseum.sh'));
  // The next start finds its resources gone too early: the copy from before still serves.
  assert.equal(portable.copyScripts(resources, base), copy);
  // Without a copy, the scripts come from the launcher's own folder as before.
  port.useLauncherScripts(null);
  assert.equal(port.textureCommand(repo, 'linux', {}).args[0], path.resolve(__dirname, '..', 'scripts', 'install-textures.py'));
});

test('a disc left on the old computer is found in the portable folder or beside the exe', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sms portable disc-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const base = path.join(home, 'Colosseum-Launcher-Portable');
  fs.mkdirSync(base);
  const validate = file => {
    if (fs.readFileSync(file, 'utf8') !== 'GC6E01') throw new Error('not the game');
    return file;
  };
  assert.equal(portable.findDisc(base, validate), null);
  fs.writeFileSync(path.join(home, 'notes.txt'), 'GC6E01');
  fs.writeFileSync(path.join(home, 'other.iso'), 'another game');
  assert.equal(portable.findDisc(base, validate), null);
  fs.writeFileSync(path.join(home, 'Colosseum.ISO'), 'GC6E01');
  assert.equal(portable.findDisc(base, validate), path.join(home, 'Colosseum.ISO'));
  fs.writeFileSync(path.join(base, 'game.gcm'), 'GC6E01');
  assert.equal(portable.findDisc(base, validate), path.join(base, 'game.gcm'));
});

test('a portable launcher says when a newer Stable release is out', () => {
  const newer = portable.updateNotice('0.1.64', 'v0.1.65');
  assert.equal(newer.state, 'available');
  assert.equal(newer.latest, '0.1.65');
  assert.match(newer.message, /Launcher 0\.1\.65 is out\. Portable launchers don't update themselves/);
  assert.equal(portable.updateNotice('0.1.64', 'v0.1.64').state, 'unconfigured');
  assert.equal(portable.updateNotice('0.1.65-beta.12', 'v0.1.64').state, 'unconfigured');
  assert.equal(portable.updateNotice('0.1.63', 'v0.1.64').state, 'available');
  assert.equal(portable.updateNotice('0.1.64', null).state, 'unconfigured');
  assert.equal(portable.updateNotice('0.1.64', 'beta').state, 'unconfigured');
  assert.match(portable.updateNotice('0.1.64', undefined).message, /download new versions from the releases page/);
});
