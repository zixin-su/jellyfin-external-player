# STRM Helper Service Guide

中文文档: [strm-helper.zh-CN.md](strm-helper.zh-CN.md)

## Playback Source Modes

The settings page has a three-way `播放地址来源` choice:

- `Jellyfin 流模式`: default. Sends Jellyfin HTTP stream URLs to the external player.
- `直接路径模式`: uses Jellyfin media source paths. For `.strm` media, the client reads the first usable line in the `.strm` file. This mode requires the client PC to access the resolved path directly.
- `辅助服务模式`: sends Jellyfin media source paths and item paths as candidates to the NAS helper service. The source can be a plain video file or a `.strm` file. The helper returns an HTTP Range stream so PotPlayer, mpv, VLC, and similar players can seek normally.

## NAS Helper Service

If `.strm` files or real media files are only readable on the NAS/Jellyfin host, run the helper service on that host. The helper supports both plain video files and `.strm` files.

### Docker / Container Manager / Container Station

Use Docker where possible, including Synology Container Manager, QNAP Container Station, Unraid, TrueNAS SCALE, or a normal Linux NAS.

Edit `docker-compose.strm-helper.yml` first:

```yaml
environment:
  JEP_HELPER_TOKEN: "set-a-long-random-token"
  JEP_HELPER_PUBLIC_URL: "http://NAS_IP:8097"
volumes:
  - "/volume1/video:/volume1/video:ro"
  - "/volume1/strm:/volume1/strm:ro"
```

The left side of each `volumes` entry must be a real NAS path. The helper must be able to read:

- The `.strm` file path returned by Jellyfin APIs.
- The real media path in the first usable line of the `.strm` file.
- The plain video file path returned by Jellyfin APIs.

Start the helper:

```bash
docker compose -f docker-compose.strm-helper.yml up -d --build
```

Client settings:

- `NAS 辅助服务地址`: `http://NAS_IP:8097`
- `NAS 辅助服务令牌`: the `JEP_HELPER_TOKEN` value

If Jellyfin container paths differ from helper container paths, add mappings in `STRM 路径映射`:

```text
/media => /volume1/video
/config/strm => /volume1/strm
```

The client sends these mappings to the NAS helper service.

After startup, verify the helper with:

```text
http://NAS_IP:8097/health
```

A normal response includes `ok: true`, `version`, and `capabilities`.

### Run With Node.js Directly

If the NAS can run Node.js, copy only this single file and run it:

```text
tools/strm-helper-server.js
```

PowerShell example:

```powershell
$env:JEP_HELPER_HOST = "0.0.0.0"
$env:JEP_HELPER_PORT = "8097"
$env:JEP_HELPER_TOKEN = "set-a-long-random-token"
node strm-helper-server.js
```

Then configure the client:

- `NAS 辅助服务地址`: for example `http://NAS_IP:8097`
- `NAS 辅助服务令牌`: the same `JEP_HELPER_TOKEN`

The standalone helper reads plain video paths or `.strm` paths returned by Jellyfin. For `.strm`, it resolves the first usable line and exposes the real local file as an HTTP Range stream.

The helper console logs parsing and playback requests:

- `resolve start`: received a resolve request.
- `resolve try`: trying one candidate path.
- `resolve ok`: path resolved.
- `resolve candidate failed`: one candidate failed.
- `resolve failed`: all candidates failed.
- `stream GET/HEAD`: an external player requested the media stream.

Do not expose a helper service without a token to the public internet.

## Troubleshooting

If the external player receives a URL like this:

```text
http://JELLYFIN_IP:8096/Videos/xxx/stream.strm?...api_key=...
```

the client did not use the NAS helper service and fell back to Jellyfin's own stream URL. For local-path `.strm` media on newer Jellyfin builds, that URL may not be playable by an external player.

If the helper is configured but not running, times out, or is unreachable, the client automatically falls back to Jellyfin stream mode. If the helper is reachable but returns token, permission, missing-file, or unreadable-file errors, the client reports the error instead of hiding the configuration problem.

When helper mode works, the external player should receive a URL like this:

```text
http://NAS_IP:8097/stream/random-id/movie.mkv?token=...
```

If not, check:

- Whether `播放地址来源` is set to `辅助服务模式`.
- Whether `NAS 辅助服务地址` is reachable from the client.
- Whether `NAS 辅助服务令牌` matches `JEP_HELPER_TOKEN`.
- Whether `STRM 路径映射` maps Jellyfin plain video paths or `.strm` paths to paths readable by the helper.
- Whether the real media path inside the `.strm` file is also readable by the helper, adding another mapping if needed.

## Compatibility

Not every NAS supports the same installation method:

- Docker-capable NAS: use Docker when possible.
- NAS with Node.js support: run the single Node.js script directly.
- Closed NAS systems without Docker, Node.js, or third-party services: the helper service cannot be deployed. Use client-readable paths, SMB mappings, Jellyfin's own HTTP stream, or storage mount changes instead.
