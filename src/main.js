const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const { spawn } = require("child_process");

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
  externalPlayerPath: "",
  playerArgs: "{url}",
  interceptPlayback: true,
  preferJellyfinStream: true,
  preferStrmTarget: true,
  preferLocalFiles: false,
  invertWheelScroll: true,
  strmPathMappings: []
};

let mainWindow;
let settingsWindow;
let lastLaunch = { key: "", at: 0 };
const ZOOM_STEP = 0.1;
const MIN_ZOOM_FACTOR = 0.5;
const MAX_ZOOM_FACTOR = 3;

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
  next.externalPlayerPath = String(next.externalPlayerPath || "").trim();
  next.playerArgs = String(next.playerArgs || "{url}").trim() || "{url}";
  next.interceptPlayback = Boolean(next.interceptPlayback);
  next.preferJellyfinStream = next.preferJellyfinStream !== false;
  next.preferStrmTarget = Boolean(next.preferStrmTarget);
  next.preferLocalFiles = Boolean(next.preferLocalFiles);
  next.invertWheelScroll = next.invertWheelScroll !== false;
  next.strmPathMappings = normalizeMappings(next.strmPathMappings);
  return next;
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
    const url = new URL(raw.includes("://") ? raw : `http://${raw}`);
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw;
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

async function createMainWindow() {
  const settings = await loadSettings();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: "Jellyfin External Player",
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
  installZoomShortcuts(mainWindow);

  if (settings.serverUrl) {
    await mainWindow.loadURL(settings.serverUrl);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "home.html"));
    openSettingsWindow();
  }
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
      label: "File",
      submenu: [
        { label: "Settings", accelerator: "CmdOrCtrl+,", click: () => openSettingsWindow() },
        {
          label: "Open Jellyfin Server",
          accelerator: "CmdOrCtrl+L",
          click: async () => {
            const settings = await loadSettings();
            if (settings.serverUrl && mainWindow) await mainWindow.loadURL(settings.serverUrl);
            else openSettingsWindow();
          }
        },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "togglefullscreen" }
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
    height: 720,
    minWidth: 680,
    minHeight: 560,
    title: "Settings",
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
  if (saved.serverUrl && mainWindow) {
    await mainWindow.loadURL(saved.serverUrl);
  }
  return saved;
});

ipcMain.handle("dialog:choose-player", async () => {
  const result = await dialog.showOpenDialog(settingsWindow || mainWindow, {
    title: "Choose external player",
    properties: ["openFile"],
    filters: [
      { name: "Executable", extensions: ["exe", "bat", "cmd"] },
      { name: "All Files", extensions: ["*"] }
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
  if (mainWindow) await mainWindow.loadURL(saved.serverUrl);
  return saved;
});

ipcMain.handle("playback:external", async (event, payload) => {
  const settings = await loadSettings();
  if (!settings.externalPlayerPath) {
    openSettingsWindow();
    return { ok: false, message: "External player path is not configured." };
  }
  if (!fs.existsSync(settings.externalPlayerPath)) {
    openSettingsWindow();
    return { ok: false, message: "External player executable does not exist." };
  }

  const pageUrl = payload.pageUrl || event.senderFrame?.url || "";
  const itemId = String(payload.itemId || "").trim();
  const dedupeKey = `${itemId}|${payload.videoSrc || ""}`;
  const now = Date.now();
  if (dedupeKey && lastLaunch.key === dedupeKey && now - lastLaunch.at < 4000) {
    return { ok: true, skipped: true, message: "Duplicate launch skipped." };
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
      args,
      targetKind: resolved.kind,
      itemId: resolved.itemId || itemId,
      requestedItemId: itemId,
      title: resolved.title
    });
    return {
      ok: true,
      message: "External player launched.",
      kind: resolved.kind,
      target: resolved.target,
      title: resolved.title
    };
  } catch (error) {
    await appendLog("external-player-failed", { error: error.message, payload });
    return { ok: false, message: error.message };
  }
});

async function resolvePlaybackTarget(payload, settings) {
  const itemId = String(payload.itemId || "").trim();
  const token = String(payload.token || payload.accessToken || "").trim();
  const serverUrl = normalizeServerUrl(payload.serverUrl || originFromUrl(payload.pageUrl));

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
  const mappedItemPath = itemPath ? applyPathMappings(itemPath, settings.strmPathMappings) : "";
  const mappedMediaPath = mediaPath ? applyPathMappings(mediaPath, settings.strmPathMappings) : "";
  const isStrm = settings.preferStrmTarget && /\.strm$/i.test(itemPath);

  if (settings.preferJellyfinStream && playableItemId && serverUrl && token) {
    const streamUrl = buildJellyfinStreamUrl(serverUrl, playableItemId, token, mediaSource);
    return { kind: `jellyfin-stream-preferred:${playableKind}`, target: streamUrl, title, itemId: playableItemId };
  }

  if (isStrm) {
    if (mappedMediaPath && !/\.strm$/i.test(mappedMediaPath)) {
      return { kind: `jellyfin-media-source-path:${playableKind}`, target: mappedMediaPath, title, itemId: playableItemId };
    }

    if (mappedItemPath && fs.existsSync(mappedItemPath)) {
      const target = await readStrmTarget(mappedItemPath, settings.strmPathMappings);
      return { kind: `local-strm-target:${playableKind}`, target, title, itemId: playableItemId };
    }

    if (playableItemId && serverUrl && token) {
      const streamUrl = buildJellyfinStreamUrl(serverUrl, playableItemId, token, mediaSource);
      return { kind: `jellyfin-stream-fallback:${playableKind}`, target: streamUrl, title, itemId: playableItemId };
    }
  }

  if (settings.preferLocalFiles && mappedItemPath && fs.existsSync(mappedItemPath)) {
    return { kind: `local-file:${playableKind}`, target: mappedItemPath, title, itemId: playableItemId };
  }

  if (settings.preferLocalFiles && mappedMediaPath && fs.existsSync(mappedMediaPath)) {
    return { kind: `media-source-local-file:${playableKind}`, target: mappedMediaPath, title, itemId: playableItemId };
  }

  if (playableItemId && serverUrl && token) {
    const streamUrl = buildJellyfinStreamUrl(serverUrl, playableItemId, token, mediaSource);
    return { kind: `jellyfin-stream:${playableKind}`, target: streamUrl, title, itemId: playableItemId };
  }

  if (payload.videoSrc) {
    return { kind: "web-video-src", target: payload.videoSrc, title, itemId: playableItemId };
  }

  throw new Error("Could not resolve a playable URL or path for this Jellyfin item.");
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
  const url = new URL(`${serverUrl}/Shows/NextUp`);
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
  const url = new URL(`${serverUrl}/Shows/${encodeURIComponent(seriesId)}/Episodes`);
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
    userId ? `${serverUrl}/Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(itemId)}` : "",
    `${serverUrl}/Items/${encodeURIComponent(itemId)}`
  ].filter(Boolean);

  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, { headers });
      if (response.ok) return response.json();
      lastError = new Error(`Jellyfin API ${response.status} for ${url}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Could not load Jellyfin item metadata.");
}

async function getJellyfinJson(url, token) {
  const response = await fetch(url.toString(), {
    headers: {
      "X-Emby-Token": token,
      Accept: "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`Jellyfin API ${response.status} for ${url}`);
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
  const url = new URL(`${serverUrl}/Items/${encodeURIComponent(itemId)}/PlaybackInfo`);
  if (userId) url.searchParams.set("UserId", userId);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "X-Emby-Token": token,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });
  if (!response.ok) {
    throw new Error(`Jellyfin PlaybackInfo API ${response.status}`);
  }
  return response.json();
}

function buildJellyfinStreamUrl(serverUrl, itemId, token, mediaSource) {
  const container = cleanExtension(mediaSource?.Container || extensionFromPath(mediaSource?.Path) || "mp4");
  const url = new URL(`${serverUrl}/Videos/${encodeURIComponent(itemId)}/stream.${container}`);
  url.searchParams.set("static", "true");
  if (mediaSource?.Id) url.searchParams.set("mediaSourceId", mediaSource.Id);
  url.searchParams.set("api_key", token);
  return url.toString();
}

function cleanExtension(value) {
  return String(value || "mp4").split(",")[0].replace(/^\./, "").replace(/[^a-zA-Z0-9]/g, "") || "mp4";
}

function extensionFromPath(value) {
  const ext = path.extname(String(value || "")).replace(/^\./, "");
  return ext || "";
}

async function readStrmTarget(strmPath, mappings) {
  const raw = await fsp.readFile(strmPath, "utf8");
  const line = raw
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry && !entry.startsWith("#"));
  if (!line) throw new Error(`STRM file is empty: ${strmPath}`);

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(line)) {
    return line;
  }

  const mapped = applyPathMappings(line, mappings);
  if (path.isAbsolute(mapped)) return mapped;
  return path.resolve(path.dirname(strmPath), mapped);
}

function applyPathMappings(inputPath, mappings) {
  let value = String(inputPath || "");
  for (const mapping of mappings || []) {
    const serverPrefix = normalizeComparablePath(mapping.serverPrefix);
    const current = normalizeComparablePath(value);
    if (current.toLowerCase().startsWith(serverPrefix.toLowerCase())) {
      const rest = value.slice(mapping.serverPrefix.length).replace(/^[/\\]+/, "");
      return path.join(mapping.clientPrefix, rest);
    }
  }
  return value;
}

function normalizeComparablePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
}

function originFromUrl(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
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
  createMenu();
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
