# Build and Release Guide

## Prerequisites

- Windows 10/11.
- Node.js 20 or newer is recommended.
- npm.
- PowerShell 7 or newer on `PATH` as `pwsh` for packaging and GitHub Release scripts.

Optional cache locations if you want dependency caches outside the system drive:

```powershell
$env:npm_config_cache = "D:\npm-cache"
$env:ELECTRON_CACHE = "D:\electron-cache"
```

## Development

```powershell
npm ci
npm start
```

## Validation

```powershell
npm run check
```

The check command validates JavaScript syntax for the Electron main process, preload script, settings page script, and home page script.

## Windows Packaging

Standard package:

```powershell
npm run package
```

Package and zip for release:

```powershell
npm run release:win
```

Outputs:

- `dist/JellyfinExternalPlayer-v0.6.9-win32-x64/`
- `dist/JellyfinExternalPlayer-v0.6.9-win32-x64.zip`

The release folder and zip include the standalone NAS helper script:

- `tools/strm-helper-server.js`

## Clean Release Rules

Do not include these directories or files in a public release artifact:

- `data/`
- `cache/`
- `logs/`
- `crashDumps/`
- `work/`
- `migration-backup/`

These paths may contain login state, cookies, local settings, logs, or local machine paths.

## GitHub Release

Use PowerShell 7 to avoid Chinese text encoding issues in Release notes:

```powershell
pwsh -NoProfile -File scripts/publish-github-release.ps1 `
  -Tag v0.6.9 `
  -AssetPath dist/JellyfinExternalPlayer-v0.6.9-win32-x64.zip `
  -ReleaseNotesPath docs/releases/v0.6.9.md `
  -ReleaseName "Jellyfin 外部播放器 v0.6.9"
```

The release page is Chinese by default. English documentation is linked from `README.en.md`.

## Upgrade Notes

For local upgrades, copy the previous package's `data/` directory into the new package folder if you want to keep login state and settings. Public release packages must not include a prefilled `data/` directory.
