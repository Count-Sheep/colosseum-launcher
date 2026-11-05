'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const source = require('../src/game-source');
const release = require('../src/game-release.json');

const capture = async (command, args, cwd, env) => execFileSync(command, args, { cwd, env, encoding: 'utf8' }).trim();
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8',
  env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();

test('an empty override is this release; bad repositories and refs are refused', () => {
  assert.equal(source.normalizeOverride(null), null);
  assert.equal(source.normalizeOverride({ port: { repository: '', ref: '' }, decomp: {} }), null);
  assert.deepEqual(source.normalizeOverride({ decomp: { repository: ' https://github.com/me/pkmn-colosseum.git ', ref: 'fix/thing' } }),
    { port: null, decomp: { repository: 'https://github.com/me/pkmn-colosseum.git', ref: 'fix/thing' } });
  assert.deepEqual(source.normalizeOverride({ port: { repository: ' ', ref: 'fix/thing' }, decomp: { ref: 'abc123' } }),
    { port: { repository: release.repository, ref: 'fix/thing' },
      decomp: { repository: release.decompRepository, ref: 'abc123' } });
  assert.throws(() => source.normalizeOverride({ port: { repository: '', ref: '-x' } }), /branch/);
  assert.throws(() => source.normalizeOverride({ port: { repository: '--upload-pack=x', ref: 'main' } }), /repository/);
  assert.throws(() => source.normalizeOverride({ port: { repository: 'https://github.com/me/x', ref: '-x' } }), /branch/);
  assert.throws(() => source.normalizeOverride({ port: { repository: 'https://github.com/me/x', ref: 'a..b' } }), /branch/);
  assert.throws(() => source.normalizeOverride({ port: { repository: 'https://github.com/me/x', ref: '' } }), /branch/);
});

test('picks a branch, then a peeled tag, from ls-remote', () => {
  const a = 'a'.repeat(40), b = 'b'.repeat(40), c = 'c'.repeat(40);
  const out = `${a}\trefs/heads/main\n${b}\trefs/tags/v1\n${c}\trefs/tags/v1^{}\n`;
  assert.deepEqual(source.pickRef(out, 'main'), { commit: a, branch: 'main' });
  assert.deepEqual(source.pickRef(out, 'v1'), { commit: c, branch: null });
  assert.equal(source.pickRef(out, 'missing'), null);
});

test('resolves a fork branch and reads the decomp and renderer commits it names', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'colo-game-source-'));
  try {
    const commit = (cwd, branch, file, text) => {
      fs.mkdirSync(cwd, { recursive: true });
      if (!fs.existsSync(path.join(cwd, '.git'))) git(cwd, ['init', '-q', '-b', branch]);
      git(cwd, ['config', 'uploadpack.allowAnySHA1InWant', 'true']);
      fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
      fs.writeFileSync(path.join(cwd, file), text);
      git(cwd, ['add', '-A']); git(cwd, ['commit', '-qm', 'commit']);
      return git(cwd, ['rev-parse', 'HEAD']);
    };
    const decomp = path.join(dir, 'decomp'), port = path.join(dir, 'port');
    const pin = commit(decomp, 'main', 'a', '1');
    const head = commit(port, 'feature', 'tools/ci/linux-build.sh', `DECOMP_REF=${pin}\nSMS_PORT_REF=${release.renderer.commit}\n`);

    const resolved = await source.resolve({ port: { repository: port, ref: 'feature' }, decomp: null }, { capture, env: process.env });
    assert.deepEqual([resolved.commit, resolved.branch, resolved.decomp, resolved.decompRepository], [head, 'feature', pin, release.decompRepository]);
    assert.equal(resolved.version, `custom ${head.slice(0, 7)}`);
    assert.deepEqual(resolved.renderer, release.renderer, 'the same renderer commit needs no lookup');
    assert.equal(resolved.portPatch, release.portPatch);

    const other = await source.resolve({ port: null, decomp: { repository: decomp, ref: 'main' } }, { capture, env: process.env });
    assert.deepEqual([other.commit, other.decomp, other.decompRepository], [release.commit, pin, decomp]);
    assert.match(other.version, /\+ decomp /);
    await assert.rejects(source.resolve({ port: { repository: port, ref: 'nope' } }, { capture, env: process.env }), /Could not find/);
    assert.equal(await source.resolve(null, { capture }), release);

    // A commit that doesn't name what it builds with says so.
    commit(port, 'feature', 'tools/ci/linux-build.sh', 'nothing here\n');
    await assert.rejects(source.resolve({ port: { repository: port, ref: 'feature' } }, { capture, env: process.env }), /does not pin DECOMP_REF/);
    commit(port, 'feature', 'tools/ci/linux-build.sh', `DECOMP_REF=${pin}\nSMS_PORT_REF=${release.renderer.commit}\n`);

    // A connection GitHub drops is asked again; a repository that isn't there is not.
    let drops = 1;
    const flaky = async (command, args, cwd, env) => {
      if (['ls-remote', 'fetch'].includes(args[0]) && drops-- > 0) throw new Error('fatal: early EOF');
      return capture(command, args, cwd, env);
    };
    const waits = [];
    const again = await source.resolve({ port: { repository: port, ref: 'feature' }, decomp: null },
      { capture: flaky, env: process.env, wait: async ms => waits.push(ms) });
    assert.equal(again.decomp, pin);
    assert.equal(waits.length, 1);
    let asked = 0;
    await assert.rejects(source.resolve({ port: { repository: path.join(dir, 'gone'), ref: 'main' } }, {
      capture: async () => { asked++; throw new Error('remote: Repository not found.'); }, env: process.env, wait: async () => {} }),
    /Repository not found/);
    assert.equal(asked, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
