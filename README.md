# Colosseum Launcher

Set up and play the native PC port of Pokémon Colosseum on **Windows, macOS, and Linux**. The launcher guides you through setup, downloads the tools it needs, and gives you one big **Play** button when you're ready.

**Bring your own game.** You need a disc image made from your own North American Pokémon Colosseum disc. The launcher does not include a game or disc image.

This is an unofficial fan project, not affiliated with Nintendo, Creatures, GAME FREAK or The Pokémon Company.

## Download

**[Download Colosseum Launcher from the latest release](https://github.com/chasem-dev/colosseum-launcher/releases/latest)**

| Your computer | Download |
| --- | --- |
| Windows | The `.exe` installer, or `Colosseum-Launcher-<version>-win-portable.exe` for the portable version |
| Mac — Intel or Apple Silicon | `Colosseum-Launcher-<version>-mac-universal.dmg` |
| Linux | The `.AppImage` |

The launcher requires a **64-bit computer** and an internet connection for setup. Required setup tools download automatically.

## Install

### Windows

Open the `.exe` installer and follow the steps, then open Colosseum Launcher.

**Portable version:** put `Colosseum-Launcher-<version>-win-portable.exe` in any folder, such as on a USB drive, and open it. Nothing is installed. The first time it runs, it creates a `Colosseum-Launcher-Portable` folder next to the `.exe` and keeps everything there: settings, setup files, build tools, the game, saves, and save backups. Portable versions don't update themselves: to update, put the new portable `.exe` in place of the old one, next to the same folder.

### Mac

1. Double-click the `.dmg`.
2. Drag **Colosseum Launcher.app** onto **Applications** in the window that opens.
3. Eject the disk image, then open Colosseum Launcher from Applications.

### Linux

Download the `.AppImage`, allow it to run as a program in your file manager's permissions settings, then open it.

## Set up your game

The launcher walks you through three steps:

1. **Download setup files.** Use the suggested location, or choose a different folder before downloading.
2. **Choose disc image.** Select a copy of your own original North American Pokémon Colosseum disc: **GC6E01, revision 0**. Supported files are `.iso` and `.gcm`. Compressed formats (CISO, RVZ, GCZ) need converting to ISO first, which Dolphin does with **Convert File**. The bonus disc is not the game.
3. **Begin setup.** The launcher downloads HD textures and builds the game on your computer. This first setup can take a while.

On Mac, setup may ask you to install Apple's Command Line Tools and, on Apple Silicon, Rosetta. Follow **Mac setup help** in the launcher. The game is an x86-64 program: its code needs memory below 4 GiB, which macOS never gives an Apple Silicon program, so Rosetta runs it there.

The progress bar shows what's happening. **View build log** opens more detail; closing that view keeps setup running. When setup finishes, press **Play**.

## Play and change settings

After setup, the main screen is just **Play** and the tabs above it.

- **Gameplay** skips the movies and chooses how the game's text is drawn.
- **Display** has the screen format, fullscreen, frame rate (30 or 60 fps) and V-Sync.
- **Graphics** has the renderer (Vulkan, or OpenGL), picture sharpness up to 4×, anti-aliasing, filtering, upscaling and the HD textures.
- **Controls** sets the keys and controller buttons for each GameCube button, and the sticks, triggers and rumble.
- **Manage game** has game updates, rebuilding, the setup folder and disc file, and space cleanup.
- **Launcher** has dark mode, automatic updates and your launcher, game and tool versions for support.

The defaults are **HD textures on**, **4×** picture sharpness, **60 fps** and a picture **as wide as the window**. Changes take effect the next time you start the game.

The launcher also works with a game controller: move with the left stick or d-pad and press **A** to select, **B** to go back and **Start** for Settings. The launcher ignores the controller while the game is running.

In the game, hold **L + R** (Q + E on the keyboard) to fast-forward at 4×, and **A** skips a movie.

### Controllers

Any controller SDL knows works: Xbox, PlayStation, Switch and more. GameCube controllers on a USB adapter in Wii U mode are read directly; **Settings → Controls** shows one when it is plugged in, and on Linux offers to add the udev rule it needs. In Battle Mode each controller is the next free player as it is plugged in.

### HD textures

HD textures are **on by default for first-time setup**: all 7,498 of the game's textures upscaled 4×, about **2 GB to download** and **2 GB installed**, with 4 GB free needed during setup. They are checked against a pinned SHA-256 before they are used, and a download that stops continues where it was. Turn them off in **Settings → Graphics**.

**Custom textures:** packs made for Dolphin's Load Custom Textures work unchanged. Put them in the folder **Open custom textures folder** opens. They win over the HD textures, and work with HD textures off.

### Updates

When a game update is ready, the main button becomes **Update & play**. Your current game stays available until the new setup succeeds. The **▾** beside it has **Update only** and **Play now**.

Launcher updates download automatically when **Update automatically** is on and install when you quit. After an update, What's new opens once to show what changed.

### Saved games and backups

The launcher keeps your save location when you update or rebuild the game, and makes dated backups before and after playing, and before game updates or cleanup. The memory card is `colo-port/card-a` in your user data folder (`%APPDATA%` on Windows, `~/.local/share` elsewhere).

The **Saves** tab backs up saves, opens the backup folder and restores a backup, backing up your current saves first. Backups are stored in **Colosseum Launcher Backups** in your home folder.

### Privacy

The launcher sends nothing about you. It talks to GitHub and the port's GitLab for updates and the setup files, and to Amazon S3 for the HD textures. Your disc image never leaves your computer.

## Need help?

Open the activity log with **Activity log** in the status bar, choose **Copy log**, and [open an issue](https://github.com/chasem-dev/colosseum-launcher/issues/new/choose) with it. Crash reports are kept in `colo-port/crashes` in your state folder (`%LOCALAPPDATA%` on Windows, `~/.local/state` elsewhere).

## For developers

### What it builds

The game is [pokemon-colosseum](https://git.softwareauralabs.com/chase/pokemon-colosseum) (the port, on GitLab), compiled from the [pkmn-colosseum](https://github.com/dougchansan/pkmn-colosseum) decompilation, with the renderer's sources from [sms-pc-port](https://github.com/chasem-dev/sms-pc-port). `src/game-release.json` pins all of them to exact commits; the game folder holds the port with `deps/pkmn-colosseum` and `deps/sms-pc-port` inside it. The launcher only reads those repositories: its own changes to the port, for its private toolchain and for paths with spaces, are `scripts/port-launcher.patch`, applied to the checkout. `scripts/build-colosseum.sh` runs the port's own `build.sh` there. No game data is in any of those repositories, and the build needs none: the player's disc is read when the game runs.

The launcher is built on [SMS Launcher](https://github.com/chasem-dev/sms-launcher)'s setup: the same three steps, private toolsets and release pipeline, without that game's extras.

### Run locally

```sh
npm ci
npm start
```

Node 22.12 or newer.

### Test and package

```sh
npm test
npm run dist -- --linux --x64     # or --win --x64, --mac --universal
```

`node scripts/smoke-build-tools.js` downloads the pinned tools and builds the game as a player's launcher does, from a folder with spaces in its name, then starts it far enough to ask for its disc. **Game build** (`game-build.yml`) runs it on Linux, Windows, and Intel and Apple Silicon Macs.

### Build tools

See [docs/build-tools.md](docs/build-tools.md).

### Versions and releases

Pushing a higher `version` in `package.json` to `main` releases it: `release.yml` makes the tag and a draft, requires the pinned game to build everywhere (`game-build.yml`), packages all three systems and attaches the tool archives, then publishes.

`npm run update:game` selects the newest commit of the port's branch and the decomp and renderer commits it pins, bumps the version and drafts the changelog. See [AGENTS.md](AGENTS.md) for the changelog's rules.

### Launcher updates and Mac signing

Updates come from this repository's releases through `electron-updater`. Mac updates need every release signed with one certificate: `scripts/make-mac-cert.sh` makes a self-signed one, and the repository's `MAC_CSC_LINK` and `MAC_CSC_KEY_PASSWORD` secrets hold it. Keep its folder: a new certificate breaks updates for every install. The app is not notarized, so macOS asks to confirm the first time it opens.
