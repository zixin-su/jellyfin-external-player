# Build and Release Guide

## Prerequisites

- Windows 10/11.
- Node.js 20 or newer is recommended.
- npm.

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

- `dist/JellyfinExternalPlayer-v0.6-win32-x64/`
- `dist/JellyfinExternalPlayer-v0.6-win32-x64.zip`

## Clean Release Rules

Do not include these directories or files in a public release artifact:

- `data/`
- `cache/`
- `logs/`
- `crashDumps/`
- `work/`
- `migration-backup/`

These paths may contain login state, cookies, local settings, logs, or local machine paths.

## Manual GitHub Release

1. Create a tag such as `v0.6.0`.
2. Create a GitHub Release from that tag.
3. Upload `dist/JellyfinExternalPlayer-v0.6-win32-x64.zip`.
4. Mention that users should unzip the package and run `JellyfinExternalPlayer-v0.6.exe`.

## Upgrade Notes

For local upgrades, copy the previous package's `data/` directory into the new package folder if you want to keep login state and settings. Public release packages must not include a prefilled `data/` directory.
