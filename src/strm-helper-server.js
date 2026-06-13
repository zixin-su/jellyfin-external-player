const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { fileURLToPath } = require("url");

const HELPER_VERSION = "0.6.9";
const DEFAULT_REGISTRY_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_JSON_BODY_BYTES = 1024 * 1024;

async function startStrmHelperServer(options = {}) {
  const host = String(options.host || "127.0.0.1");
  const requestedPort = normalizePort(options.port);
  const token = options.token === false ? "" : String(options.token || crypto.randomBytes(24).toString("hex"));
  const allowResolve = Boolean(options.allowResolve);
  const publicBaseUrl = String(options.publicBaseUrl || "").replace(/\/+$/, "");
  const registryTtlMs = Number(options.registryTtlMs || DEFAULT_REGISTRY_TTL_MS);
  const logger = typeof options.logger === "function" ? options.logger : () => {};
  const registry = new Map();

  let server;
  let actualPort = requestedPort;
  let baseUrl = "";

  const controller = {
    get port() {
      return actualPort;
    },
    get host() {
      return host;
    },
    get token() {
      return token;
    },
    get baseUrl() {
      return baseUrl;
    },
    registerFile(filePath, meta = {}, baseOverride = "") {
      cleanupRegistry(registry, registryTtlMs);

      const fullPath = path.resolve(String(filePath || ""));
      const id = crypto.randomUUID();
      const name = sanitizeFilename(meta.name || basenameForDisplay(fullPath));
      registry.set(id, {
        filePath: fullPath,
        name,
        createdAt: Date.now()
      });

      const base = String(baseOverride || baseUrl).replace(/\/+$/, "");
      const url = new URL(`${base}/stream/${encodeURIComponent(id)}/${encodeURIComponent(name)}`);
      if (token) url.searchParams.set("token", token);
      return url.toString();
    },
    async resolveStrmPath(strmPath, mappings = [], baseOverride = "") {
      const readableStrmPath = applyPathMappings(strmPath, mappings);
      const target = await readStrmTarget(readableStrmPath, mappings);
      if (isRemoteStreamTarget(target)) {
        return { kind: "strm-target-url", target };
      }

      const stat = await fsp.stat(target);
      if (!stat.isFile()) {
        throw new Error(`STRM 目标不是文件：${target}`);
      }

      return {
        kind: "strm-helper-stream",
        target: controller.registerFile(target, { name: basenameForDisplay(target) }, baseOverride)
      };
    },
    close() {
      return new Promise((resolve) => {
        if (!server) {
          resolve();
          return;
        }
        server.close(() => resolve());
      });
    }
  };

  server = http.createServer((request, response) => {
    handleRequest(request, response, {
      allowResolve,
      publicBaseUrl,
      registry,
      registryTtlMs,
      token,
      controller,
      logger
    }).catch((error) => {
      logger("request-failed", { error: error.message });
      sendJson(response, 500, { ok: false, message: error.message || "辅助服务请求失败。" });
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, host, () => {
      server.off("error", reject);
      const address = server.address();
      actualPort = typeof address === "object" && address ? address.port : requestedPort;
      const visibleHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
      baseUrl = publicBaseUrl || `http://${visibleHost}:${actualPort}`;
      resolve();
    });
  });

  return controller;
}

async function handleRequest(request, response, state) {
  const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
  const pathname = decodeURIComponent(requestUrl.pathname);

  if (request.method === "GET" && pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      version: HELPER_VERSION,
      capabilities: {
        sourceCandidates: true,
        plainFileStream: true,
        safeContentDisposition: true
      }
    });
    return;
  }

  if (request.method === "POST" && pathname === "/resolve-strm") {
    if (!state.allowResolve) {
      sendJson(response, 404, { ok: false, message: "当前辅助服务未开放 STRM 解析接口。" });
      return;
    }
    if (!isAuthorized(request, requestUrl, state.token)) {
      sendJson(response, 401, { ok: false, message: "辅助服务令牌无效。" });
      return;
    }

    const body = await readJsonBody(request);
    const sourceCandidates = normalizeSourceCandidates(body);
    if (!sourceCandidates.length) {
      sendJson(response, 400, { ok: false, message: "缺少媒体源路径。" });
      return;
    }

    const mappings = normalizeMappings(body.mappings || body.pathMappings || []);
    const base = state.publicBaseUrl || requestBaseUrl(request);
    const failures = [];
    for (const candidate of sourceCandidates) {
      try {
        const resolved = /\.strm$/i.test(candidate.path)
          ? await state.controller.resolveStrmPath(candidate.path, mappings, base)
          : await resolvePlainFileOrUrl(candidate.path, mappings, state.controller, base);

        sendJson(response, 200, { ok: true, ...resolved, sourceKind: candidate.kind, sourcePath: candidate.path });
        return;
      } catch (error) {
        failures.push(`${candidate.kind}:${candidate.path} -> ${error.message}`);
      }
    }

    throw new Error(`所有候选路径都解析失败：${failures.join(" | ")}`);
    return;
  }

  const streamMatch = pathname.match(/^\/stream\/([^/]+)/);
  if ((request.method === "GET" || request.method === "HEAD") && streamMatch) {
    if (!isAuthorized(request, requestUrl, state.token)) {
      sendJson(response, 401, { ok: false, message: "辅助服务令牌无效。" });
      return;
    }

    cleanupRegistry(state.registry, state.registryTtlMs);
    const entry = state.registry.get(streamMatch[1]);
    if (!entry) {
      sendJson(response, 404, { ok: false, message: "流地址已失效，请重新播放。" });
      return;
    }
    await serveFile(request, response, entry.filePath, entry.name, state.logger);
    return;
  }

  sendJson(response, 404, { ok: false, message: "辅助服务路径不存在。" });
}

async function resolvePlainFileOrUrl(sourcePath, mappings, controller, baseOverride) {
  if (isRemoteStreamTarget(sourcePath)) {
    return { kind: "helper-url", target: sourcePath };
  }

  const target = applyPathMappings(sourcePath, mappings);
  const stat = await fsp.stat(target);
  if (!stat.isFile()) {
    throw new Error(`目标不是文件：${target}`);
  }
  return {
    kind: "helper-stream",
    target: controller.registerFile(target, { name: basenameForDisplay(target) }, baseOverride)
  };
}

async function serveFile(request, response, filePath, displayName, logger = () => {}) {
  const stat = await fsp.stat(filePath);
  if (!stat.isFile()) {
    sendJson(response, 404, { ok: false, message: "目标文件不存在。" });
    return;
  }

  const size = stat.size;
  const range = parseRange(request.headers.range, size);
  const commonHeaders = streamHeaders(filePath, displayName || basenameForDisplay(filePath));
  logger("stream-response", {
    filePath,
    size,
    contentDisposition: commonHeaders["Content-Disposition"] || ""
  });

  if (range?.invalid) {
    writeHeadSafe(response, 416, {
      ...commonHeaders,
      "Content-Range": `bytes */${size}`
    });
    response.end();
    return;
  }

  const start = range ? range.start : 0;
  const end = range ? range.end : Math.max(0, size - 1);
  const status = range ? 206 : 200;
  const headers = {
    ...commonHeaders,
    "Content-Length": Math.max(0, end - start + 1)
  };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;

  writeHeadSafe(response, status, headers, logger);
  if (request.method === "HEAD") {
    response.end();
    return;
  }

  fs.createReadStream(filePath, { start, end }).pipe(response);
}

function parseRange(header, size) {
  if (!header) return null;
  const match = String(header).match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return { invalid: true };

  let start;
  let end;
  if (match[1] === "" && match[2] === "") return { invalid: true };

  if (match[1] === "") {
    const suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return { invalid: true };
    start = Math.max(0, size - suffixLength);
    end = Math.max(0, size - 1);
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Number(match[2]);
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
    return { invalid: true };
  }
  return { start, end: Math.min(end, size - 1) };
}

async function readStrmTarget(strmPath, mappings = []) {
  const raw = await fsp.readFile(strmPath, "utf8");
  const line = raw
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry && !entry.startsWith("#"));
  if (!line) throw new Error(`STRM 文件为空：${strmPath}`);

  if (/^file:\/\//i.test(line)) {
    return fileURLToPath(line);
  }

  if (isRemoteStreamTarget(line)) {
    return line;
  }

  const mapped = applyPathMappings(line, mappings);
  if (path.isAbsolute(mapped)) return mapped;
  return path.resolve(path.dirname(strmPath), mapped);
}

function applyPathMappings(inputPath, mappings) {
  let value = String(inputPath || "");
  for (const mapping of normalizeMappings(mappings)) {
    const serverPrefix = normalizeComparablePath(mapping.serverPrefix);
    const current = normalizeComparablePath(value);
    if (current.toLowerCase().startsWith(serverPrefix.toLowerCase())) {
      const rest = value.slice(mapping.serverPrefix.length).replace(/^[/\\]+/, "");
      return path.join(mapping.clientPrefix, rest);
    }
  }
  return value;
}

function normalizeMappings(value) {
  if (typeof value === "string") {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [serverPrefix, clientPrefix] = line.split(/\s*=>\s*/);
        return { serverPrefix: serverPrefix || "", clientPrefix: clientPrefix || "" };
      })
      .filter((mapping) => mapping.serverPrefix && mapping.clientPrefix);
  }
  if (!Array.isArray(value)) return [];
  return value
    .map((mapping) => ({
      serverPrefix: String(mapping.serverPrefix || "").trim(),
      clientPrefix: String(mapping.clientPrefix || "").trim()
    }))
    .filter((mapping) => mapping.serverPrefix && mapping.clientPrefix);
}

function normalizeSourceCandidates(body) {
  const rawCandidates = [];
  if (Array.isArray(body.sourceCandidates)) {
    for (const entry of body.sourceCandidates) {
      if (typeof entry === "string") {
        rawCandidates.push({ kind: "candidate", path: entry });
      } else if (entry && typeof entry === "object") {
        rawCandidates.push({
          kind: String(entry.kind || entry.name || "candidate"),
          path: entry.path || entry.value || ""
        });
      }
    }
  }

  rawCandidates.push(
    { kind: "strmPath", path: body.strmPath || "" },
    { kind: "mediaPath", path: body.mediaPath || "" },
    { kind: "itemPath", path: body.itemPath || "" },
    { kind: "path", path: body.path || "" }
  );

  const seen = new Set();
  return rawCandidates
    .map((entry) => ({
      kind: String(entry.kind || "candidate").replace(/[^a-zA-Z0-9_.-]/g, "") || "candidate",
      path: String(entry.path || "").trim()
    }))
    .filter((entry) => {
      const key = entry.path.toLowerCase();
      if (!entry.path || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeComparablePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
}

function isRemoteStreamTarget(value) {
  const text = String(value || "").trim();
  if (/^file:\/\//i.test(text)) return false;
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(text);
}

function cleanupRegistry(registry, ttlMs) {
  const expiresBefore = Date.now() - ttlMs;
  for (const [id, entry] of registry) {
    if (entry.createdAt < expiresBefore) registry.delete(id);
  }
}

function isAuthorized(request, requestUrl, token) {
  if (!token) return true;
  const auth = String(request.headers.authorization || "");
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  const headerToken = String(request.headers["x-jep-token"] || "");
  const queryToken = requestUrl.searchParams.get("token") || "";
  return [bearer, headerToken, queryToken].some((candidate) => constantTimeEquals(candidate, token));
}

function constantTimeEquals(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function requestBaseUrl(request) {
  const host = request.headers.host || "127.0.0.1";
  return `http://${host}`;
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BODY_BYTES) {
      throw new Error("请求体过大。");
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload)
  });
  response.end(payload);
}

function contentTypeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".mkv": "video/x-matroska",
    ".mp4": "video/mp4",
    ".m4v": "video/x-m4v",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".ts": "video/mp2t",
    ".m2ts": "video/mp2t",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac"
  };
  return types[ext] || "application/octet-stream";
}

function contentDisposition(filename) {
  const clean = sanitizeFilename(basenameForDisplay(filename));
  const fallback = asciiFallbackFilename(clean);
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987Value(clean)}`;
}

function sanitizeFilename(value) {
  return String(value || "video").replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
}

function basenameForDisplay(value) {
  const text = String(value || "video").replace(/[\\/]+$/, "");
  return text.split(/[\\/]/).pop() || "video";
}

function asciiFallbackFilename(value) {
  const clean = sanitizeFilename(value);
  const ext = path.extname(clean).replace(/[^A-Za-z0-9.]/g, "");
  const base = path
    .basename(clean, ext)
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_")
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "");
  return `${base || "video"}${ext || ""}`;
}

function encodeRfc5987Value(value) {
  return encodeURIComponent(value)
    .replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, "%2A");
}

function streamHeaders(filePath, displayName) {
  const headers = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Type": contentTypeForPath(filePath)
  };

  const disposition = contentDisposition(displayName);
  if (isValidHeaderValue(disposition)) {
    headers["Content-Disposition"] = disposition;
  }
  return headers;
}

function writeHeadSafe(response, statusCode, headers, logger = () => {}) {
  try {
    response.writeHead(statusCode, headers);
  } catch (error) {
    if (!headers["Content-Disposition"] || !/Content-Disposition/i.test(error.message || "")) {
      throw error;
    }

    const retryHeaders = { ...headers };
    delete retryHeaders["Content-Disposition"];
    logger("stream-omitted-unsafe-content-disposition", { error: error.message });
    response.writeHead(statusCode, retryHeaders);
  }
}

function isValidHeaderValue(value) {
  try {
    http.validateHeaderValue("Content-Disposition", value);
    return true;
  } catch {
    return false;
  }
}

function normalizePort(value) {
  const port = Number(value || 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return 0;
  return port;
}

module.exports = {
  startStrmHelperServer,
  readStrmTarget,
  applyPathMappings,
  isRemoteStreamTarget,
  normalizeMappings
};
