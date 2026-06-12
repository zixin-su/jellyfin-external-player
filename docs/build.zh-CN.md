# 构建与发布流程

English version: [build.md](build.md)

## 前置条件

- Windows 10/11。
- 建议使用 Node.js 20 或更新版本。
- npm。
- PowerShell 7 或更新版本，并确保命令行可以直接运行 `pwsh`。打包和 GitHub Release 脚本都使用 PowerShell 7。

如果希望依赖缓存不放在系统盘，可以设置：

```powershell
$env:npm_config_cache = "D:\npm-cache"
$env:ELECTRON_CACHE = "D:\electron-cache"
```

## 开发运行

```powershell
npm ci
npm start
```

## 校验

```powershell
npm run check
```

该命令会检查 Electron 主进程、preload 脚本、设置页脚本和首页脚本的 JavaScript 语法。

## Windows 打包

普通打包：

```powershell
npm run package
```

生成发布用 zip：

```powershell
npm run release:win
```

输出位置：

- `dist/JellyfinExternalPlayer-v0.6.1-win32-x64/`
- `dist/JellyfinExternalPlayer-v0.6.1-win32-x64.zip`

## 干净发布规则

公开 release 包不能包含以下目录或文件：

- `data/`
- `cache/`
- `logs/`
- `crashDumps/`
- `work/`
- `migration-backup/`

这些路径可能包含登录态、Cookies、本地设置、日志或本机路径。

## 发布到 GitHub Release

使用 PowerShell 7 发布，避免中文 Release 说明在 Windows PowerShell 5.1 下变成乱码：

```powershell
pwsh -NoProfile -File scripts/publish-github-release.ps1 `
  -Tag v0.6.1 `
  -AssetPath dist/JellyfinExternalPlayer-v0.6.1-win32-x64.zip `
  -ReleaseNotesPath docs/releases/v0.6.1.md `
  -ReleaseName "Jellyfin 外部播放器 v0.6.1"
```

Release 页面默认使用中文。英文文档入口放在 `README.en.md`。

## 升级说明

本地升级时，如果希望保留登录态和设置，可以把旧包中的 `data/` 目录复制到新包目录。公开 release 包不能预置 `data/` 目录。
