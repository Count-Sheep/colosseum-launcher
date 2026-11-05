'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const tar = require('tar');
const cache = require('../src/compiler-cache');
const posixOnly = { skip: process.platform === 'win32' && 'Uses a shell script as the program.' };

function temporary(t, prefix = 'colo-compiler-cache-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A zip archive with one entry per file, stored or deflated (zip's own layout).
function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data, deflate } of files) {
    const packed = deflate ? zlib.deflateRawSync(data) : data;
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test('each system\'s ccache is pinned to an archive and the program in it', () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    const asset = cache.ASSETS[platform];
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    assert.match(asset.name, new RegExp(`^ccache-${cache.VERSION.replaceAll('.', '\\.')}-[a-z0-9_-]+\\.(tar\\.gz|zip)$`));
    assert.ok(asset.entry.startsWith(asset.name.replace(/\.(tar\.gz|zip)$/, '/')));
  }
  assert.match(cache.ASSETS.win32.entry, /\.exe$/);
});

test('one file comes out of a zip archive, stored or deflated', t => {
  const dir = temporary(t);
  const archive = path.join(dir, 'ccache.zip');
  const program = Buffer.from('MZ program '.repeat(100));
  fs.writeFileSync(archive, zip([{ name: 'ccache/NEWS.md', data: Buffer.from('news') },
    { name: 'ccache/ccache.exe', data: program, deflate: true }, { name: 'ccache/README.md', data: Buffer.from('readme') }]));
  assert.deepEqual(cache.unzipEntry(archive, 'ccache/ccache.exe'), program);
  assert.equal(cache.unzipEntry(archive, 'ccache/README.md').toString(), 'readme');
  assert.throws(() => cache.unzipEntry(archive, 'ccache/missing.exe'), /no ccache\/missing\.exe/);
  fs.writeFileSync(archive, 'not a zip');
  assert.throws(() => cache.unzipEntry(archive, 'ccache/ccache.exe'), /not a zip/);
});

test('setup downloads the program once, keeps only its version, and checks that it runs', posixOnly, async t => {
  const userData = temporary(t);
  const asset = cache.ASSETS.linux;
  const source = temporary(t, 'colo-compiler-cache-source-');
  const write = (body) => {
    const file = path.join(source, ...asset.entry.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, { mode: 0o755 });
    fs.writeFileSync(path.join(path.dirname(file), 'NEWS.md'), 'news');
  };
  let downloads = 0;
  const download = async (url, destination, sha256) => {
    downloads++;
    assert.equal(url, `https://github.com/ccache/ccache/releases/download/v${cache.VERSION}/${asset.name}`);
    assert.equal(sha256, asset.sha256);
    await tar.c({ gzip: true, file: destination, cwd: source }, [asset.entry.split('/')[0]]);
  };
  // as ccache does, it names itself after its file
  write(`#!/bin/sh\necho "$(basename "$0") version ${cache.VERSION}"\n`);
  const bin = path.join(cache.directory(userData), 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(path.join(bin, '4.0.0'));
  fs.writeFileSync(path.join(bin, '4.0.0', 'ccache'), 'an earlier launcher\'s');
  const messages = [];
  const program = await cache.prepare(userData, { platform: 'linux', download, log: message => messages.push(message) });
  assert.equal(program, cache.executable(userData, 'linux'));
  assert.deepEqual(fs.readdirSync(bin), [cache.VERSION]);
  assert.equal(path.basename(program), 'ccache');
  assert.equal(await cache.prepare(userData, { platform: 'linux', download }), program);
  assert.equal(downloads, 1);
  assert.equal(messages.length, 1);
  assert.equal(fs.readdirSync(cache.directory(userData)).filter(name => name.startsWith('.download-')).length, 0);

  fs.rmSync(program);
  write('#!/bin/sh\nexit 1\n');
  await assert.rejects(cache.prepare(userData, { platform: 'linux', download }), /does not run on this computer/);
  assert.equal(fs.existsSync(program), false);
  await assert.rejects(cache.prepare(userData, { platform: 'linux', download: async () => { throw new Error('HTTP 404'); } }),
    /download failed \(HTTP 404\)/);
  await assert.rejects(cache.prepare(userData, { platform: 'aix', download }), /none for this system/);
});

test('a build\'s cache settings: shared across game versions, without the player\'s own ccache settings', () => {
  const userData = path.resolve('/data/colosseum-launcher');
  const env = cache.environment({ PATH: 'path', CCACHE_DISABLE: '1', ccache_dir: '/elsewhere', KEPT: '64' },
    path.join(userData, 'compiler-cache', 'bin', 'ccache'), { userData, root: path.resolve('/games/game.releases/a2ff4ee-1234'), platform: 'linux' });
  assert.equal(env.PATH, 'path');
  assert.equal(env.KEPT, '64');
  assert.equal(env.CCACHE_DISABLE, undefined);
  assert.equal(env.ccache_dir, undefined);
  assert.equal(env.CMAKE_CXX_COMPILER_LAUNCHER, path.join(userData, 'compiler-cache', 'bin', 'ccache'));
  assert.equal(env.CMAKE_C_COMPILER_LAUNCHER, path.join(userData, 'compiler-cache', 'bin', 'ccache'));
  assert.equal(env.COLO_UNIT_CACHE, path.join(userData, 'compiler-cache', 'units'));
  assert.match(env.CCACHE_SLOPPINESS, /pch_defines/);
  assert.equal(env.CCACHE_DIR, path.join(userData, 'compiler-cache', 'files'));
  assert.equal(env.CCACHE_CONFIGPATH, path.join(userData, 'compiler-cache', 'ccache.conf'));
  // the game folder being built, not above it: the build tools' paths stay whole
  assert.equal(env.CCACHE_BASEDIR, path.resolve('/games/game.releases/a2ff4ee-1234'));
  assert.equal(env.CCACHE_NOHASHDIR, '1');
  assert.equal(env.CCACHE_MAXSIZE, cache.MAX_SIZE);
  assert.equal(env.CCACHE_COMPILERCHECK, undefined);
  assert.equal(cache.environment({}, '/x/ccache', { userData, root: '/games/game', platform: 'darwin' })
    .CCACHE_COMPILERCHECK, '%compiler% --version');
});

test('Windows builds get the cache\'s paths with forward slashes, as CMake writes them', { skip: process.platform !== 'win32' }, () => {
  const env = cache.environment({}, 'C:\\Users\\Player\\AppData\\Roaming\\colosseum-launcher\\compiler-cache\\bin\\4.14.2\\ccache.exe',
    { userData: 'C:\\Users\\Player\\AppData\\Roaming\\colosseum-launcher', root: 'C:\\Games\\game', platform: 'win32' });
  assert.equal(env.CMAKE_CXX_COMPILER_LAUNCHER, 'C:/Users/Player/AppData/Roaming/colosseum-launcher/compiler-cache/bin/4.14.2/ccache.exe');
  assert.equal(env.CCACHE_BASEDIR, 'C:/Games/game');
});

test('Free up space removes the compiled files and keeps the program', async t => {
  const userData = temporary(t);
  const files = path.join(cache.directory(userData), 'files', 'a');
  fs.mkdirSync(files, { recursive: true });
  fs.writeFileSync(path.join(files, 'object.R'), 'compiled');
  fs.mkdirSync(path.dirname(cache.executable(userData)), { recursive: true });
  fs.writeFileSync(cache.executable(userData), 'program');
  await cache.clear(userData);
  assert.equal(fs.existsSync(path.join(cache.directory(userData), 'files')), false);
  assert.ok(fs.existsSync(cache.executable(userData)));
  await cache.clear(temporary(t));
});

// The game's CMake sets the program as its compilers' launcher. A Linux player's
// tools build with GNU Make, which must quote a launcher whose path has spaces.
test('Free up space removes the units too', async t => {
  const userData = temporary(t);
  const units = cache.unitDirectory(userData, {});
  fs.mkdirSync(path.join(units, 'ab'), { recursive: true });
  fs.writeFileSync(path.join(units, 'ab', 'abcd.o'), 'object');
  await cache.clear(userData, {});
  assert.equal(fs.existsSync(units), false);
});

test('the units used longest ago go first, until the rest fit', async t => {
  const userData = temporary(t);
  const units = cache.unitDirectory(userData, {});
  fs.mkdirSync(path.join(units, 'ab'), { recursive: true });
  const file = (name, age) => {
    const item = path.join(units, 'ab', name);
    fs.writeFileSync(item, Buffer.alloc(100));
    const when = new Date(Date.now() - age * 1000);
    fs.utimesSync(item, when, when);
    return item;
  };
  const oldest = file('a.o', 300), older = file('b.o', 200), newest = file('c.o', 100);
  assert.deepEqual(await cache.trim(userData, { env: {}, maxBytes: 250 }), { removed: 1, bytes: 200 });
  assert.equal(fs.existsSync(oldest), false);
  assert.equal(fs.existsSync(older), true);
  assert.equal(fs.existsSync(newest), true);
  assert.deepEqual(await cache.trim(path.join(userData, 'nothing'), { env: {} }), { removed: 0, bytes: 0 });
});

test('CI keeps the caches in a folder of its own', () => {
  const env = { COLO_COMPILER_CACHE_DIR: path.resolve('/runner/Build Cache') };
  assert.equal(cache.directory('/data', env), path.resolve('/runner/Build Cache'));
  assert.equal(cache.environment(env, null, { userData: '/data', root: '/game', platform: 'linux' }).COLO_UNIT_CACHE,
    path.join(path.resolve('/runner/Build Cache'), 'units'));
});

test('without ccache the game\'s units are still cached, and a retry leaves both out', () => {
  const env = cache.environment({ PATH: 'path' }, null, { userData: path.resolve('/data'), root: '/game', platform: 'linux' });
  assert.equal(env.CMAKE_CXX_COMPILER_LAUNCHER, undefined);
  assert.ok(env.COLO_UNIT_CACHE);
  const full = cache.environment({ PATH: 'path' }, '/x/ccache', { userData: path.resolve('/data'), root: '/game', platform: 'linux' });
  assert.deepEqual(cache.withoutCaches(full), { PATH: 'path' });
});

test('GNU Make runs a compiler launcher from a folder whose path has spaces', { skip: process.platform !== 'linux' }, t => {
  const found = name => spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  if (!found('cmake') || !found('make') || !found('cc')) return t.skip('This integration check requires CMake, GNU Make and a C compiler.');
  const root = temporary(t, 'colo compiler cache with spaces-');
  const launcher = path.join(root, 'compiler cache', 'ccache');
  const record = path.join(root, 'launched');
  fs.mkdirSync(path.dirname(launcher));
  fs.writeFileSync(launcher, `#!/bin/sh\necho "$@" >> "${record}"\nexec "$@"\n`, { mode: 0o755 });
  const source = path.join(root, 'project');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'CMakeLists.txt'), `
    cmake_minimum_required(VERSION 3.20)
    project(launcher_probe C)
    set(CMAKE_C_COMPILER_LAUNCHER "$ENV{COLO_TEST_LAUNCHER}")
    add_library(probe STATIC probe.c)
  `);
  fs.writeFileSync(path.join(source, 'probe.c'), 'int probe(void) { return 1; }\n');
  const env = { ...process.env, COLO_TEST_LAUNCHER: launcher };
  const build = path.join(root, 'build');
  for (const args of [['-S', source, '-B', build, '-G', 'Unix Makefiles'], ['--build', build]]) {
    const result = spawnSync('cmake', args, { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  assert.match(fs.readFileSync(record, 'utf8'), /probe\.c/);
});
