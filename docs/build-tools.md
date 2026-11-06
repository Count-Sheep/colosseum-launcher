# Build tool release assets

The launcher and its toolsets have independent versions. `src/tool-assets.json` and `src/mac-tool-assets.json` pin each archive's URL and SHA-256 checksum. Linux x64, Windows x64, and Mac x64/arm64 computers download their matching archive automatically in setup Step 1. These are prepared in a disposable publisher job, never by installing packages on a player's system.

What the port builds with, on every system: a pinned clang for the game code (zig's on Linux and macOS, at the release the port uses there: 0.17.0 on Linux, 0.14.1 on macOS; llvm-mingw 20250114's clang 19 on Windows, as `zig.exe` needs Windows 8 or later; `tools/befix.py` reads the IR it writes), a C/C++ compiler for the host code and renderer, CMake, Ninja, Python 3, Git, rsync, and SDL2.

- **Linux:** conda-forge packages with GCC against a glibc 2.17 sysroot, so the game runs on every distribution the launcher does. The game finds SDL2 and EGL in the tools through its RPATH.
- **Windows:** a private MSYS2 with MINGW64 GCC, and llvm-mingw's clang 19 in its `llvm-mingw` folder. The game links SDL2 and the runtimes in, so it plays without the tools once built.
- **macOS:** conda-forge packages with LLVM's object tools and `ld.lld`, which link the game's ELF objects into the image the executable carries. Small `clang`/`clang++` wrappers select Apple's compiler; Apple's SDK and Command Line Tools stay out of our archives, and the port fetches SDL2.framework and MoltenVK when it builds. Homebrew is not required.

## macOS setup

Step 1 checks Apple's tools and shows a guided checklist with a copyable Terminal command when needed: `xcode-select --install`. The game is native on both kinds of Mac (arm64 on Apple Silicon), so Rosetta is not needed. Click **Check again** in Mac setup help, then continue Step 1. The launcher does not run system installers or accept Apple's licenses automatically.

## Publish a new toolset

1. On `main` (a workflow can only be started from there the first time) or a preparation branch, set a new `toolset` for the platform in `src/tool-assets.json` or `src/mac-tool-assets.json`. Update the pinned packages in `scripts/bootstrap-build-tools.js` as needed. Never reuse a published toolset version.
2. Run **Publish build tool archives** (Linux, Windows) or **Publish Mac build tool archives** (Intel, Apple Silicon) in GitHub Actions. Only these workflows run micromamba or pacman. They build the tools, package them, unpack them in a different folder, and build and start the game with the relocated tools and no disc.
3. Every selected job must pass before publication. The workflow publishes `build-tools-<platform>-<toolset>` as a prerelease, so it does not become the launcher's latest update, with the tool archive, its corresponding source archive, notices, and a merged manifest.
4. Download that merged manifest over `src/tool-assets.json` or `src/mac-tool-assets.json`, commit the pins and bump the launcher version. The release workflow verifies the matching archive before attaching it to each release.

The tool archives contain only build dependencies. Port executables, disc images, game assets, texture packs, and saves never enter the publishing directory. The source archives contain package build recipes, patches, upstream source downloads, license information, and package metadata. Keep these assets available while distributing their toolset.

## Smoke test shipped tools

`npm ci && node scripts/smoke-build-tools.js` downloads the pinned archive and builds the game from `src/game-release.json` as a player's launcher does, with `PATH` limited to the private tools and from folders with spaces in their names. It checks the executable is native for its system (x86-64, or arm64 on Apple Silicon), that the launcher takes the build for the current game, and that the game starts and asks for its disc. On Windows it also plants stand-in DLLs in System32, as some players' computers have, and checks the game needs nothing Windows lacks.

During archive publication, `COLO_TOOL_ASSET_MANIFEST=tool-assets/manifest-<platform>.json` tests the local archive before its release exists. This override is only used by CI; the app uses the committed checksum pins.
