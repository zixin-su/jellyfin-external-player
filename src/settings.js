const form = document.getElementById("settingsForm");
const statusEl = document.getElementById("status");
const fields = {
  serverUrl: document.getElementById("serverUrl"),
  externalPlayerPath: document.getElementById("externalPlayerPath"),
  playerArgs: document.getElementById("playerArgs"),
  interceptPlayback: document.getElementById("interceptPlayback"),
  preferJellyfinStream: document.getElementById("preferJellyfinStream"),
  preferStrmTarget: document.getElementById("preferStrmTarget"),
  preferLocalFiles: document.getElementById("preferLocalFiles"),
  invertWheelScroll: document.getElementById("invertWheelScroll"),
  strmPathMappings: document.getElementById("strmPathMappings")
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
  const settings = {
    serverUrl: fields.serverUrl.value,
    externalPlayerPath: fields.externalPlayerPath.value,
    playerArgs: fields.playerArgs.value || "{url}",
    interceptPlayback: fields.interceptPlayback.checked,
    preferJellyfinStream: fields.preferJellyfinStream.checked,
    preferStrmTarget: fields.preferStrmTarget.checked,
    preferLocalFiles: fields.preferLocalFiles.checked,
    invertWheelScroll: fields.invertWheelScroll.checked,
    strmPathMappings: parseMappings(fields.strmPathMappings.value)
  };
  await window.jep.saveSettings(settings);
  setStatus("Saved.");
});

window.jep.getSettings().then((settings) => {
  fields.serverUrl.value = settings.serverUrl || "";
  fields.externalPlayerPath.value = settings.externalPlayerPath || "";
  fields.playerArgs.value = settings.playerArgs || "{url}";
  fields.interceptPlayback.checked = Boolean(settings.interceptPlayback);
  fields.preferJellyfinStream.checked = settings.preferJellyfinStream !== false;
  fields.preferStrmTarget.checked = Boolean(settings.preferStrmTarget);
  fields.preferLocalFiles.checked = Boolean(settings.preferLocalFiles);
  fields.invertWheelScroll.checked = settings.invertWheelScroll !== false;
  fields.strmPathMappings.value = formatMappings(settings.strmPathMappings || []);
});

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
