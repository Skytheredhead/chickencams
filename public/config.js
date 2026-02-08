const configList = document.getElementById("configList");
const saveButton = document.getElementById("saveConfig");
const status = document.getElementById("configStatus");
const aggregatorHostInput = document.getElementById("aggregatorHost");
const siteTitleInput = document.getElementById("siteTitleInput");
const showTitleToggle = document.getElementById("showTitleToggle");
const siteTitle = document.getElementById("siteTitle");
let config = null;

function parseSrtSource(source) {
  if (typeof source !== "string") {
    return null;
  }
  const match = source.match(/^srt:\/\/([^:/?]+)(?::(\d+))?/i);
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
  row.className = "config-row";

  const header = document.createElement("div");
  header.className = "config-row-title";
  header.textContent = camera.id;

  const nameField = document.createElement("div");
  nameField.className = "config-field";
  const nameLabel = document.createElement("label");
  nameLabel.className = "text-xs text-zinc-400";
  nameLabel.textContent = "Camera name";
  const nameInput = document.createElement("input");
  nameInput.className = "config-input";
  nameInput.type = "text";
  nameInput.value = camera.name;
  nameInput.dataset.camera = camera.id;
  nameInput.dataset.field = "name";
  nameField.append(nameLabel, nameInput);

  const enabledField = document.createElement("div");
  enabledField.className = "config-field";
  const enabledLabel = document.createElement("label");
  enabledLabel.className = "config-checkbox";
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.checked = camera.enabled;
  enabled.dataset.camera = camera.id;
  const enabledText = document.createElement("span");
  enabledText.textContent = "Enabled";
  enabledLabel.append(enabled, enabledText);
  enabledField.append(enabledLabel);

  const portField = document.createElement("div");
  portField.className = "config-field";
  const portLabel = document.createElement("label");
  portLabel.className = "text-xs text-zinc-400";
  portLabel.textContent = "Port";
  const portInput = document.createElement("input");
  portInput.className = "config-input";
  portInput.type = "number";
  portInput.min = "1";
  portInput.max = "65535";
  portInput.value = camera.port ?? "";
  portInput.dataset.camera = camera.id;
  portInput.dataset.field = "port";
  portField.append(portLabel, portInput);

  row.append(header, nameField, enabledField, portField);
  return row;
}

async function loadConfig() {
  const response = await fetch("/api/config");
  if (!response.ok) {
    status.textContent = "Unable to load config.";
    return;
  }
  config = await response.json();
  const ui = config.ui ?? {};
  const titleText = typeof ui.title === "string" && ui.title.trim() ? ui.title.trim() : "Chickencams";
  if (siteTitleInput) {
    siteTitleInput.value = titleText;
  }
  if (showTitleToggle) {
    showTitleToggle.value = ui.showTitle === false ? "false" : "true";
  }
  if (siteTitle) {
    siteTitle.textContent = titleText;
  }
  document.title = titleText;
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
      ui: {
        ...(config.ui ?? {}),
        title: siteTitleInput?.value ?? config.ui?.title ?? "Chickencams",
        showTitle: showTitleToggle?.value !== "false"
      },
      ingestHost: aggregatorHostInput?.value ?? config.ingestHost,
      cameras
    })
  });

  status.textContent = response.ok ? "Saved." : "Save failed.";
}

saveButton.addEventListener("click", saveConfig);
loadConfig();
