# 更新日志

English changelog entries are included under each Chinese release section when needed.

## v0.6.11

- 新增 `允许当前 Jellyfin HTTPS 地址使用不受信任证书` 设置项，用于自签证书、证书域名不匹配或内网反代证书未被系统信任的场景。
- 证书放行只对设置中的 Jellyfin HTTPS 主机生效，不会全局关闭 HTTPS 证书校验。
- Jellyfin 元数据、PlaybackInfo、剧集/季解析等主进程 API 请求改用 Electron 网络栈，确保与页面加载使用同一套证书策略。

## v0.6.10

- 支持在 Jellyfin 服务地址中配置 `https://域名`，无协议纯域名会默认按 HTTPS 处理。
- 继续兼容 `http://IP:端口`、`IP:端口` 和 Jellyfin 常见端口 `8096`。
- 支持反向代理子路径部署，例如 `https://example.com/jellyfin`；播放解析和 Jellyfin API 请求会保留该基础路径。
- 设置页地址输入改为文本输入，避免浏览器 URL 校验阻止无协议域名。

## v0.6.9

- 播放地址来源改为三选一：`Jellyfin 流模式`、`直接路径模式`、`辅助服务模式`，默认使用 `Jellyfin 流模式`。
- 设置页会根据当前播放地址来源，只显示对应参数，并为每种模式提供问号提示说明。
- 新增 NAS/Jellyfin 端辅助服务模式：客户端把 Jellyfin 媒体源路径和项目路径作为候选源传给辅助服务，普通视频文件和 `.strm` 媒体都可由辅助服务转换成支持 HTTP Range 的播放流。
- 新增单文件辅助服务脚本 `tools/strm-helper-server.js`、Dockerfile 和 docker-compose 示例，发布 zip 内也会附带该脚本。
- 辅助服务支持访问令牌、路径映射、健康检查和解析/播放请求日志，便于在 NAS 上部署和排查。
- 辅助服务临时不可用时自动降级到 Jellyfin 流；令牌错误、路径权限错误和文件不存在等配置问题会直接提示。
- 新增 Jellyfin 会话数据定时和退出前落盘，减少客户端重启后要求重新登录的问题。
- 更新 STRM/辅助服务使用说明、构建文档和 Release 说明。

## v0.6.1

- 软件界面默认改为中文，包括首页、设置页、菜单和常见提示。
- 默认不再启用鼠标滚轮方向反转。
- 未配置或无法打开 Jellyfin 服务地址时，首页只显示配置提示和“打开设置”按钮。
- 设置保存后自动关闭设置窗口，并在主窗口显示自动消失的保存提示。
- 仓库默认 README 改为中文，英文文档移至 `README.en.md`。
- 更新构建文档和发布说明到 `v0.6.1`。
- 修复 GitHub Release 页面中文乱码问题；后续发布脚本改用 PowerShell 7，并从 UTF-8 Markdown 文件读取 Release 正文。

English summary:

- Chinese is now the default app and repository documentation language.
- Mouse wheel direction correction is disabled by default.
- The unconfigured or unreachable-server home screen now shows only a setup hint and an Open Settings button.
- Saving settings closes the settings window and shows a toast in the main window.

## v0.6.0

- 首个公开发布版本。
- 支持 Jellyfin Web 套壳、外部播放器、Jellyfin HTTP 流播放、STRM 解析、剧集和季播放解析。
