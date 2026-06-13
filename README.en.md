# Jellyfin External Player

An Electron shell for Jellyfin Web that keeps the normal Jellyfin browsing and login experience, while redirecting playback actions to an external desktop player such as PotPlayer, mpv, or VLC.

中文文档: [README.md](README.md)

## Features

- Loads the original Jellyfin Web UI inside an Electron window.
- Uses Chinese as the default app UI. When the Jellyfin server is not configured or cannot be opened, the home screen only shows a hint and an "Open Settings" button.
- Persists Jellyfin login state and app settings beside the executable in `data/`.
- Lets users configure an external player executable and custom player arguments.
- Closes the settings window after saving and shows an auto-dismissing toast in the main window.
- Intercepts real Jellyfin play actions without hijacking favorite, watched, more, or other toolbar buttons.
- Provides three playback source modes:
  - `Jellyfin stream mode`: the default mode. Sends Jellyfin HTTP stream URLs to the external player.
  - `Direct path mode`: sends Jellyfin media source paths to the external player. For `.strm` media, the client reads the first usable line in the `.strm` file.
  - `Helper service mode`: sends media source paths to a NAS/Jellyfin-side helper service, which reads plain video files or `.strm` targets and exposes them as HTTP Range streams.
- Supports STRM media, path mapping, and an optional NAS helper service for cases where the client PC cannot access server-local media paths directly.
- Handles movies, episodes, series, and seasons:
  - Movies and episodes play directly.
  - Series playback resolves to Jellyfin Next Up, then the first episode.
  - Season playback resolves to an unfinished episode, then an unplayed episode, then the first episode.
- Adds explicit zoom shortcuts: `Ctrl+-`, `Ctrl+=`/`Ctrl++`, and `Ctrl+0`.
- Includes an optional mouse wheel direction correction switch for Jellyfin pages. It is disabled by default.

## Quick Start

```powershell
npm ci
npm start
```

Open `文件 > 设置`, then configure:

- `Jellyfin 服务地址`: for example `http://192.168.1.10:8096`
- `外部播放器`: for example `C:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe`
- `播放器参数`: default is `{url}`. Example: `--fullscreen {url}`
- `播放地址来源`: keep the default `Jellyfin 流模式` unless you need direct file paths or the NAS helper service.

## STRM And Helper Service

If Jellyfin media source paths only exist on the NAS/Jellyfin server and the client PC cannot access them, run the helper service next to Jellyfin. The release zip includes the standalone script:

```text
tools/strm-helper-server.js
```

The helper supports both plain video files and `.strm` files, and exposes server-local files as HTTP Range streams for external players.

See [STRM helper service guide](docs/strm-helper.en.md) for setup and troubleshooting.

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
- [STRM helper service guide](docs/strm-helper.en.md)
- [Changelog](CHANGELOG.md)
