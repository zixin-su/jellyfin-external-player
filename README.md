# 项目已废弃

本项目不再作为后续迭代入口，后续开发已迁移至新项目：[zixin-su/jellyfin-native-player-bridge](https://github.com/zixin-su/jellyfin-native-player-bridge)。

本仓库仅保留历史代码、旧版本发布包和说明文档；新功能、问题修复和后续维护请优先查看新项目。

# Jellyfin 外部播放器

这是一个基于 Electron 的 Jellyfin Web 套壳客户端。登录、浏览、媒体库页面仍然使用原生 Jellyfin Web；当用户点击真正的播放按钮时，客户端会把播放目标交给本机外部播放器，例如 PotPlayer、mpv 或 VLC。

English documentation: [README.en.md](README.en.md)

## 功能

- 在 Electron 窗口中加载原始 Jellyfin Web 页面。
- 默认中文界面，未配置或无法打开 Jellyfin 服务时首页只显示提示和“打开设置”按钮。
- 登录状态和客户端设置保存在 exe 同级的 `data/` 目录中，方便免安装使用。
- 支持设置外部播放器路径和自定义播放器参数。
- 设置保存后自动关闭设置窗口，并在主窗口显示自动消失的保存提示。
- 只拦截真正的播放动作，不影响收藏、已观看、更多菜单、详情页其他按钮等 Jellyfin 原功能。
- 播放地址来源三选一：
  - `Jellyfin 流模式`：默认选项，把 Jellyfin HTTP 流地址传给外部播放器。
  - `直接路径模式`：把 Jellyfin 媒体源路径传给外部播放器；如果媒体是 `.strm`，则读取 `.strm` 第一行。
  - `辅助服务模式`：把媒体源路径交给 NAS/Jellyfin 端辅助服务，由辅助服务读取普通视频或 `.strm` 并提供 HTTP Range 流。
- 支持 STRM 媒体、路径映射和 NAS 辅助服务，适合客户端无法直接访问 NAS 本地路径的场景。
- 支持电影、单集、剧集和季：
  - 电影和单集直接播放。
  - 剧集封面播放会先找 Jellyfin Next Up，找不到再播放第一集。
  - 季封面播放会先找未看完的集数，再找未观看集数，再找第一集。
- 显式支持缩放快捷键：`Ctrl+-`、`Ctrl+=`/`Ctrl++`、`Ctrl+0`。
- 提供鼠标滚轮方向修正开关，默认不启用。

## 快速开始

```powershell
npm ci
npm start
```

打开 `文件 > 设置` 后配置：

- `Jellyfin 服务地址`：例如 `https://jellyfin.example.com`、`https://example.com/jellyfin` 或 `http://192.168.1.10:8096`
- 如果使用自签证书、证书域名不匹配或内网反代证书未被系统信任，勾选 `允许当前 Jellyfin HTTPS 地址使用不受信任证书`。
- `外部播放器`：例如 `C:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe`
- `播放器参数`：默认 `{url}`。例如 `--fullscreen {url}`
- `播放地址来源`：普通用户建议保留默认 `Jellyfin 流模式`；只有需要直接访问媒体文件或使用 NAS 辅助服务时再切换。

## STRM 和辅助服务

如果 Jellyfin 媒体源路径是 NAS/Jellyfin 服务器本地路径，客户端电脑访问不到，可以在 NAS/Jellyfin 旁边运行辅助服务。发布 zip 内附带单文件脚本：

```text
tools/strm-helper-server.js
```

辅助服务支持普通视频文件和 `.strm` 文件，会把服务器本地文件转换成外部播放器可访问的 HTTP Range 流。

详细部署和排查说明见 [STRM 辅助服务使用说明](docs/strm-helper.zh-CN.md)。

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
- [STRM 辅助服务使用说明](docs/strm-helper.zh-CN.md)
- [更新日志](CHANGELOG.md)
