const configList = document.getElementById("configList");
const saveButton = document.getElementById("saveConfig");
const status = document.getElementById("configStatus");
let config = null;
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
  sourceLabel.textContent = "Source URL";
  const source = document.createElement("input");
  source.type = "text";
  source.value = camera.source;
  source.dataset.camera = camera.id;
  source.dataset.field = "source";
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
  const cameras = config.cameras.map((camera) => {
    const enabled = configList.querySelector(`input[type=checkbox][data-camera="${camera.id}"]`);
    const source = configList.querySelector(`input[type=text][data-camera="${camera.id}"][data-field="source"]`);
    const nameInput = configList.querySelector(`input[type=text][data-camera="${camera.id}"][data-field="name"]`);
    return {
      ...camera,
      name: nameInput?.value ?? camera.name,
      enabled: enabled?.checked ?? camera.enabled,
      source: source?.value ?? camera.source
    };
  });

  const response = await fetch("/api/config", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ ...config, cameras })
  });

  status.textContent = response.ok ? "Saved." : "Save failed.";
}

saveButton.addEventListener("click", saveConfig);
loadConfig();
