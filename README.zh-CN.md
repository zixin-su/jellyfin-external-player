# Jellyfin External Player

这是一个基于 Electron 的 Jellyfin Web 套壳客户端。登录、浏览、媒体库页面仍然使用原生 Jellyfin Web；当用户点击真正的播放按钮时，客户端会把播放目标交给本机外部播放器，例如 PotPlayer、mpv 或 VLC。

English documentation: [README.md](README.md)

## 功能

- 在 Electron 窗口中加载原始 Jellyfin Web 页面。
- 登录状态和客户端设置保存在 exe 同级的 `data/` 目录中，方便免安装使用。
- 支持设置外部播放器路径和自定义播放器参数。
- 只拦截真正的播放动作，不影响收藏、已观看、更多菜单、详情页其他按钮等 Jellyfin 原功能。
- 优先把 Jellyfin HTTP 流地址传给外部播放器，因此外部播放器只需要能访问 Jellyfin 服务，不需要直接访问 NAS 内部文件路径。
- 支持 STRM 媒体：优先使用 Jellyfin 已解析的媒体源；必要时才读取本机可访问的 `.strm` 文件，并支持路径映射。
- 支持电影、单集、剧集和季：
  - 电影和单集直接播放。
  - 剧集封面播放会先找 Jellyfin Next Up，找不到再播放第一集。
  - 季封面播放会先找未看完的集数，再找未观看集数，再找第一集。
- 显式支持缩放快捷键：`Ctrl+-`、`Ctrl+=`/`Ctrl++`、`Ctrl+0`。
- 提供鼠标滚轮方向修正开关。

## 快速开始

```powershell
npm ci
npm start
```

打开 `File > Settings` 后配置：

- `Jellyfin Server URL`：例如 `http://192.168.1.10:8096`
- `External Player`：例如 `C:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe`
- `Player Arguments`：默认 `{url}`。例如 `--fullscreen {url}`

## 打包

```powershell
npm ci
npm run check
npm run release:win
```

Windows 应用目录和 zip 压缩包会生成到 `dist/`。

更多文档：

- [需求总结](docs/requirements.zh-CN.md)
- [构建与发布流程](docs/build.zh-CN.md)
