const serverForm = document.getElementById("serverForm");
const serverUrl = document.getElementById("serverUrl");
const settingsBtn = document.getElementById("settingsBtn");

window.jep.getSettings().then((settings) => {
  serverUrl.value = settings.serverUrl || "";
});

serverForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await window.jep.loadServer(serverUrl.value);
});

settingsBtn.addEventListener("click", () => {
  window.jep.openSettings();
});
