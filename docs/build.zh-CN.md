# 构建与发布流程

## 前置条件

- Windows 10/11。
- 建议使用 Node.js 20 或更新版本。
- npm。

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

- `dist/JellyfinExternalPlayer-v0.6-win32-x64/`
- `dist/JellyfinExternalPlayer-v0.6-win32-x64.zip`

## 干净发布规则

公开 release 包不能包含以下目录或文件：

- `data/`
- `cache/`
- `logs/`
- `crashDumps/`
- `work/`
- `migration-backup/`

这些路径可能包含登录态、Cookies、本地设置、日志或本机路径。

## 手动发布到 GitHub Release

1. 创建 tag，例如 `v0.6.0`。
2. 基于该 tag 创建 GitHub Release。
3. 上传 `dist/JellyfinExternalPlayer-v0.6-win32-x64.zip`。
4. 说明用户解压后运行 `JellyfinExternalPlayer-v0.6.exe`。

## 升级说明

本地升级时，如果希望保留登录态和设置，可以把旧包中的 `data/` 目录复制到新包目录。公开 release 包不能预置 `data/` 目录。
