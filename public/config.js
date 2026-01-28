const configList = document.getElementById("configList");
const saveButton = document.getElementById("saveConfig");
const status = document.getElementById("configStatus");
const aggregatorHostInput = document.getElementById("aggregatorHost");
let config = null;

function parseSrtSource(source) {
  if (typeof source !== "string") {
    return null;
  }
  const match = source.match(/^srt:\\/\\/([^:/?]+)(?::(\\d+))?/i);
  if (!match) {
    return null;
  }
  return {
    host: match[1] ?? "",
    port: match[2] ? Number.parseInt(match[2], 10) : null
  };
}
function createCameraRow(camera) {
  const row = document.createElement("div");
  row.className = "activity-item";

  const meta = document.createElement("div");
  meta.className = "activity-meta";

  const title = document.createElement("strong");
  title.textContent = camera.id;

  const nameField = document.createElement("div");
  nameField.className = "field";
  const nameLabel = document.createElement("label");
  nameLabel.textContent = "Camera name";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = camera.name;
  nameInput.dataset.camera = camera.id;
  nameInput.dataset.field = "name";
  nameField.append(nameLabel, nameInput);

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

  const sourceField = document.createElement("div");
  sourceField.className = "field";
  const sourceLabel = document.createElement("label");
  sourceLabel.textContent = "Port";
  const source = document.createElement("input");
  source.type = "number";
  source.min = "1";
  source.max = "65535";
  source.value = camera.port ?? "";
  source.dataset.camera = camera.id;
  source.dataset.field = "port";
  sourceField.append(sourceLabel, source);

  meta.append(title, nameField, enabledLabel, sourceField);
  row.append(meta);
  return row;
}

async function loadConfig() {
  const response = await fetch("/api/config");
  if (!response.ok) {
    status.textContent = "Unable to load config.";
    return;
  }
  config = await response.json();
  const fallbackHost = config.cameras
    ?.map((camera) => parseSrtSource(camera.source)?.host)
    ?.find((host) => host);
  if (aggregatorHostInput) {
    aggregatorHostInput.value = config.ingestHost || fallbackHost || "";
  }
  configList.innerHTML = "";
  config.cameras.forEach((camera) => {
    const parsed = parseSrtSource(camera.source);
    configList.appendChild(createCameraRow({ ...camera, port: parsed?.port ?? "" }));
  });
}

async function saveConfig() {
  if (!config) {
    status.textContent = "Config not loaded.";
    return;
  }
  const cameras = config.cameras.map((camera) => {
    const enabled = configList.querySelector(`input[type=checkbox][data-camera="${camera.id}"]`);
    const port = configList.querySelector(`input[type=number][data-camera="${camera.id}"][data-field="port"]`);
    const nameInput = configList.querySelector(`input[type=text][data-camera="${camera.id}"][data-field="name"]`);
    return {
      ...camera,
      name: nameInput?.value ?? camera.name,
      enabled: enabled?.checked ?? camera.enabled,
      port: port?.value ?? ""
    };
  });

  const response = await fetch("/api/config", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ...config,
      ingestHost: aggregatorHostInput?.value ?? config.ingestHost,
      cameras
    })
  });

  status.textContent = response.ok ? "Saved." : "Save failed.";
}

saveButton.addEventListener("click", saveConfig);
loadConfig();
