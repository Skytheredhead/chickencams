const configList = document.getElementById("configList");
const saveButton = document.getElementById("saveConfig");
const status = document.getElementById("configStatus");
let config = null;
const apiTokenStorageKey = "chickencamsApiToken";

function getApiToken({ promptIfMissing } = { promptIfMissing: false }) {
  let token = localStorage.getItem(apiTokenStorageKey);
  if (!token && promptIfMissing) {
    token = window.prompt("Enter the Chickencams API token to continue:");
    if (token) {
      localStorage.setItem(apiTokenStorageKey, token);
    }
  }
  return token;
}

function createCameraRow(camera) {
  const row = document.createElement("div");
  row.className = "activity-item";

  const meta = document.createElement("div");
  meta.className = "activity-meta";

  const title = document.createElement("strong");
  title.textContent = camera.name;

  const enabledLabel = document.createElement("label");
  enabledLabel.textContent = "Enabled";
  enabledLabel.style.display = "flex";
  enabledLabel.style.alignItems = "center";
  enabledLabel.style.gap = "8px";
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.checked = camera.enabled;
  enabled.dataset.camera = camera.id;
  enabledLabel.prepend(enabled);

  const source = document.createElement("input");
  source.type = "text";
  source.value = camera.source;
  source.dataset.camera = camera.id;
  source.style.width = "100%";

  meta.append(title, enabledLabel, source);
  row.append(meta);
  return row;
}

async function loadConfig() {
  const apiToken = getApiToken({ promptIfMissing: true });
  if (!apiToken) {
    status.textContent = "Missing API token.";
    return;
  }
  const response = await fetch("/api/config", {
    headers: { Authorization: `Bearer ${apiToken}` }
  });
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem(apiTokenStorageKey);
    }
    status.textContent = "Unable to load config.";
    return;
  }
  config = await response.json();
  configList.innerHTML = "";
  config.cameras.forEach((camera) => {
    configList.appendChild(createCameraRow(camera));
  });
}

async function saveConfig() {
  if (!config) {
    status.textContent = "Config not loaded.";
    return;
  }
  const apiToken = getApiToken({ promptIfMissing: true });
  if (!apiToken) {
    status.textContent = "Missing API token.";
    return;
  }
  const cameras = config.cameras.map((camera) => {
    const enabled = configList.querySelector(`input[type=checkbox][data-camera="${camera.id}"]`);
    const source = configList.querySelector(`input[type=text][data-camera="${camera.id}"]`);
    return {
      ...camera,
      enabled: enabled?.checked ?? camera.enabled,
      source: source?.value ?? camera.source
    };
  });

  const response = await fetch("/api/config", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiToken}`
    },
    body: JSON.stringify({ ...config, cameras })
  });

  if (response.status === 401) {
    localStorage.removeItem(apiTokenStorageKey);
  }
  status.textContent = response.ok ? "Saved." : "Save failed.";
}

saveButton.addEventListener("click", saveConfig);
loadConfig();
