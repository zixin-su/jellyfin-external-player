const { app, BrowserWindow, Menu, dialog, ipcMain, shell, session, net } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const { spawn } = require("child_process");
const {
  startStrmHelperServer,
  readStrmTarget,
  applyPathMappings,
  isRemoteStreamTarget
} = require("./strm-helper-server");

const APP_ROOT = path.resolve(__dirname, "..");
const RUNTIME_ROOT = app.isPackaged ? path.dirname(process.execPath) : APP_ROOT;
const DATA_ROOT = path.join(RUNTIME_ROOT, "data");
const CACHE_ROOT = path.join(RUNTIME_ROOT, "cache");
const SETTINGS_PATH = path.join(DATA_ROOT, "settings.json");
const LOG_PATH = path.join(DATA_ROOT, "playback.log");

app.setPath("userData", DATA_ROOT);
app.setPath("cache", CACHE_ROOT);
app.setPath("sessionData", path.join(DATA_ROOT, "session"));
app.setPath("logs", path.join(DATA_ROOT, "logs"));
app.setPath("crashDumps", path.join(DATA_ROOT, "crashDumps"));

const DEFAULT_SETTINGS = {
  serverUrl: "",
  allowInsecureTls: false,
  externalPlayerPath: "",
  playerArgs: "{url}",
  interceptPlayback: true,
  playbackMode: "jellyfin-stream",
  preferJellyfinStream: true,
  preferStrmTarget: true,
  preferLocalFiles: false,
  invertWheelScroll: false,
  enableLocalStreamProxy: false,
  localStreamProxyPort: 0,
  strmHelperUrl: "",
  strmHelperToken: "",
  strmPathMappings: []
};

let mainWindow;
let settingsWindow;
let localStreamProxy;
let sessionFlushTimer;
let quitInProgress = false;
let lastLaunch = { key: "", at: 0 };
const ZOOM_STEP = 0.1;
const MIN_ZOOM_FACTOR = 0.5;
const MAX_ZOOM_FACTOR = 3;
const SESSION_FLUSH_INTERVAL_MS = 30000;
const HELPER_REQUEST_TIMEOUT_MS = 3500;

async function ensureDataDirs() {
  await fsp.mkdir(DATA_ROOT, { recursive: true });
  await fsp.mkdir(CACHE_ROOT, { recursive: true });
}

async function loadSettings() {
  await ensureDataDirs();
  try {
    const raw = await fsp.readFile(SETTINGS_PATH, "utf8");
    return normalizeSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings(settings) {
  await ensureDataDirs();
  const next = normalizeSettings({ ...DEFAULT_SETTINGS, ...settings });
  await fsp.writeFile(SETTINGS_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}

function normalizeSettings(settings) {
  const next = { ...settings };
  next.serverUrl = normalizeServerUrl(next.serverUrl);
  next.allowInsecureTls = Boolean(next.allowInsecureTls);
  next.externalPlayerPath = String(next.externalPlayerPath || "").trim();
  next.playerArgs = String(next.playerArgs || "{url}").trim() || "{url}";
  next.interceptPlayback = Boolean(next.interceptPlayback);
  next.playbackMode = normalizePlaybackMode(next.playbackMode);
  next.preferJellyfinStream = next.playbackMode === "jellyfin-stream";
  next.preferStrmTarget = next.playbackMode !== "jellyfin-stream";
  next.preferLocalFiles = next.playbackMode === "media-path";
  next.invertWheelScroll = Boolean(next.invertWheelScroll);
  next.enableLocalStreamProxy = false;
  next.localStreamProxyPort = normalizePort(next.localStreamProxyPort);
  next.strmHelperUrl = normalizeServerUrl(next.strmHelperUrl);
  next.strmHelperToken = String(next.strmHelperToken || "").trim();
  next.strmPathMappings = normalizeMappings(next.strmPathMappings);
  return next;
}

function normalizePlaybackMode(value) {
  const mode = String(value || "").trim();
  if (["jellyfin-stream", "media-path", "helper"].includes(mode)) return mode;
  return "jellyfin-stream";
}

function normalizePort(value) {
  const port = Number(value || 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return 0;
  return port;
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
      .filter((m) => m.serverPrefix && m.clientPrefix);
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((m) => ({
      serverPrefix: String(m.serverPrefix || "").trim(),
      clientPrefix: String(m.clientPrefix || "").trim()
    }))
    .filter((m) => m.serverPrefix && m.clientPrefix);
}

function normalizeServerUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw.includes("://") ? raw : `${inferDefaultProtocol(raw)}://${raw}`);
    if (!["http:", "https:"].includes(url.protocol)) {
      return raw;
    }
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw;
  }
}

function inferDefaultProtocol(value) {
  const host = String(value || "").split(/[/?#]/, 1)[0].replace(/^\[|\]$/g, "");
  if (/:(?:8096|8097)$/i.test(host)) return "http";
  if (/^(localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|192\.168(?:\.\d{1,3}){2})(?::\d+)?$/i.test(host)) {
    return "http";
  }
  return "https";
}

function jellyfinUrl(serverUrl, relativePath) {
  const normalized = normalizeServerUrl(serverUrl);
  if (!normalized) throw new Error("Jellyfin 服务地址无效。");
  return new URL(String(relativePath || "").replace(/^\/+/, ""), `${normalized.replace(/\/+$/, "")}/`);
}

function installCertificateHandling() {
  app.on("certificate-error", (event, _webContents, url, error, certificate, callback) => {
    event.preventDefault();
    loadSettings()
      .then((settings) => {
        if (!shouldAllowInsecureCertificateUrl(url, settings)) {
          callback(false);
          return;
        }

        appendLog("insecure-certificate-allowed", {
          url: redactSecrets(url),
          error,
          issuer: certificate?.issuerName || "",
          subject: certificate?.subjectName || ""
        }).catch(() => {});
        callback(true);
      })
      .catch(() => callback(false));
  });

  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    loadSettings()
      .then((settings) => {
        if (request.verificationResult === "OK") {
          callback(0);
          return;
        }
        if (shouldAllowInsecureCertificateHost(request.hostname, settings)) {
          appendLog("insecure-certificate-verified", {
            hostname: request.hostname,
            verificationResult: request.verificationResult,
            errorCode: request.errorCode,
            issuer: request.certificate?.issuerName || "",
            subject: request.certificate?.subjectName || ""
          }).catch(() => {});
          callback(0);
          return;
        }
        callback(-2);
      })
      .catch(() => callback(-2));
  });
}

function shouldAllowInsecureCertificateUrl(targetUrl, settings) {
  try {
    return shouldAllowInsecureCertificateHost(new URL(targetUrl).hostname, settings);
  } catch {
    return false;
  }
}

function shouldAllowInsecureCertificateHost(hostname, settings) {
  if (!settings?.allowInsecureTls) return false;
  try {
    const configured = new URL(normalizeServerUrl(settings.serverUrl));
    if (configured.protocol !== "https:") return false;
    return String(hostname || "").toLowerCase() === configured.hostname.toLowerCase();
  } catch {
    return false;
  }
}

async function appendLog(message, extra) {
  await ensureDataDirs();
  const line = JSON.stringify({
    at: new Date().toISOString(),
    message,
    ...(extra || {})
  });
  await fsp.appendFile(LOG_PATH, `${line}\n`, "utf8");
}

async function ensureLocalStreamProxy(settings) {
  if (!settings.enableLocalStreamProxy) {
    await stopLocalStreamProxy();
    return null;
  }

  const requestedPort = normalizePort(settings.localStreamProxyPort);
  if (localStreamProxy && localStreamProxy.requestedPort === requestedPort) {
    return localStreamProxy;
  }

  await stopLocalStreamProxy();

  try {
    localStreamProxy = await startStrmHelperServer({
      host: "127.0.0.1",
      port: requestedPort,
      allowResolve: false,
      logger: (message, extra) => {
        appendLog("local-stream-proxy-log", { helperMessage: message, ...(extra || {}) }).catch(() => {});
      }
    });
    localStreamProxy.requestedPort = requestedPort;
    await appendLog("local-stream-proxy-started", {
      baseUrl: localStreamProxy.baseUrl,
      requestedPort
    });
    return localStreamProxy;
  } catch (error) {
    localStreamProxy = null;
    await appendLog("local-stream-proxy-start-failed", {
      error: error.message,
      requestedPort
    });
    return null;
  }
}

async function stopLocalStreamProxy() {
  const server = localStreamProxy;
  localStreamProxy = null;
  if (!server) return;
  await server.close();
  await appendLog("local-stream-proxy-stopped").catch(() => {});
}

function startSessionFlushTimer() {
  if (sessionFlushTimer) return;
  sessionFlushTimer = setInterval(() => {
    flushPersistentSession("interval").catch((error) => {
      appendLog("session-flush-failed", { reason: "interval", error: error.message }).catch(() => {});
    });
  }, SESSION_FLUSH_INTERVAL_MS);
  if (typeof sessionFlushTimer.unref === "function") sessionFlushTimer.unref();
}

function stopSessionFlushTimer() {
  if (!sessionFlushTimer) return;
  clearInterval(sessionFlushTimer);
  sessionFlushTimer = null;
}

async function flushPersistentSession(reason) {
  const activeSession = mainWindow?.webContents?.session || session.defaultSession;
  if (!activeSession) return;

  const tasks = [];
  if (activeSession.cookies && typeof activeSession.cookies.flushStore === "function") {
    tasks.push(activeSession.cookies.flushStore());
  }
  if (typeof activeSession.flushStorageData === "function") {
    tasks.push(activeSession.flushStorageData());
  }
  if (!tasks.length) return;

  await Promise.all(tasks);
  if (reason !== "interval") {
    await appendLog("session-flushed", { reason }).catch(() => {});
  }
}

async function createMainWindow() {
  const settings = await loadSettings();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: "Jellyfin 外部播放器",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.on("did-stop-loading", () => {
    flushPersistentSession("did-stop-loading").catch((error) => {
      appendLog("session-flush-failed", { reason: "did-stop-loading", error: error.message }).catch(() => {});
    });
  });
  installZoomShortcuts(mainWindow);

  await loadMainContent(settings.serverUrl);
}

function installZoomShortcuts(window) {
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !(input.control || input.meta)) return;

    const key = String(input.key || "").toLowerCase();
    const code = String(input.code || "").toLowerCase();
    const isZoomIn = ["+", "=", "numadd", "add"].includes(key) || ["equal", "numpadadd"].includes(code);
    const isZoomOut = ["-", "_", "numsub", "subtract"].includes(key) || ["minus", "numpadsubtract"].includes(code);
    const isReset = ["0", ")", "num0"].includes(key) || ["digit0", "numpad0"].includes(code);

    if (!isZoomIn && !isZoomOut && !isReset) return;

    event.preventDefault();
    if (isReset) {
      window.webContents.setZoomFactor(1);
      return;
    }
    adjustZoomFactor(window, isZoomIn ? ZOOM_STEP : -ZOOM_STEP);
  });
}

function adjustZoomFactor(window, delta) {
  const current = window.webContents.getZoomFactor();
  const next = Math.min(MAX_ZOOM_FACTOR, Math.max(MIN_ZOOM_FACTOR, current + delta));
  window.webContents.setZoomFactor(Math.round(next * 100) / 100);
}

function createMenu() {
  const template = [
    {
      label: "文件",
      submenu: [
        { label: "设置", accelerator: "CmdOrCtrl+,", click: () => openSettingsWindow() },
        {
          label: "打开 Jellyfin 服务",
          accelerator: "CmdOrCtrl+L",
          click: async () => {
            const settings = await loadSettings();
            if (settings.serverUrl && mainWindow) await mainWindow.loadURL(settings.serverUrl);
            else openSettingsWindow();
          }
        },
        { type: "separator" },
        { label: "退出", role: "quit" }
      ]
    },
    {
      label: "视图",
      submenu: [
        { label: "重新加载", role: "reload" },
        { label: "强制重新加载", role: "forceReload" },
        { label: "开发者工具", role: "toggleDevTools" },
        { type: "separator" },
        { label: "重置缩放", role: "resetZoom" },
        { label: "放大", role: "zoomIn" },
        { label: "缩小", role: "zoomOut" },
        { label: "全屏", role: "togglefullscreen" }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 760,
    height: 840,
    minWidth: 680,
    minHeight: 560,
    title: "设置",
    parent: mainWindow || undefined,
    modal: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
  settingsWindow.loadFile(path.join(__dirname, "settings.html"));
}

ipcMain.handle("settings:get", async () => loadSettings());

ipcMain.handle("settings:save", async (_event, settings) => {
  const saved = await saveSettings(settings);
  setImmediate(() => {
    applySavedSettings(saved).catch((error) => {
      appendLog("apply-settings-failed", { error: error.message }).catch(() => {});
    });
  });
  return saved;
});

ipcMain.handle("dialog:choose-player", async () => {
  const result = await dialog.showOpenDialog(settingsWindow || mainWindow, {
    title: "选择外部播放器",
    properties: ["openFile"],
    filters: [
      { name: "可执行文件", extensions: ["exe", "bat", "cmd"] },
      { name: "所有文件", extensions: ["*"] }
    ]
  });
  return result.canceled ? "" : result.filePaths[0];
});

ipcMain.handle("app:open-settings", () => {
  openSettingsWindow();
});

ipcMain.handle("app:open-data-folder", async () => {
  await ensureDataDirs();
  shell.openPath(DATA_ROOT);
});

ipcMain.handle("navigation:load-server", async (_event, serverUrl) => {
  const settings = await loadSettings();
  const saved = await saveSettings({ ...settings, serverUrl });
  const loaded = await loadMainContent(saved.serverUrl);
  if (!loaded) {
    sendMainToast("Jellyfin 服务地址无法打开，请检查设置。", true);
  }
  return saved;
});

async function applySavedSettings(saved) {
  await ensureLocalStreamProxy(saved);
  await flushPersistentSession("settings-save").catch((error) => {
    appendLog("session-flush-failed", { reason: "settings-save", error: error.message }).catch(() => {});
  });

  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close();
  }

  const loaded = await loadMainContent(saved.serverUrl);
  if (!saved.serverUrl) {
    sendMainToast("设置已保存，请继续配置 Jellyfin 服务地址。", true);
  } else if (loaded) {
    sendMainToast("设置已保存。");
  } else {
    sendMainToast("设置已保存，但 Jellyfin 服务地址无法打开，请检查设置。", true);
  }
}

async function loadMainContent(serverUrl) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;

  const normalized = normalizeServerUrl(serverUrl);
  if (!normalized) {
    await mainWindow.loadFile(path.join(__dirname, "home.html"));
    return false;
  }

  try {
    await mainWindow.loadURL(normalized);
    return true;
  } catch (error) {
    await appendLog("server-load-failed", { serverUrl: normalized, error: error.message });
    await mainWindow.loadFile(path.join(__dirname, "home.html"));
    return false;
  }
}

function sendMainToast(message, isError = false) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("app:toast", { message, isError });
}

ipcMain.handle("playback:external", async (event, payload) => {
  const settings = await loadSettings();
  if (!settings.externalPlayerPath) {
    openSettingsWindow();
    return { ok: false, message: "未配置外部播放器路径。" };
  }
  if (!fs.existsSync(settings.externalPlayerPath)) {
    openSettingsWindow();
    return { ok: false, message: "外部播放器文件不存在。" };
  }

  const pageUrl = payload.pageUrl || event.senderFrame?.url || "";
  const itemId = String(payload.itemId || "").trim();
  const dedupeKey = `${itemId}|${payload.videoSrc || ""}`;
  const now = Date.now();
  if (dedupeKey && lastLaunch.key === dedupeKey && now - lastLaunch.at < 4000) {
    return { ok: true, skipped: true, message: "已跳过重复播放请求。" };
  }
  lastLaunch = { key: dedupeKey, at: now };

  try {
    const resolved = await resolvePlaybackTarget({ ...payload, pageUrl }, settings);
    const args = buildPlayerArgs(settings.playerArgs, resolved.target, {
      itemId: resolved.itemId || itemId,
      title: resolved.title || payload.title || ""
    });
    const child = spawn(settings.externalPlayerPath, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    child.unref();
    await appendLog("external-player-launched", {
      player: settings.externalPlayerPath,
      args: args.map(redactSecrets),
      targetKind: resolved.kind,
      itemId: resolved.itemId || itemId,
      requestedItemId: itemId,
      title: resolved.title,
      target: redactSecrets(resolved.target)
    });
    return {
      ok: true,
      message: "已打开外部播放器。",
      kind: resolved.kind,
      target: resolved.target,
      title: resolved.title
    };
  } catch (error) {
    await appendLog("external-player-failed", { error: error.message, payload: sanitizeForLog(payload) });
    return { ok: false, message: error.message };
  }
});

async function resolvePlaybackTarget(payload, settings) {
  const itemId = String(payload.itemId || "").trim();
  const token = String(payload.token || payload.accessToken || "").trim();
  const serverUrl = normalizeServerUrl(payload.serverUrl || jellyfinBaseFromPageUrl(payload.pageUrl));

  let requestedItem = null;
  let item = null;
  let mediaSource = null;
  let playbackInfo = null;
  let playableKind = "direct";
  if (itemId && serverUrl && token) {
    requestedItem = await getJellyfinItem(serverUrl, itemId, token, payload.userId);
    const playable = await resolvePlayableJellyfinItem(serverUrl, requestedItem, token, payload.userId);
    item = playable.item || requestedItem;
    playableKind = playable.kind || "direct";
    playbackInfo = await getJellyfinPlaybackInfo(serverUrl, item.Id || itemId, token, payload.userId).catch(() => null);
    mediaSource = bestMediaSource(playbackInfo, item);
  }

  const playableItemId = item?.Id || itemId;
  const title = formatPlayableTitle(requestedItem, item, payload.title || "");
  const itemPath = item?.Path || "";
  const mediaPath = mediaSource?.Path || "";
  const mediaContainer = cleanExtension(mediaSource?.Container || "");
  const mappedItemPath = itemPath ? applyPathMappings(itemPath, settings.strmPathMappings) : "";
  const mappedMediaPath = mediaPath ? applyPathMappings(mediaPath, settings.strmPathMappings) : "";
  const isStrmMediaSource = /\.strm$/i.test(itemPath) || /\.strm$/i.test(mediaPath) || mediaContainer.toLowerCase() === "strm";
  const context = {
    serverUrl,
    token,
    mediaSource,
    playableItemId,
    playableKind,
    title,
    itemPath,
    mediaPath,
    mappedItemPath,
    mappedMediaPath,
    isStrmMediaSource,
    settings
  };

  if (settings.playbackMode === "jellyfin-stream") {
    return resolveJellyfinStreamMode(context, "jellyfin-stream-selected");
  }

  if (settings.playbackMode === "media-path") {
    return resolveMediaPathMode(context);
  }

  if (settings.playbackMode === "helper") {
    return resolveHelperMode(context);
  }

  if (payload.videoSrc) {
    return { kind: "web-video-src", target: payload.videoSrc, title, itemId: playableItemId };
  }

  throw new Error("无法为该 Jellyfin 项目解析可播放的地址或路径。");
}

async function resolveJellyfinStreamMode(context, kind) {
  const fallback = await buildJellyfinStreamFallback({
    serverUrl: context.serverUrl,
    playableItemId: context.playableItemId,
    token: context.token,
    mediaSource: context.mediaSource,
    title: context.title,
    playableKind: context.playableKind,
    kind,
    reason: "selected-playback-mode"
  });
  if (fallback) return fallback;
  throw new Error("无法生成 Jellyfin 流地址，请确认当前已登录 Jellyfin。");
}

async function resolveMediaPathMode(context) {
  const direct = await resolveStrmPlaybackTarget(context);
  if (direct) return direct;

  const mediaCandidates = [
    { path: context.mappedMediaPath, kind: "media-source-path" },
    { path: context.mappedItemPath, kind: "item-path" }
  ].filter((entry) => entry.path && !/\.strm$/i.test(entry.path));

  for (const candidate of mediaCandidates) {
    const target = await maybeUseDirectLocalTarget(candidate.path);
    if (target) {
      return {
        kind: `${candidate.kind}:${context.playableKind}`,
        target,
        title: context.title,
        itemId: context.playableItemId
      };
    }
  }

  throw new Error("媒体文件路径模式未解析到可播放路径。请检查 Jellyfin 媒体路径、STRM 路径映射和本机访问权限。");
}

async function resolveHelperMode(context) {
  if (!context.settings.strmHelperUrl) {
    throw new Error("已选择走辅助服务，但未配置 NAS 辅助服务地址。");
  }

  const helperTarget = await resolveStrmViaRemoteHelper(
    {
      strmPath: context.mediaPath || context.itemPath,
      mediaPath: context.mediaPath,
      itemPath: context.itemPath,
      sourceCandidates: buildHelperSourceCandidates(context),
      itemId: context.playableItemId,
      title: context.title,
      pathMappings: context.settings.strmPathMappings
    },
    context.settings
  );

  if (helperTarget?.fallbackToJellyfin) {
    return resolveJellyfinStreamMode(context, "jellyfin-stream-helper-unavailable");
  }

  if (helperTarget) {
    return {
      kind: `${helperTarget.kind}:${context.playableKind}`,
      target: helperTarget.target,
      title: context.title,
      itemId: context.playableItemId
    };
  }

  throw new Error("辅助服务未返回可播放地址。");
}

function buildHelperSourceCandidates(context) {
  const entries = [
    { kind: "mediaPath", path: context.mediaPath },
    { kind: "itemPath", path: context.itemPath }
  ];
  const seen = new Set();
  return entries
    .map((entry) => ({
      kind: entry.kind,
      path: String(entry.path || "").trim()
    }))
    .filter((entry) => {
      const key = entry.path.toLowerCase();
      if (!entry.path || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function resolveStrmPlaybackTarget(context) {
  const {
    mappedItemPath,
    mappedMediaPath,
    playableItemId,
    playableKind,
    title,
    settings
  } = context;

  if (mappedMediaPath && !/\.strm$/i.test(mappedMediaPath)) {
    const target = await maybeUseDirectLocalTarget(mappedMediaPath);
    if (target) return { kind: `jellyfin-media-source-path:${playableKind}`, target, title, itemId: playableItemId };
  }

  const strmPath = [mappedMediaPath, mappedItemPath].find((candidate) => /\.strm$/i.test(candidate || "") && fs.existsSync(candidate));
  if (strmPath) {
    const strmTarget = await readStrmTarget(strmPath, settings.strmPathMappings);
    const target = await maybeUseDirectLocalTarget(strmTarget);
    if (target) return { kind: `local-strm-target:${playableKind}`, target, title, itemId: playableItemId };
  }

  return null;
}

async function maybeUseDirectLocalTarget(target) {
  const value = String(target || "").trim();
  if (!value || isRemoteStreamTarget(value)) return value;

  let stat = null;
  try {
    stat = await fsp.stat(value);
  } catch (error) {
    await appendLog("local-target-unavailable", {
      target: value,
      error: error.message
    });
    return "";
  }
  if (!stat.isFile()) return "";
  return value;
}

async function buildJellyfinStreamFallback(options) {
  const { serverUrl, playableItemId, token, mediaSource, title, playableKind, kind, reason } = options;
  if (!playableItemId || !serverUrl || !token) return null;

  const streamUrl = buildJellyfinStreamUrl(serverUrl, playableItemId, token, mediaSource);
  await appendLog("jellyfin-stream-fallback", {
    itemId: playableItemId,
    kind,
    reason,
    target: redactSecrets(streamUrl)
  }).catch(() => {});
  return {
    kind: `${kind}:${playableKind}`,
    target: streamUrl,
    title,
    itemId: playableItemId
  };
}

async function resolveStrmViaRemoteHelper(payload, settings) {
  if (!settings.strmHelperUrl || !hasHelperSourceCandidate(payload)) return null;

  const url = new URL("./resolve-strm", `${settings.strmHelperUrl.replace(/\/+$/, "")}/`);
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json"
  };
  if (settings.strmHelperToken) {
    headers["X-Jep-Token"] = settings.strmHelperToken;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HELPER_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const error = new Error(`HTTP ${response.status}${text ? `：${text.slice(0, 300)}` : ""}`);
      error.helperStatus = response.status;
      throw error;
    }

    const data = await response.json();
    if (!data?.ok || !data.target) {
      throw new Error(data?.message || "辅助服务没有返回播放地址。");
    }
    await appendLog("remote-strm-helper-resolved", {
      helperUrl: settings.strmHelperUrl,
      itemId: payload.itemId,
      kind: data.kind,
      sourceKind: data.sourceKind,
      target: redactSecrets(data.target)
    }).catch(() => {});
    return {
      kind: data.kind || "strm-helper",
      target: data.target
    };
  } catch (error) {
    const canFallback = isHelperUnavailableError(error);
    await appendLog(canFallback ? "remote-strm-helper-unavailable" : "remote-strm-helper-failed", {
      helperUrl: settings.strmHelperUrl,
      itemId: payload.itemId,
      error: error.message,
      fallbackToJellyfin: canFallback
    });
    if (canFallback) {
      return {
        fallbackToJellyfin: true,
        reason: error.message
      };
    }
    throw new Error(`NAS 辅助服务解析 STRM 失败：${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function hasHelperSourceCandidate(payload) {
  const candidates = Array.isArray(payload.sourceCandidates) ? payload.sourceCandidates : [];
  return candidates.some((entry) => String(entry?.path || entry || "").trim()) ||
    Boolean(String(payload.strmPath || payload.mediaPath || payload.itemPath || payload.path || "").trim());
}

function isHelperUnavailableError(error) {
  const status = Number(error?.helperStatus || 0);
  if ([404, 502, 503, 504].includes(status)) return true;
  if (error?.name === "AbortError") return true;

  const code = String(error?.cause?.code || error?.code || "");
  if (["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "ECONNRESET"].includes(code)) {
    return true;
  }

  return /fetch failed|failed to fetch|network|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ECONNRESET/i.test(
    `${error?.message || ""} ${code}`
  );
}

async function resolvePlayableJellyfinItem(serverUrl, item, token, userId) {
  if (!item?.Id || isPlayableJellyfinItem(item)) {
    return { item, kind: "direct" };
  }

  const type = String(item.Type || "").toLowerCase();
  if (type === "series") {
    const nextUp = await getNextUpEpisode(serverUrl, item.Id, token, userId).catch(() => null);
    if (nextUp) return { item: nextUp, kind: "series-next-up" };

    const firstEpisode = await getFirstEpisode(serverUrl, item.Id, token, userId).catch(() => null);
    if (firstEpisode) return { item: firstEpisode, kind: "series-first-episode" };
  }

  if (type === "season") {
    const seasonEpisode = await getSeasonEpisode(serverUrl, item, token, userId).catch(() => null);
    if (seasonEpisode) return { item: seasonEpisode, kind: "season-episode" };
  }

  return { item, kind: type || "container" };
}

function isPlayableJellyfinItem(item) {
  const type = String(item?.Type || "").toLowerCase();
  if (["movie", "episode", "video", "musicvideo", "trailer"].includes(type)) return true;
  return String(item?.MediaType || "").toLowerCase() === "video" && !["series", "season", "folder"].includes(type);
}

async function getNextUpEpisode(serverUrl, seriesId, token, userId) {
  const url = jellyfinUrl(serverUrl, "Shows/NextUp");
  if (userId) url.searchParams.set("UserId", userId);
  url.searchParams.set("SeriesId", seriesId);
  url.searchParams.set("Limit", "1");
  url.searchParams.set("Fields", "MediaSources,Path,UserData,SeriesInfo");

  const data = await getJellyfinJson(url, token);
  return pickEpisodeCandidate(data?.Items || []);
}

async function getFirstEpisode(serverUrl, seriesId, token, userId) {
  const episodes = await getShowEpisodes(serverUrl, seriesId, token, userId);
  return pickEpisodeCandidate(episodes);
}

async function getSeasonEpisode(serverUrl, season, token, userId) {
  const seriesId = season.SeriesId || season.ParentId;
  if (!seriesId) return null;

  const episodes = await getShowEpisodes(serverUrl, seriesId, token, userId, season.Id);
  return pickEpisodeCandidate(episodes);
}

async function getShowEpisodes(serverUrl, seriesId, token, userId, seasonId = "") {
  const url = jellyfinUrl(serverUrl, `Shows/${encodeURIComponent(seriesId)}/Episodes`);
  if (userId) url.searchParams.set("UserId", userId);
  if (seasonId) url.searchParams.set("seasonId", seasonId);
  url.searchParams.set("Fields", "MediaSources,Path,UserData,SeriesInfo");
  url.searchParams.set("SortBy", "ParentIndexNumber,IndexNumber");
  url.searchParams.set("SortOrder", "Ascending");

  const data = await getJellyfinJson(url, token);
  return Array.isArray(data?.Items) ? data.Items : [];
}

function pickEpisodeCandidate(items) {
  const episodes = (Array.isArray(items) ? items : []).filter(isPlayableJellyfinItem);
  return episodes.find(hasResumePosition) || episodes.find(isUnplayed) || episodes[0] || null;
}

function hasResumePosition(item) {
  const userData = item?.UserData || {};
  return Number(userData.PlaybackPositionTicks || 0) > 0 && !userData.Played;
}

function isUnplayed(item) {
  return !item?.UserData?.Played;
}

function formatPlayableTitle(requestedItem, playableItem, fallback) {
  if (!playableItem?.Name) return fallback;
  if (!requestedItem?.Id || requestedItem.Id === playableItem.Id) return playableItem.Name;

  const seriesName = playableItem.SeriesName || requestedItem.Name || "";
  const season = Number(playableItem.ParentIndexNumber || 0);
  const episode = Number(playableItem.IndexNumber || 0);
  const episodeCode = season || episode ? `S${String(season || 0).padStart(2, "0")}E${String(episode || 0).padStart(2, "0")}` : "";
  return [seriesName, episodeCode, playableItem.Name].filter(Boolean).join(" - ");
}

async function getJellyfinItem(serverUrl, itemId, token, userId) {
  const headers = {
    "X-Emby-Token": token,
    Accept: "application/json"
  };
  const urls = [
    userId ? jellyfinUrl(serverUrl, `Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(itemId)}`).toString() : "",
    jellyfinUrl(serverUrl, `Items/${encodeURIComponent(itemId)}`).toString()
  ].filter(Boolean);

  let lastError = null;
  for (const url of urls) {
    try {
      const response = await jellyfinFetch(url, { headers });
      if (response.ok) return response.json();
      lastError = new Error(`Jellyfin API ${response.status} for ${url}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("无法加载 Jellyfin 项目元数据。");
}

async function getJellyfinJson(url, token) {
  const response = await jellyfinFetch(url.toString(), {
    headers: {
      "X-Emby-Token": token,
      Accept: "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`Jellyfin API 请求失败：${response.status} ${url}`);
  }
  return response.json();
}

function firstMediaSource(item) {
  return Array.isArray(item?.MediaSources) && item.MediaSources.length ? item.MediaSources[0] : null;
}

function bestMediaSource(playbackInfo, item) {
  const sources = [
    ...(Array.isArray(playbackInfo?.MediaSources) ? playbackInfo.MediaSources : []),
    ...(Array.isArray(item?.MediaSources) ? item.MediaSources : [])
  ];
  return (
    sources.find((source) => source?.Path && !/\.strm$/i.test(source.Path)) ||
    sources.find((source) => source?.Path) ||
    sources[0] ||
    null
  );
}

async function getJellyfinPlaybackInfo(serverUrl, itemId, token, userId) {
  const url = jellyfinUrl(serverUrl, `Items/${encodeURIComponent(itemId)}/PlaybackInfo`);
  if (userId) url.searchParams.set("UserId", userId);
  const response = await jellyfinFetch(url.toString(), {
    method: "POST",
    headers: {
      "X-Emby-Token": token,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });
  if (!response.ok) {
    throw new Error(`Jellyfin PlaybackInfo API 请求失败：${response.status}`);
  }
  return response.json();
}

function jellyfinFetch(url, options) {
  return net.fetch(url.toString(), options);
}

function buildJellyfinStreamUrl(serverUrl, itemId, token, mediaSource) {
  const container = cleanExtension(mediaSource?.Container || extensionFromPath(mediaSource?.Path) || "mp4");
  const url = jellyfinUrl(serverUrl, `Videos/${encodeURIComponent(itemId)}/stream.${container}`);
  url.searchParams.set("static", "true");
  if (mediaSource?.Id) url.searchParams.set("mediaSourceId", mediaSource.Id);
  url.searchParams.set("api_key", token);
  return url.toString();
}

function isJellyfinStrmStreamUrl(value) {
  try {
    return /\.strm$/i.test(new URL(value).pathname);
  } catch {
    return /\.strm(?:[?#]|$)/i.test(String(value || ""));
  }
}

function cleanExtension(value) {
  return String(value || "mp4").split(",")[0].replace(/^\./, "").replace(/[^a-zA-Z0-9]/g, "") || "mp4";
}

function extensionFromPath(value) {
  const ext = path.extname(String(value || "")).replace(/^\./, "");
  return ext || "";
}

function jellyfinBaseFromPageUrl(value) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^(.*?)\/web(?:\/|$)/i);
    url.pathname = match ? match[1] || "" : "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function sanitizeForLog(value) {
  if (typeof value === "string") return redactSecrets(value);
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sanitizeForLog);

  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/token|api[_-]?key|authorization|password/i.test(key)) {
      result[key] = "[redacted]";
    } else {
      result[key] = sanitizeForLog(entry);
    }
  }
  return result;
}

function redactSecrets(value) {
  const text = String(value || "");
  return text
    .replace(/([?&](?:api_key|apiKey|token|access_token|X-Emby-Token)=)[^&#\s]+/gi, "$1[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, "$1[redacted]");
}

function buildPlayerArgs(template, target, item) {
  const base = String(template || "{url}").trim();
  const withPlaceholder = base.includes("{url}") || base.includes("{path}") || base.includes("{itemId}") || base.includes("{title}");
  const expanded = (withPlaceholder ? base : `${base} {url}`)
    .replaceAll("{url}", quoteArg(target))
    .replaceAll("{path}", quoteArg(target))
    .replaceAll("{itemId}", quoteArg(item.itemId || ""))
    .replaceAll("{title}", quoteArg(item.title || ""));
  return splitCommandLine(expanded);
}

function quoteArg(value) {
  const raw = String(value || "");
  if (!raw) return "\"\"";
  if (/[\s"]/u.test(raw)) {
    return `"${raw.replace(/"/g, '\\"')}"`;
  }
  return raw;
}

function splitCommandLine(commandLine) {
  const args = [];
  let current = "";
  let quoted = false;
  for (const ch of commandLine) {
    if (ch === "\"") {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(ch)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current) args.push(current);
  return args;
}

app.whenReady().then(async () => {
  await ensureDataDirs();
  installCertificateHandling();
  await ensureLocalStreamProxy(await loadSettings());
  startSessionFlushTimer();
  createMenu();
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (quitInProgress) return;

  event.preventDefault();
  quitInProgress = true;
  stopSessionFlushTimer();

  Promise.allSettled([flushPersistentSession("before-quit"), stopLocalStreamProxy()]).finally(() => {
    app.quit();
  });
});
