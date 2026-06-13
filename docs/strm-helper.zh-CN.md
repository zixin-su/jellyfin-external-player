# STRM 辅助服务使用说明

English version: [strm-helper.en.md](strm-helper.en.md)

## 播放地址来源

设置页的 `播放地址来源` 是三选一：

- `Jellyfin 流模式`：默认选项，直接把 Jellyfin HTTP 流地址传给外部播放器。
- `直接路径模式`：使用 Jellyfin 媒体源路径；如果是 `.strm`，则读取 `.strm` 第一行里的路径。该模式只在本机能访问对应路径时可用。
- `辅助服务模式`：把 Jellyfin 媒体源路径和项目路径作为候选路径传给 NAS 辅助服务；媒体源可以是普通视频文件，也可以是 `.strm` 文件。辅助服务返回 HTTP Range 流，PotPlayer、mpv、VLC 等播放器可以拖动进度。

## NAS 辅助服务

如果 `.strm` 文件或真实媒体文件只在 NAS/Jellyfin 主机本机可读，客户端完全读不到，可以在 NAS/Jellyfin 主机上运行独立辅助服务。辅助服务既可以处理普通视频文件，也可以处理 `.strm` 文件。

### Docker / Container Manager / Container Station

支持 Docker 的 NAS 推荐用这个方式，例如群晖 Container Manager、威联通 Container Station、Unraid、TrueNAS SCALE 或普通 Linux NAS。

先修改 `docker-compose.strm-helper.yml`：

```yaml
environment:
  JEP_HELPER_TOKEN: "自己设置一个长随机令牌"
  JEP_HELPER_PUBLIC_URL: "http://NAS_IP:8097"
volumes:
  - "/volume1/video:/volume1/video:ro"
  - "/volume1/strm:/volume1/strm:ro"
```

`volumes` 左侧必须换成 NAS 上真实存在的目录。辅助服务需要同时能读到：

- Jellyfin API 返回的 `.strm` 文件路径。
- `.strm` 第一行指向的真实媒体文件路径。
- Jellyfin API 返回的普通视频文件路径。

启动：

```bash
docker compose -f docker-compose.strm-helper.yml up -d --build
```

客户端设置：

- `NAS 辅助服务地址`：`http://NAS_IP:8097`
- `NAS 辅助服务令牌`：`JEP_HELPER_TOKEN` 的值

如果 Jellyfin 容器里的路径和辅助服务容器里的路径不一致，在客户端 `STRM 路径映射` 里增加映射，例如：

```text
/media => /volume1/video
/config/strm => /volume1/strm
```

客户端会把这些映射传给 NAS 辅助服务。

启动后可以访问健康检查接口确认版本和能力：

```text
http://NAS_IP:8097/health
```

正常应返回 `ok: true`、`version` 和 `capabilities` 字段。

### 直接运行 Node.js

如果 NAS 可以安装 Node.js，也可以只复制 `tools/strm-helper-server.js` 这一个文件后直接运行：

```powershell
$env:JEP_HELPER_HOST = "0.0.0.0"
$env:JEP_HELPER_PORT = "8097"
$env:JEP_HELPER_TOKEN = "自己设置一个长随机令牌"
node strm-helper-server.js
```

然后在客户端设置里填写：

- `NAS 辅助服务地址`：例如 `http://NAS_IP:8097`
- `NAS 辅助服务令牌`：上面设置的 `JEP_HELPER_TOKEN`

独立辅助服务会读取 Jellyfin 返回的普通视频路径或 `.strm` 路径；如果是 `.strm`，会解析 `.strm` 第一行，并把真实本地文件转换成 HTTP Range 流。

辅助服务控制台会输出解析和播放请求日志，包括：

- `resolve start`：收到客户端解析请求。
- `resolve try`：开始尝试某个候选路径。
- `resolve ok`：路径解析成功。
- `resolve candidate failed`：某个候选路径解析失败。
- `resolve failed`：所有候选路径都解析失败。
- `stream GET/HEAD`：外部播放器请求播放流。

不要把没有令牌的 NAS 辅助服务直接暴露到公网。

## 排查

如果外部播放器收到的地址类似：

```text
http://JELLYFIN_IP:8096/Videos/xxx/stream.strm?...api_key=...
```

说明客户端没有成功使用 NAS 辅助服务，而是退回到了 Jellyfin 自己的 STRM 流地址。对于 Jellyfin 10.11.7 之后的本地路径型 `.strm`，这个地址通常不能播放。

如果已经配置了 NAS 辅助服务，但服务未启动、连接超时或网络不可达，客户端会自动降级到这个 Jellyfin 流地址。这样辅助服务临时不可用时仍能尽量播放。

如果 NAS 辅助服务已经能连接，但返回令牌错误、路径权限错误、`.strm` 文件不存在或真实媒体文件不可读，客户端不会静默降级，而是提示错误，避免把配置问题隐藏掉。

正确走 NAS 辅助服务时，外部播放器收到的地址应该类似：

```text
http://NAS_IP:8097/stream/随机ID/影片名.mkv?token=...
```

如果没有拿到这个地址，请检查：

- 客户端设置里的 `播放地址来源` 是否选择了 `辅助服务模式`。
- `NAS 辅助服务地址` 是否能从客户端访问。
- `NAS 辅助服务令牌` 是否和服务端 `JEP_HELPER_TOKEN` 一致。
- `STRM 路径映射` 是否能把 Jellyfin API 返回的普通视频路径或 `.strm` 路径映射到辅助服务可读取的路径。
- `.strm` 第一行里的真实媒体路径是否也能被辅助服务读取，必要时同样增加路径映射。

## 兼容性

不是所有 NAS 都能使用同一种安装方式：

- 支持 Docker 的 NAS：优先使用 Docker 方式。
- 能安装 Node.js 的 NAS：可以直接运行 Node.js 脚本。
- 封闭系统、不能运行 Docker/Node.js、也不能安装第三方服务的 NAS：无法部署 NAS 辅助服务，只能使用客户端本机可访问路径、SMB 映射、Jellyfin 自身 HTTP 流或改造存储挂载方式。
