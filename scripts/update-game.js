'use strict';

// Maintainer command: select a complete port revision, then bump the launcher so its release gate verifies
// exactly the source players will receive. The port names the decomp and renderer commits it builds with in
// tools/ci/linux-build.sh, so they follow it here. scripts/port-launcher.patch must still apply to the new commit:
// the launcher's checkout fails if it does not, and Game build shows that before any release.
//   npm run update:game            the newest commit of the port's branch (game-release.json's)
//   npm run update:game -- <ref>   that commit, tag or branch
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const current = require('../src/game-release.json');
const ref = process.argv[2] || `origin/${current.branch}`;
const launcherRoot = path.join(__dirname, '..');
const previousLauncher = require('../package.json').version;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colo-game-release-'));
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

// Commit subjects are a draft: the maintainer rewrites them for players.
function subjects(args, cwd) {
  try {
    return execFileSync('git', ['log', '--no-merges', '--format=%s', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map(line => line.trim()).filter(Boolean);
  } catch (_) { return []; }
}

// The launcher release that ships a game pin lists the game's changes too.
function addChangelogEntry(version, game, previousCommit) {
  const file = path.join(launcherRoot, 'changelog.json');
  const changelog = JSON.parse(fs.readFileSync(file, 'utf8'));
  const launcher = subjects([`v${previousLauncher}..HEAD`], launcherRoot).filter(line => !/^(Select game|Bump launcher)/.test(line));
  const entry = { version, date: new Date().toISOString().slice(0, 10), launcher,
    game: { version: game.version, commit: game.commit, changes: subjects([`${previousCommit}..${game.commit}`], root) } };
  changelog.releases = [entry, ...changelog.releases.filter(release => release.version !== version)];
  fs.writeFileSync(file, `${JSON.stringify(changelog, null, 2)}\n`);
}

// A value the port's CI script pins: NAME=value at the start of a line.
function pinned(script, name) {
  const value = script.match(new RegExp(`^${name}=(\\S+)`, 'm'))?.[1];
  if (!value) throw new Error(`The port's tools/ci/linux-build.sh does not pin ${name}.`);
  return value;
}

function submoduleCommit(repository, commit) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'colo-renderer-'));
  const run = args => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
  try {
    run(['init', '-q']);
    run(['fetch', '-q', '--depth', '1', '--filter=blob:none', repository, commit]);
    const decomp = run(['ls-tree', commit, 'decomp']).match(/^160000 commit ([a-f0-9]{40})\tdecomp$/)?.[1];
    if (!decomp) throw new Error('The renderer revision does not pin its decomp submodule.');
    return { decomp, url: run(['show', `${commit}:.gitmodules`]).match(/path = decomp\s+url = (\S+)/)?.[1] };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

try {
  git(['clone', '--filter=blob:none', '--no-checkout', '--branch', current.branch, current.repository, '.']);
  const commit = git(['rev-parse', '--verify', `${ref}^{commit}`]);
  const script = git(['show', `${commit}:tools/ci/linux-build.sh`]);
  const decomp = pinned(script, 'DECOMP_REF');
  const renderer = pinned(script, 'SMS_PORT_REF');
  if (commit === current.commit && decomp === current.decomp && renderer === current.renderer.commit) {
    console.log('This game revision is already selected. No release bump needed.');
  } else {
    const headers = submoduleCommit(current.renderer.repository, renderer);
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '.');
    const number = current.version.startsWith(`${date}.`) ? Number(current.version.split('.').at(-1)) + 1 : 1;
    const next = { ...current, version: `${date}.${number}`, commit, decomp,
      renderer: { ...current.renderer, commit: renderer, decomp: headers.decomp, decompRepository: headers.url || current.renderer.decompRepository } };
    fs.writeFileSync(path.join(launcherRoot, 'src', 'game-release.json'), `${JSON.stringify(next, null, 2)}\n`);
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['version', 'patch', '--no-git-tag-version'],
      { cwd: launcherRoot, stdio: 'inherit', shell: process.platform === 'win32' });
    const version = JSON.parse(fs.readFileSync(path.join(launcherRoot, 'package.json'), 'utf8')).version;
    addChangelogEntry(version, next, current.commit);
    console.log(`Selected game ${next.version}: ${commit} (decomp ${decomp}, renderer ${renderer}).`);
    console.log(`Drafted changelog.json notes for v${version} from commit subjects. Edit them for players, then commit and push to main.`);
  }
} finally { fs.rmSync(root, { recursive: true, force: true }); }
