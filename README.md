# Jellyfin External Player

An Electron shell for Jellyfin Web that keeps the normal Jellyfin browsing and login experience, while redirecting playback actions to an external desktop player such as PotPlayer, mpv, or VLC.

Chinese documentation: [README.zh-CN.md](README.zh-CN.md)

## Features

- Loads the original Jellyfin Web UI inside an Electron window.
- Persists Jellyfin login state and app settings beside the executable in `data/`.
- Lets users configure an external player executable and custom player arguments.
- Intercepts real Jellyfin play actions without hijacking favorite, watched, more, or other toolbar buttons.
- Sends Jellyfin HTTP stream URLs to the external player when possible, so the player only needs network access to Jellyfin and does not need direct access to NAS file paths.
- Supports STRM media by using Jellyfin resolved media sources first, then optional local STRM reading/path mapping as fallback.
- Handles movies, episodes, series, and seasons:
  - Movies and episodes play directly.
  - Series playback resolves to Jellyfin Next Up, then the first episode.
  - Season playback resolves to an unfinished episode, then an unplayed episode, then the first episode.
- Adds explicit zoom shortcuts: `Ctrl+-`, `Ctrl+=`/`Ctrl++`, and `Ctrl+0`.
- Includes an optional mouse wheel direction correction switch for Jellyfin pages.

## Quick Start

```powershell
npm ci
npm start
```

Open `File > Settings`, then configure:

- `Jellyfin Server URL`: for example `http://192.168.1.10:8096`
- `External Player`: for example `C:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe`
- `Player Arguments`: default is `{url}`. Example: `--fullscreen {url}`

## Packaging

```powershell
npm ci
npm run check
npm run release:win
```

The Windows app folder and zip archive are generated under `dist/`.

More details:

- [Requirements summary](docs/requirements.md)
- [Build and release guide](docs/build.md)
