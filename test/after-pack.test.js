'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const afterPack = require('../scripts/after-pack');

function packed(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // Stands in for Electron: prints the arguments and environment it was started with.
  fs.writeFileSync(path.join(dir, 'colosseum-launcher'), '#!/bin/sh\nprintf "%s\\n" "$@"\necho "env=$COLO_LAUNCHER_NO_SANDBOX"\n', { mode: 0o755 });
  return dir;
}

test('the Linux launcher always starts with --no-sandbox, keeping its own arguments', { skip: process.platform === 'win32' }, async t => {
  const dir = packed(t);
  await afterPack({ electronPlatformName: 'linux', appOutDir: dir, packager: { executableName: 'colosseum-launcher' } });
  assert.equal(fs.existsSync(path.join(dir, 'colosseum-launcher-bin')), true);
  assert.notEqual(fs.statSync(path.join(dir, 'colosseum-launcher')).mode & 0o111, 0);
  const output = execFileSync(path.join(dir, 'colosseum-launcher'), ['--play', 'two words'], { encoding: 'utf8' });
  assert.deepEqual(output.trim().split('\n'), ['--no-sandbox', '--play', 'two words', 'env=1']);
});

test('Windows and macOS builds are left as they are', async t => {
  const dir = packed(t);
  for (const electronPlatformName of ['win32', 'darwin'])
    await afterPack({ electronPlatformName, appOutDir: dir, packager: { executableName: 'colosseum-launcher' } });
  assert.deepEqual(fs.readdirSync(dir), ['colosseum-launcher']);
});
