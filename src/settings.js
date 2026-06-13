const form = document.getElementById("settingsForm");
const statusEl = document.getElementById("status");
const fields = {
  serverUrl: document.getElementById("serverUrl"),
  externalPlayerPath: document.getElementById("externalPlayerPath"),
  playerArgs: document.getElementById("playerArgs"),
  interceptPlayback: document.getElementById("interceptPlayback"),
  playbackMode: Array.from(document.querySelectorAll("input[name='playbackMode']")),
  invertWheelScroll: document.getElementById("invertWheelScroll"),
  strmHelperUrl: document.getElementById("strmHelperUrl"),
  strmHelperToken: document.getElementById("strmHelperToken"),
  strmPathMappings: document.getElementById("strmPathMappings"),
  helperSettings: document.getElementById("helperSettings"),
  pathMappingSettings: document.getElementById("pathMappingSettings")
};

document.getElementById("browsePlayer").addEventListener("click", async () => {
  const selected = await window.jep.choosePlayer();
  if (selected) fields.externalPlayerPath.value = selected;
});

document.getElementById("openDataFolder").addEventListener("click", () => {
  window.jep.openDataFolder();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = form.querySelector("button[type='submit']");
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "保存中...";
  }
  const settings = {
    serverUrl: fields.serverUrl.value,
    externalPlayerPath: fields.externalPlayerPath.value,
    playerArgs: fields.playerArgs.value || "{url}",
    interceptPlayback: fields.interceptPlayback.checked,
    playbackMode: selectedPlaybackMode(),
    invertWheelScroll: fields.invertWheelScroll.checked,
    strmHelperUrl: fields.strmHelperUrl.value,
    strmHelperToken: fields.strmHelperToken.value,
    strmPathMappings: parseMappings(fields.strmPathMappings.value)
  };
  try {
    await window.jep.saveSettings(settings);
  } catch (error) {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "保存";
    }
    setStatus(error?.message || "保存失败。");
  }
});

window.jep.getSettings().then((settings) => {
  fields.serverUrl.value = settings.serverUrl || "";
  fields.externalPlayerPath.value = settings.externalPlayerPath || "";
  fields.playerArgs.value = settings.playerArgs || "{url}";
  fields.interceptPlayback.checked = Boolean(settings.interceptPlayback);
  setPlaybackMode(settings.playbackMode || "jellyfin-stream");
  fields.invertWheelScroll.checked = Boolean(settings.invertWheelScroll);
  fields.strmHelperUrl.value = settings.strmHelperUrl || "";
  fields.strmHelperToken.value = settings.strmHelperToken || "";
  fields.strmPathMappings.value = formatMappings(settings.strmPathMappings || []);
  updateModeSections();
});

fields.playbackMode.forEach((input) => {
  input.addEventListener("change", updateModeSections);
});

function selectedPlaybackMode() {
  return fields.playbackMode.find((input) => input.checked)?.value || "jellyfin-stream";
}

function setPlaybackMode(mode) {
  const selected = ["jellyfin-stream", "media-path", "helper"].includes(mode) ? mode : "jellyfin-stream";
  fields.playbackMode.forEach((input) => {
    input.checked = input.value === selected;
  });
}

function updateModeSections() {
  const mode = selectedPlaybackMode();
  fields.helperSettings.hidden = mode !== "helper";
  fields.pathMappingSettings.hidden = !["media-path", "helper"].includes(mode);
}

function parseMappings(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serverPrefix, clientPrefix] = line.split(/\s*=>\s*/);
      return {
        serverPrefix: serverPrefix || "",
        clientPrefix: clientPrefix || ""
      };
    })
    .filter((mapping) => mapping.serverPrefix && mapping.clientPrefix);
}

function formatMappings(mappings) {
  return mappings.map((mapping) => `${mapping.serverPrefix} => ${mapping.clientPrefix}`).join("\n");
}

function setStatus(message) {
  statusEl.textContent = message;
  clearTimeout(setStatus.timer);
  setStatus.timer = setTimeout(() => {
    statusEl.textContent = "";
  }, 2400);
}
