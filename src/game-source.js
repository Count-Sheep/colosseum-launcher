'use strict';

// A game source other than this launcher release's: another port fork or commit, another decomp fork or commit,
// or both. Branches and tags are resolved to commits when chosen (and again by Update game), so each build knows
// exactly what it is made from. The renderer follows the port: it names the commit it builds with.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const release = require('./game-release.json');
const { retrying, GIT_PERMANENT } = require('./retry');

const SHA = /^[a-f0-9]{40}$/;
const REF = /^[A-Za-z0-9_][A-Za-z0-9._/-]{0,199}$/;
const REPOSITORY = /^(?:https:\/\/|ssh:\/\/|file:\/\/|git@[A-Za-z0-9.-]+:)[^\s]{1,400}$/;
// A row with only a branch, tag or commit means it is on this release's repository (the fields' placeholders).
const DEFAULT_REPOSITORY = { game: release.repository, decomp: release.decompRepository };

function normalizePart(part, what) {
  if (!part) return null;
  const repository = String(part.repository || '').trim();
  const ref = String(part.ref || '').trim();
  if (!repository && !ref) return null;
  if (!repository) return normalizePart({ repository: DEFAULT_REPOSITORY[what], ref }, what);
  if (!REPOSITORY.test(repository) && !(path.isAbsolute(repository) && !repository.startsWith('-')))
    throw new Error(`Enter the ${what} repository as an https:// or git@ address, or a local folder.`);
  if (!REF.test(ref) || ref.includes('..') || ref.endsWith('/') || ref.endsWith('.lock'))
    throw new Error(`Enter a branch, tag or commit for the ${what}.`);
  return { repository, ref };
}

// Settings input -> { port, decomp } (each null for this release's), or null for no override.
function normalizeOverride(input) {
  if (!input) return null;
  const port = normalizePart(input.port, 'game');
  const decomp = normalizePart(input.decomp, 'decomp');
  return port || decomp ? { port, decomp } : null;
}

// `git ls-remote` output -> the commit a branch, tag or full ref names.
function pickRef(output, ref) {
  const refs = new Map(String(output).split('\n').map(line => line.trim().split(/\s+/)).filter(parts => SHA.test(parts[0]))
    .map(([sha, name]) => [name, sha]));
  for (const name of [`refs/heads/${ref}`, `refs/tags/${ref}^{}`, `refs/tags/${ref}`, ref])
    if (refs.has(name)) return { commit: refs.get(name), branch: name === `refs/heads/${ref}` ? ref : null };
  return null;
}

async function resolveRef({ repository, ref }, { remote }) {
  if (SHA.test(ref)) return { commit: ref, branch: null };
  const found = pickRef(await remote(['ls-remote', repository, ref]), ref);
  if (!found) throw new Error(`Could not find "${ref}" in ${repository}.`);
  return found;
}

async function inTemporaryRepository({ git, capture, env }, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `colo-source-${crypto.randomBytes(3).toString('hex')}-`));
  try {
    await capture(git, ['init', '-q', directory], undefined, env);
    return await callback(directory);
  } finally {
    // Best effort, and not rmSync: on Windows it cannot remove the read-only
    // object files Git writes, and a leftover temporary folder is harmless.
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
}

// A value the port's CI script pins: NAME=value at the start of a line.
function pinned(script, name) {
  const value = script.match(new RegExp(`^${name}=(\\S+)`, 'm'))?.[1];
  if (!SHA.test(value || '')) throw new Error(`That game commit's tools/ci/linux-build.sh does not pin ${name}.`);
  return value;
}

// The decomp and renderer commits a port commit builds with.
function pinsAt(repository, commit, tools) {
  return inTemporaryRepository(tools, async directory => {
    await tools.remote(['fetch', '-q', '--depth', '1', repository, commit], directory);
    const script = await tools.capture(tools.git, ['show', `${commit}:tools/ci/linux-build.sh`], directory, tools.env);
    return { decomp: pinned(script, 'DECOMP_REF'), renderer: pinned(script, 'SMS_PORT_REF') };
  });
}

// The headers commit a renderer commit pins, from that one commit's trees.
function rendererHeaders(repository, commit, tools) {
  return inTemporaryRepository(tools, async directory => {
    await tools.remote(['fetch', '-q', '--depth', '1', '--filter=blob:none', repository, commit], directory);
    const entry = await tools.capture(tools.git, ['ls-tree', commit, 'decomp'], directory, tools.env);
    const sha = entry.match(/^160000 commit ([a-f0-9]{40})\t/)?.[1];
    if (!sha) throw new Error('That renderer commit has no decomp submodule.');
    return sha;
  });
}

// An override -> a source with this release's fields (see game-version.js).
async function resolve(override, { git = 'git', capture, env, wait }) {
  if (!override) return release;
  // A private or mistyped repository must fail, not wait for a password nobody can type.
  const tools = { git, capture, env: { ...(env || process.env), GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } };
  // Asking the repository, tried again when the connection drops, not when it isn't there.
  tools.remote = (args, cwd) => retrying(() => capture(git, args, cwd, tools.env),
    { wait, permanent: error => GIT_PERMANENT.test(error.message) });
  const port = override.port ? { repository: override.port.repository, ...await resolveRef(override.port, tools) }
    : { repository: release.repository, branch: release.branch, commit: release.commit };
  const pins = override.port ? await pinsAt(port.repository, port.commit, tools) : { decomp: release.decomp, renderer: release.renderer.commit };
  const decomp = override.decomp ? (await resolveRef(override.decomp, tools)).commit : pins.decomp;
  const renderer = pins.renderer === release.renderer.commit ? release.renderer
    : { ...release.renderer, commit: pins.renderer, decomp: await rendererHeaders(release.renderer.repository, pins.renderer, tools) };
  return { custom: true, version: label(port.commit, override.decomp ? decomp : null), repository: port.repository, branch: port.branch,
    commit: port.commit, portPatch: release.portPatch, decompRepository: override.decomp?.repository || release.decompRepository, decomp, renderer, override };
}

function label(commit, decomp) {
  return `custom ${commit.slice(0, 7)}${decomp ? ` + decomp ${decomp.slice(0, 7)}` : ''}`;
}

module.exports = { normalizeOverride, pickRef, resolve };
