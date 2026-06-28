const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jep", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  choosePlayer: () => ipcRenderer.invoke("dialog:choose-player"),
  openSettings: () => ipcRenderer.invoke("app:open-settings"),
  openDataFolder: () => ipcRenderer.invoke("app:open-data-folder"),
  loadServer: (serverUrl) => ipcRenderer.invoke("navigation:load-server", serverUrl),
  onToast: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on("app:toast", listener);
    return () => ipcRenderer.removeListener("app:toast", listener);
  }
});

const PLAY_LABELS = ["\u64ad\u653e", "\u64ad\u653e\u89c6\u9891", "play", "resume", "\u7ee7\u7eed\u64ad\u653e"];
const PLAY_CLASS_HINTS = [
  "resume",
  "btnplay",
  "playbutton",
  "itemplaybutton",
  "cardoverlayplaybutton",
  "itemplay",
  "mediaplay"
];
const PLAY_ICON_TEXT = ["play_arrow", "play_circle", "play_circle_filled", "\u25b6"];
let runtimeSettings = null;
let lastRequest = { key: "", at: 0 };

window.addEventListener("DOMContentLoaded", async () => {
  try {
    runtimeSettings = await ipcRenderer.invoke("settings:get");
  } catch {
    runtimeSettings = null;
  }
  installWheelDirectionCorrection();
  installJellyfinPlaybackInterceptor();
  window.jep.onToast?.(({ message, isError }) => {
    if (message) showToast(message, Boolean(isError));
  });
});

function installWheelDirectionCorrection() {
  if (runtimeSettings?.invertWheelScroll === false) return;
  if (window.__jepWheelDirectionCorrectionInstalled) return;
  window.__jepWheelDirectionCorrectionInstalled = true;
  window.addEventListener("wheel", handleWheelDirectionCorrection, { capture: true, passive: false });
}

function handleWheelDirectionCorrection(event) {
  if (event.defaultPrevented || event.ctrlKey) return;
  if (event.target?.closest?.("input,textarea,select,[role='slider']")) return;

  const normalized = normalizeWheelDelta(event);
  const corrected = {
    x: -normalized.x,
    y: -normalized.y
  };
  if (!corrected.x && !corrected.y) return;

  const scrollTarget = findScrollableElement(event.target, corrected.x, corrected.y);
  if (!scrollTarget) return;

  event.preventDefault();
  event.stopPropagation();
  if (event.stopImmediatePropagation) event.stopImmediatePropagation();

  if (event.shiftKey && Math.abs(corrected.y) > Math.abs(corrected.x)) {
    scrollTarget.scrollBy({ left: corrected.y, top: 0, behavior: "auto" });
    return;
  }
  scrollTarget.scrollBy({ left: corrected.x, top: corrected.y, behavior: "auto" });
}

function normalizeWheelDelta(event) {
  let scale = 1;
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) scale = 40;
  else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) scale = window.innerHeight || 800;
  return {
    x: event.deltaX * scale,
    y: event.deltaY * scale
  };
}

function findScrollableElement(start, deltaX, deltaY) {
  let node = start instanceof Element ? start : start?.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    if (canScrollInDirection(node, deltaX, deltaY)) return node;
    node = node.parentElement;
  }

  const root = document.scrollingElement || document.documentElement;
  return canScrollInDirection(root, deltaX, deltaY) ? root : null;
}

function canScrollInDirection(element, deltaX, deltaY) {
  if (!element) return false;
  const style = element === document.scrollingElement ? null : getComputedStyle(element);
  const canScrollY =
    deltaY &&
    isScrollableOverflow(style?.overflowY, element === document.scrollingElement) &&
    element.scrollHeight > element.clientHeight + 1 &&
    canScrollPosition(element.scrollTop, element.clientHeight, element.scrollHeight, deltaY);
  const canScrollX =
    deltaX &&
    isScrollableOverflow(style?.overflowX, element === document.scrollingElement) &&
    element.scrollWidth > element.clientWidth + 1 &&
    canScrollPosition(element.scrollLeft, element.clientWidth, element.scrollWidth, deltaX);
  return Boolean(canScrollY || canScrollX);
}

function isScrollableOverflow(value, isRoot) {
  if (isRoot) return true;
  return /^(auto|scroll|overlay)$/i.test(String(value || ""));
}

function canScrollPosition(position, viewportSize, contentSize, delta) {
  if (delta < 0) return position > 0;
  if (delta > 0) return position + viewportSize < contentSize - 1;
  return false;
}

function installJellyfinPlaybackInterceptor() {
  if (!runtimeSettings?.interceptPlayback || !runtimeSettings.externalPlayerPath) return;
  if (location.protocol === "file:") return;

  document.addEventListener("click", handleClickCapture, true);
  observeVideoElements();
  setTimeout(observeVideoElements, 1500);
}

function handleClickCapture(event) {
  const control = event.target?.closest?.(
    "button,a,[role='button'],[data-action],.btnPlay,.playButton,.cardOverlayButton,.cardOverlayFab,.itemAction,.paper-icon-button-light,.emby-button"
  );
  if (!control) return;

  if (!looksLikePlayControl(control)) return;

  const itemId = extractItemIdFromElement(control) || extractItemIdFromLocation();
  if (!itemId) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  requestExternalPlayback({ itemId, source: "click" });
}

function looksLikePlayControl(element) {
  const attrValues = [
    element.getAttribute?.("aria-label"),
    element.getAttribute?.("title"),
    element.getAttribute?.("data-action"),
    element.getAttribute?.("data-command"),
    element.getAttribute?.("data-mode")
  ];
  if (attrValues.some(isExactPlayValue)) return true;

  const classKey = String(element.className || "").toLowerCase().replace(/[\s_-]+/g, "");
  if (PLAY_CLASS_HINTS.some((entry) => classKey.includes(entry))) return true;

  const ownText = normalizeControlText(element.textContent);
  if (PLAY_ICON_TEXT.includes(ownText)) return true;

  const iconText = Array.from(element.querySelectorAll(".material-icons,.material-symbols-rounded,.material-symbols-outlined,.material-symbols-sharp,i,svg title"))
    .map((node) => normalizeControlText(node.textContent))
    .find(Boolean);
  if (iconText && PLAY_ICON_TEXT.includes(iconText)) return true;

  return false;
}

function isExactPlayValue(value) {
  const normalized = normalizeControlText(value);
  if (!normalized) return false;
  return PLAY_LABELS.some((entry) => normalized === normalizeControlText(entry));
}

function normalizeControlText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function observeVideoElements() {
  document.querySelectorAll("video").forEach((video) => {
    if (video.dataset.jepObserved) return;
    video.dataset.jepObserved = "1";
    video.addEventListener("play", () => handleVideoPlayback(video), true);
    video.addEventListener("loadedmetadata", () => handleVideoPlayback(video), true);
  });

  const observer = new MutationObserver(() => {
    document.querySelectorAll("video").forEach((video) => {
      if (!video.dataset.jepObserved) {
        video.dataset.jepObserved = "1";
        video.addEventListener("play", () => handleVideoPlayback(video), true);
        video.addEventListener("loadedmetadata", () => handleVideoPlayback(video), true);
      }
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function handleVideoPlayback(video) {
  const videoSrc = video.currentSrc || video.src || "";
  const itemId = extractItemIdFromVideoSrc(videoSrc) || extractItemIdFromLocation();
  if (!itemId && !videoSrc) return;
  try {
    video.pause();
  } catch {
    // Ignore browser media state errors.
  }
  requestExternalPlayback({ itemId, videoSrc, source: "video" });
}

async function requestExternalPlayback(partial) {
  const auth = extractJellyfinAuth();
  const serverUrl = pickPlaybackServerUrl(auth.serverUrl);
  const payload = {
    ...partial,
    pageUrl: location.href,
    title: document.title || "",
    serverUrl,
    token: auth.token || "",
    userId: auth.userId || "",
    serverId: auth.serverId || ""
  };

  const key = `${payload.itemId || ""}|${payload.videoSrc || ""}`;
  const now = Date.now();
  if (key && lastRequest.key === key && now - lastRequest.at < 4000) return;
  lastRequest = { key, at: now };

  showToast("正在打开外部播放器...");
  const result = await ipcRenderer.invoke("playback:external", payload);
  if (!result?.ok) showToast(result?.message || "外部播放失败。", true);
  else showToast("已打开外部播放器。");
}

function extractItemIdFromElement(element) {
  let node = element;
  for (let depth = 0; node && depth < 12; depth += 1, node = node.parentElement) {
    if (node === document.body || node === document.documentElement) break;

    const attrs = [
      "data-id",
      "data-itemid",
      "data-item-id",
      "data-mediaid",
      "data-media-id",
      "data-item",
      "data-cardid",
      "data-card-id",
      "data-action",
      "href",
      "data-href",
      "data-url"
    ];
    for (const attr of attrs) {
      const value = node.getAttribute?.(attr);
      const id = extractItemIdFromText(value);
      if (id) return id;
    }

    for (const attr of Array.from(node.attributes || [])) {
      const id = extractItemIdFromText(attr.value);
      if (id) return id;
    }

    if (depth <= 6 && looksLikeCardContainer(node)) {
      const link = node.querySelector?.("a[href*='id='],a[href*='/details'],a[href*='/video']");
      const idFromLink = extractItemIdFromText(link?.getAttribute?.("href"));
      if (idFromLink) return idFromLink;
    }
  }
  return "";
}

function looksLikeCardContainer(element) {
  const key = [
    element.id,
    element.className,
    element.getAttribute?.("data-type"),
    element.getAttribute?.("data-cardtype")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  return ["card", "cardbox", "cardscalable", "cardcontent", "itemcard", "poster", "portraitcard"].some((entry) =>
    key.includes(entry)
  );
}

function extractItemIdFromLocation() {
  return extractItemIdFromText(`${location.href} ${location.hash} ${location.search}`);
}

function extractItemIdFromVideoSrc(src) {
  const match = String(src || "").match(/\/(?:Videos|Audio)\/([a-f0-9-]{16,40})\//i);
  return match ? match[1] : "";
}

function extractItemIdFromText(value) {
  const text = String(value || "");
  const patterns = [
    /[?&#](?:id|itemId|itemid|ItemId)=([a-f0-9-]{16,40})/i,
    /["'](?:Id|ItemId|itemId)["']\s*:\s*["']([a-f0-9-]{16,40})["']/i,
    /\/details\?id=([a-f0-9-]{16,40})/i,
    /\/video\?[^#]*id=([a-f0-9-]{16,40})/i,
    /\/(?:Videos|Items|Audio)\/([a-f0-9-]{16,40})(?:[/?#]|$)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return "";
}

function extractJellyfinAuth() {
  const result = { token: "", serverUrl: "", userId: "", serverId: "" };
  const serverId = new URLSearchParams(location.search).get("serverId") || new URLSearchParams(location.hash.replace(/^#/, "")).get("serverId") || "";
  const candidates = [];

  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      collectAuthCandidates(JSON.parse(raw), candidates);
    } catch {
      // Ignore non-JSON localStorage entries.
    }
  }

  const currentHost = location.host.toLowerCase();
  const selected =
    candidates.find((c) => serverId && c.serverId === serverId) ||
    candidates.find((c) => c.serverUrl && safeHost(c.serverUrl) === currentHost) ||
    candidates[0] ||
    {};

  result.token = selected.token || "";
  result.serverUrl = selected.serverUrl || "";
  result.userId = selected.userId || "";
  result.serverId = selected.serverId || serverId || "";
  return result;
}

function pickPlaybackServerUrl(authServerUrl) {
  const currentBase = currentJellyfinBaseUrl();
  const configuredBase = normalizeAbsoluteHttpUrl(runtimeSettings?.serverUrl || "");
  const authBase = normalizeAbsoluteHttpUrl(authServerUrl || "");

  if (configuredBase && sameOrigin(configuredBase, currentBase)) return configuredBase;
  if (authBase && sameOrigin(authBase, currentBase)) return authBase;
  if (configuredBase) return configuredBase;
  return currentBase || authBase || location.origin;
}

function currentJellyfinBaseUrl() {
  try {
    const url = new URL(location.href);
    const match = url.pathname.match(/^(.*?)\/web(?:\/|$)/i);
    url.pathname = match ? match[1] || "" : "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return location.origin;
  }
}

function normalizeAbsoluteHttpUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw.includes("://") ? raw : `${inferDefaultProtocol(raw)}://${raw}`);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
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

function sameOrigin(left, right) {
  try {
    return new URL(left).origin.toLowerCase() === new URL(right).origin.toLowerCase();
  } catch {
    return false;
  }
}

function collectAuthCandidates(value, out) {
  if (!value || typeof value !== "object") return;

  if (typeof value.AccessToken === "string") {
    out.push({
      token: value.AccessToken,
      serverUrl: value.ManualAddress || value.LocalAddress || value.RemoteAddress || value.Address || "",
      serverId: value.Id || value.ServerId || "",
      userId: value.UserId || value.User?.Id || ""
    });
  }

  if (typeof value.accessToken === "string") {
    out.push({
      token: value.accessToken,
      serverUrl: value.serverUrl || value.address || "",
      serverId: value.serverId || "",
      userId: value.userId || ""
    });
  }

  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach((entry) => collectAuthCandidates(entry, out));
    else if (child && typeof child === "object") collectAuthCandidates(child, out);
  }
}

function safeHost(url) {
  try {
    return new URL(normalizeAbsoluteHttpUrl(url)).host.toLowerCase();
  } catch {
    return "";
  }
}

function showToast(message, isError = false) {
  let toast = document.getElementById("jep-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "jep-toast";
    toast.style.cssText = [
      "position:fixed",
      "right:18px",
      "bottom:18px",
      "z-index:2147483647",
      "max-width:420px",
      "padding:12px 14px",
      "border-radius:8px",
      "font:13px/1.4 system-ui,Segoe UI,sans-serif",
      "box-shadow:0 12px 32px rgba(0,0,0,.24)",
      "color:white",
      "background:#1f6feb"
    ].join(";");
    document.documentElement.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.background = isError ? "#b42318" : "#1f6feb";
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.remove(), isError ? 7000 : 2500);
}
