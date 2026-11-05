'use strict';

// electron-builder's afterPack (package.json build.afterPack). On Linux the
// AppImage starts the launcher through a small script that always passes
// --no-sandbox. electron-builder's AppRun adds it only when user namespaces
// look unavailable, but in the Steam Deck's Game Mode they look available and
// the sandbox still fails, so a Steam shortcut added by hand without
// --no-sandbox never opened the launcher there. The script also sets
// COLO_LAUNCHER_NO_SANDBOX, so the launcher knows it no longer needs that option.
const fs = require('node:fs');
const path = require('node:path');

function wrapperScript(binary) {
  return [
    '#!/bin/sh',
    '# Starts the launcher without the Chromium sandbox: see scripts/after-pack.js.',
    'export COLO_LAUNCHER_NO_SANDBOX=1',
    `exec "$(dirname "$0")/${binary}" --no-sandbox "$@"`,
    ''
  ].join('\n');
}

// Moves the Electron binary aside to <name>-bin and puts the script in its place.
function wrapLinuxExecutable(appOutDir, executableName) {
  const exe = path.join(appOutDir, executableName), binary = `${executableName}-bin`;
  fs.renameSync(exe, path.join(appOutDir, binary));
  fs.writeFileSync(exe, wrapperScript(binary), { mode: 0o755 });
  return path.join(appOutDir, binary);
}

async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;
  wrapLinuxExecutable(context.appOutDir, context.packager.executableName);
}

module.exports = afterPack;
module.exports.default = afterPack;
module.exports.wrapperScript = wrapperScript;
module.exports.wrapLinuxExecutable = wrapLinuxExecutable;
