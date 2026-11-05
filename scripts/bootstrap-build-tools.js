'use strict';

// Upstream package managers run only in the tool-asset publishing workflow.
const fs = require('node:fs');
const path = require('node:path');
const { toolsetFor, rootFor, status, hashFile, fetchVerified } = require('../src/build-tools');

const MAMBA = {
  url: 'https://github.com/mamba-org/micromamba-releases/releases/download/2.8.1-0/micromamba-linux-64',
  sha256: '9689782d863c05a1bf5d2d371ba527104e7a4eb4310c1637d8653b751aed9c82'
};
const MAC_MAMBA = {
  x64: { url: 'https://github.com/mamba-org/micromamba-releases/releases/download/2.8.1-0/micromamba-osx-64',
    sha256: 'b2bd613791c0a524883d7cb66505d630bf15badd1f492bc93ba78550a3a1a94b' },
  arm64: { url: 'https://github.com/mamba-org/micromamba-releases/releases/download/2.8.1-0/micromamba-osx-arm64',
    sha256: 'de71a646b73af92dd663e6ddc78993a6a4d47ea28b5d8908c3cc2b9c3077e528' }
};
const MAC_PACKAGES = ['python=3.12', 'git=2.55', 'cmake=4.4.3', 'ninja', 'make', 'patch', 'rsync',
  'llvm-tools-21=21.1.8', 'lld=21.1.8', 'bash', 'coreutils', 'grep', 'sed', 'gawk', 'findutils', 'curl'];
// zig's clang compiles the game code on Linux and macOS, at the release the port builds with
// on each system (its tools/env.sh and tools/ci/linux-build.sh; tools/befix.py reads the IR it writes).
const ZIG = {
  linux: { url: 'https://ziglang.org/download/0.17.0/zig-x86_64-linux-0.17.0.tar.xz',
    sha256: '1cbe9df9f27e6b78d14ccbca43b6703a404ef79ef1c463de901d7f088d4e2026' },
  'darwin-x64': { url: 'https://ziglang.org/download/0.14.1/zig-x86_64-macos-0.14.1.tar.xz',
    sha256: 'b0f8bdfb9035783db58dd6c19d7dea89892acc3814421853e5752fe4573e5f43' },
  'darwin-arm64': { url: 'https://ziglang.org/download/0.14.1/zig-aarch64-macos-0.14.1.tar.xz',
    sha256: '39f3dc5e79c22088ce878edc821dedb4ca5a1cd9f5ef915e9b3cc3053e8faefa' }
};
// On Windows it is llvm-mingw's clang 19, the same release as tools/env.sh: zig.exe needs Windows 8 or later.
const LLVM_MINGW = { url: 'https://github.com/mstorsjo/llvm-mingw/releases/download/20250114/llvm-mingw-20250114-msvcrt-x86_64.zip',
  sha256: 'f63f9657ec5642f456e1788d9083b530d0424dcad7a9a96d92208f2eb98cbf33', llvm: '19.1.7' };
const MSYS2 = {
  url: 'https://github.com/msys2/msys2-installer/releases/download/2026-09-27/msys2-base-x86_64-20260927.sfx.exe',
  sha256: 'ad336cccfda47758b5e15cda993fbba421115cb0b126697daef1ee4dfe37209f'
};
const LINUX_PACKAGES = [
  'python=3.12', 'git=2.55', 'cmake=4.4.3', 'ninja', 'make', 'patch', 'rsync', 'binutils',
  'gcc_linux-64=16.2', 'gxx_linux-64=16.2', 'sysroot_linux-64=2.17', 'sdl2=2.32.56',
  'libegl-devel', 'libgl-devel', 'bash', 'coreutils',
  'grep', 'sed', 'gawk', 'findutils', 'curl', 'file'
];
const WINDOWS_PACKAGES = [
  'mingw-w64-x86_64-gcc', 'mingw-w64-x86_64-cmake', 'mingw-w64-x86_64-SDL2',
  'mingw-w64-x86_64-ninja', 'mingw-w64-x86_64-python', 'patch', 'git', 'rsync'
];

// A compiler's release, unpacked into `folder` (its one top folder's contents).
async function installCompiler(root, folder, source, run, progress, tar) {
  const archive = path.join(root, path.basename(source.url));
  await ensureArchive(archive, source, progress);
  const staging = `${folder}.unpack`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  await run(tar, ['-xf', archive, '-C', staging], {}, 'Unpack compiler');
  const [top] = fs.readdirSync(staging);
  fs.renameSync(path.join(staging, top), folder);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(archive, { force: true });
}

async function ensureArchive(archive, source, progress) {
  if (fs.existsSync(archive) && await hashFile(archive) === source.sha256) return;
  fs.rmSync(archive, { force: true });
  await fetchVerified(source.url, archive, source.sha256, progress);
}

async function prepareFromUpstream(userData, { platform = process.platform, run, progress = () => {}, forcePrivate = false } = {}) {
  if (!['linux', 'win32', 'darwin'].includes(platform)) throw new Error('This operating system is not supported.');
  if (platform === 'darwin' ? !['x64', 'arm64'].includes(process.arch) : process.arch !== 'x64')
    throw new Error('Setup tools require a supported 64-bit computer.');
  if (!forcePrivate && status(userData, platform).ready) return status(userData, platform);
  const root = rootFor(userData, platform);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.rmSync(path.join(root, 'ready.json'), { force: true });
  if (platform !== 'win32') {
    const binary = path.join(root, 'micromamba');
    await ensureArchive(binary, platform === 'darwin' ? MAC_MAMBA[process.arch] : MAMBA, progress);
    fs.chmodSync(binary, 0o700);
    const prefix = path.join(root, 'env');
    fs.rmSync(prefix, { recursive: true, force: true });
    await run(binary, ['create', '--yes', '--prefix', prefix, '--channel', 'conda-forge',
      '--override-channels', ...(platform === 'darwin' ? MAC_PACKAGES : LINUX_PACKAGES)], {
      env: { ...process.env, MAMBA_ROOT_PREFIX: path.join(root, 'cache') }
    }, 'Prepare build tools');
    const bin = path.join(prefix, 'bin');
    if (platform === 'darwin') {
      // The required Apple toolchain supplies the SDK and its matching compiler.
      // These explicit wrappers prevent an unrelated Homebrew compiler taking over.
      for (const name of ['clang', 'clang++']) {
        fs.rmSync(path.join(bin, name), { force: true });
        fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nexec /usr/bin/${name} "$@"\n`, { mode: 0o755 });
      }
    }
    const aliases = platform === 'darwin' ? [['llvm-objcopy', 'llvm-objcopy-21'], ['llvm-nm', 'llvm-nm-21']]
      : [['gcc', 'x86_64-conda-linux-gnu-gcc'], ['g++', 'x86_64-conda-linux-gnu-g++'], ['cc', 'x86_64-conda-linux-gnu-gcc'],
        ['c++', 'x86_64-conda-linux-gnu-g++']];
    for (const [name, target] of aliases) {
      if (platform === 'darwin' && !fs.existsSync(path.join(bin, target))) {
        if (fs.existsSync(path.join(bin, name))) continue;
        throw new Error(`Mac tool ${target} is missing.`);
      }
      const link = path.join(bin, name);
      fs.rmSync(link, { force: true });
      fs.symlinkSync(target, link);
    }
    await installCompiler(root, path.join(prefix, 'zig'), ZIG[platform === 'darwin' ? `darwin-${process.arch}` : platform], run, progress, 'tar');
    const required = platform === 'darwin' ? ['git', 'cmake', 'ninja', 'make', 'patch', 'rsync', 'python3', 'llvm-objcopy', 'llvm-nm', 'ld.lld', 'clang++', 'bash']
      : ['git', 'cmake', 'ninja', 'make', 'patch', 'rsync', 'python3', 'objcopy', 'nm', 'g++', 'bash'];
    for (const name of required)
      if (!fs.existsSync(path.join(bin, name))) throw new Error(`Build tool ${name} is missing after download.`);
  } else {
    const archive = path.join(root, 'msys2-base.sfx.exe');
    await ensureArchive(archive, MSYS2, progress);
    const msys = path.join(root, 'msys64');
    fs.rmSync(msys, { recursive: true, force: true });
    await run(archive, ['-y', `-o${root}`], { cwd: root }, 'Unpack build tools');
    const bash = path.join(msys, 'usr', 'bin', 'bash.exe');
    if (!fs.existsSync(bash)) throw new Error('Portable MSYS2 did not unpack correctly.');
    const env = { ...process.env, MSYSTEM: 'MINGW64', CHERE_INVOKING: '1',
      PATH: [path.join(msys, 'usr', 'bin'), process.env.PATH || ''].join(path.delimiter) };
    await run(bash, ['-lc', 'pacman -Syu --noconfirm'], { cwd: msys, env }, 'Update private build tools');
    await run(bash, ['-lc', `pacman -Syu --noconfirm --needed ${WINDOWS_PACKAGES.join(' ')}`],
      { cwd: msys, env }, 'Prepare build tools');
    if (!fs.existsSync(path.join(msys, 'mingw64', 'bin', 'g++.exe')))
      throw new Error('Windows compiler is missing after tool setup.');
    // MinGW's ca-certificates install can leave its bundles empty (2026-10-05.1
    // shipped that way), which breaks every HTTPS download the bundled Python
    // makes. MSYS2's own copy holds the same Mozilla roots.
    const certificates = path.join(msys, 'usr', 'ssl', 'certs', 'ca-bundle.crt');
    if (!fs.existsSync(certificates) || !fs.statSync(certificates).size)
      throw new Error('MSYS2 certificate bundle is missing after tool setup.');
    for (const file of [['etc', 'ssl', 'cert.pem'], ['etc', 'ssl', 'certs', 'ca-bundle.crt'],
      ['etc', 'pki', 'ca-trust', 'extracted', 'pem', 'tls-ca-bundle.pem']].map(parts => path.join(msys, 'mingw64', ...parts)))
      if (!fs.existsSync(file) || !fs.statSync(file).size) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.copyFileSync(certificates, file);
      }
    // Windows' own tar reads the zip; MSYS2's would not.
    const llvm = path.join(msys, 'llvm-mingw');
    await installCompiler(root, llvm, LLVM_MINGW, run, progress, path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'));
    // The game needs the compiler and its headers, not the rest of this cross toolchain.
    for (const name of fs.readdirSync(llvm)) if (!['bin', 'lib', 'LICENSE.TXT'].includes(name)) fs.rmSync(path.join(llvm, name), { recursive: true, force: true });
    for (const name of fs.readdirSync(path.join(llvm, 'lib'))) if (name !== 'clang') fs.rmSync(path.join(llvm, 'lib', name), { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(root, 'ready.json'), JSON.stringify({ toolset: toolsetFor(platform), platform }), { mode: 0o600 });
  return status(userData, platform);
}


module.exports = { prepareFromUpstream, ZIG, LLVM_MINGW };
