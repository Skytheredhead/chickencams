const cameraGrid = document.getElementById("cameraGrid");
const siteTitle = document.getElementById("siteTitle");
const aggregatorStatusBar = document.getElementById("aggregatorStatusBar");
const cameraEmptyState = document.getElementById("cameraEmptyState");
const configList = document.getElementById("configList");
const saveButton = document.getElementById("saveConfig");
const configStatus = document.getElementById("configStatus");
const aggregatorHostInput = document.getElementById("aggregatorHost");
const siteTitleInput = document.getElementById("siteTitleInput");
const showTitleToggle = document.getElementById("showTitleToggle");

let cameras = [];
let configState = null;
const cameraCards = new Map();

function buildCameraCard(camera) {
  const card = document.createElement("div");
  card.className = "camera-card";
  card.dataset.camera = camera.id;

  const header = document.createElement("div");
  header.className = "camera-card-header";

  const title = document.createElement("span");
  title.textContent = camera.name;

  const meta = document.createElement("span");
  meta.className = "text-zinc-500";
  meta.textContent = "— kbps";

  header.append(title, meta);

  const body = document.createElement("div");
  body.className = "camera-card-body aspect-video";

  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.dataset.camera = camera.id;
  video.dataset.streamReady = "false";

  const placeholder = document.createElement("div");
  placeholder.className = "camera-placeholder";
  placeholder.textContent = "No signal";

  body.append(video, placeholder);
  card.append(header, body);

  return { card, video, placeholder, meta, title };
}

function isStreamRendering(video) {
  return video?.dataset.streamReady === "true"
    || (video instanceof HTMLVideoElement && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA);
}

function showPlaceholder(placeholder, message) {
  if (!placeholder) {
    return;
  }
  if (message) {
    placeholder.textContent = message;
  }
  placeholder.classList.remove("hidden");
}

function hidePlaceholder(placeholder) {
  placeholder?.classList.add("hidden");
}

function attachPlaybackListeners(video, placeholder) {
  if (!video || video.dataset.playbackListenersAttached === "true") {
    return;
  }
  const markStreamReady = () => {
    video.dataset.streamReady = "true";
    hidePlaceholder(placeholder);
  };
  ["loadedmetadata", "loadeddata", "canplay", "playing", "timeupdate"].forEach((eventName) => {
    video.addEventListener(eventName, markStreamReady);
  });
  video.dataset.playbackListenersAttached = "true";
}

function updateCameraStatus(card, video, placeholder, health) {
  const state = health?.status ?? "OFFLINE";
  card.dataset.state = state;
  card.classList.toggle("offline", state === "OFFLINE");
  card.classList.toggle("hidden", state === "OFFLINE");
  if (state === "OFFLINE") {
    hidePlaceholder(placeholder);
    return;
  }
  if (state === "DEGRADED" && !isStreamRendering(video)) {
    showPlaceholder(placeholder, "Signal degraded");
    return;
  }
  hidePlaceholder(placeholder);
}

function updateCameraMeta(meta, health) {
  if (!meta) {
    return;
  }
  const bitrateKbps = Number.isFinite(health?.bitrateKbps) ? Math.round(health.bitrateKbps) : null;
  meta.textContent = bitrateKbps != null ? `${bitrateKbps.toLocaleString()} kbps` : "— kbps";
}

function updateEmptyState() {
  const activeCards = cameraGrid.querySelectorAll(".camera-card:not(.hidden)");
  if (cameraEmptyState) {
    cameraEmptyState.classList.toggle("hidden", activeCards.length > 0);
  }
}

function renderAggregatorStatus(aggregators) {
  if (!aggregatorStatusBar) {
    return;
  }
  aggregatorStatusBar.innerHTML = "";
  const onlineAggregators = (aggregators ?? []).filter(Boolean);
  if (onlineAggregators.length === 0) {
    aggregatorStatusBar.classList.add("hidden");
    return;
  }
  aggregatorStatusBar.classList.remove("hidden");
  onlineAggregators.forEach((aggregator) => {
    const pill = document.createElement("span");
    pill.className = "status-pill online";
    const name = document.createElement("span");
    name.textContent = aggregator.hostname || "Aggregator";
    const ip = document.createElement("span");
    ip.className = "status-pill-ip";
    ip.textContent = aggregator.ip ? ` · ${aggregator.ip}` : "";
    pill.append(name, ip);
    aggregatorStatusBar.appendChild(pill);
  });
}

function upsertCameraCard(camera) {
  let entry = cameraCards.get(camera.id);
  if (!entry) {
    entry = buildCameraCard(camera);
    cameraCards.set(camera.id, entry);
    cameraGrid.appendChild(entry.card);
    attachLiveStream(entry.video, camera.id, entry.placeholder);
  }
  entry.title.textContent = camera.name;
  return entry;
}

function attachLiveStream(video, cameraId, placeholder) {
  const streamUrl = `/streams/${cameraId}/master.m3u8`;
  attachPlaybackListeners(video, placeholder);
  const markStreamReady = () => {
    video.dataset.streamReady = "true";
    hidePlaceholder(placeholder);
  };
  let retryTimeout = null;
  const scheduleRetry = () => {
    if (retryTimeout) {
      return;
    }
    retryTimeout = window.setTimeout(() => {
      retryTimeout = null;
      attachLiveStream(video, cameraId, placeholder);
    }, 3000);
  };

  if (window.Hls && Hls.isSupported()) {
    const hls = new Hls({
      lowLatencyMode: true,
      backBufferLength: 300,
      maxBufferLength: 300,
      maxMaxBufferLength: 300,
      maxLiveSyncPlaybackRate: 1.3,
      liveSyncDurationCount: 1,
      liveMaxLatencyDurationCount: 2
    });
    hls.loadSource(streamUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      markStreamReady();
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!isStreamRendering(video)) {
        showPlaceholder(placeholder, video.closest(".camera-card")?.dataset.state === "OFFLINE" ? "No signal" : "Connecting");
      }
      if (data?.fatal) {
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
          scheduleRetry();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
          scheduleRetry();
          return;
        }
        hls.destroy();
        scheduleRetry();
      }
    });
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = streamUrl;
    video.addEventListener("error", () => {
      if (!isStreamRendering(video)) {
        showPlaceholder(placeholder, video.closest(".camera-card")?.dataset.state === "OFFLINE" ? "No signal" : "Connecting");
      }
      scheduleRetry();
    });
  }
}

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

function applyUiConfig(data) {
  const ui = data?.ui ?? {};
  const titleText = typeof ui.title === "string" && ui.title.trim() ? ui.title.trim() : "Chickencams";
  document.title = titleText;
  if (siteTitle) {
    siteTitle.classList.toggle("hidden", ui.showTitle === false);
    siteTitle.textContent = ui.showTitle === false ? "" : titleText;
  }
  if (siteTitleInput) {
    siteTitleInput.value = titleText;
  }
  if (showTitleToggle) {
    showTitleToggle.value = ui.showTitle === false ? "false" : "true";
  }
}

function populateSettingsForm(data) {
  if (!configList) {
    return;
  }
  const fallbackHost = data.cameras
    ?.map((camera) => parseSrtSource(camera.source)?.host)
    ?.find((host) => host);
  if (aggregatorHostInput) {
    aggregatorHostInput.value = data.ingestHost || fallbackHost || "";
  }
  configList.innerHTML = "";
  (data.cameras ?? []).forEach((camera) => {
    const parsed = parseSrtSource(camera.source);
    configList.appendChild(createCameraRow({ ...camera, port: parsed?.port ?? "" }));
  });
}

async function fetchConfig() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch (error) {
    return null;
  }
}

async function loadUiConfig() {
  const data = await fetchConfig();
  if (!data) {
    if (configStatus) {
      configStatus.textContent = "Unable to load config.";
    }
    return;
  }
  configState = data;
  applyUiConfig(data);
  populateSettingsForm(data);
}

async function saveConfig() {
  if (!configState || !configList) {
    if (configStatus) {
      configStatus.textContent = "Config not loaded.";
    }
    return;
  }

  if (configStatus) {
    configStatus.textContent = "Saving...";
  }
  if (saveButton) {
    saveButton.disabled = true;
  }

  const camerasPayload = (configState.cameras ?? []).map((camera) => {
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

  try {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...configState,
        ui: {
          ...(configState.ui ?? {}),
          title: siteTitleInput?.value ?? configState.ui?.title ?? "Chickencams",
          showTitle: showTitleToggle?.value !== "false"
        },
        ingestHost: aggregatorHostInput?.value ?? configState.ingestHost,
        cameras: camerasPayload
      })
    });

    if (!response.ok) {
      throw new Error("Save failed");
    }

    const result = await response.json();
    configState = result.config ?? configState;
    applyUiConfig(configState);
    populateSettingsForm(configState);
    if (configStatus) {
      configStatus.textContent = "Saved.";
    }
    await refreshDashboard();
  } catch (error) {
    if (configStatus) {
      configStatus.textContent = "Save failed.";
    }
  } finally {
    if (saveButton) {
      saveButton.disabled = false;
    }
  }
}

async function loadCameras() {
  try {
    const response = await fetch("/api/cameras");
    if (!response.ok) {
      throw new Error("Camera list unavailable");
    }
    const data = await response.json();
    cameras = (data.cameras ?? []).filter((camera) => camera.enabled);
  } catch (error) {
    updateEmptyState();
    return false;
  }

  const currentCameraIds = new Set(cameras.map((camera) => camera.id));
  for (const [cameraId, entry] of cameraCards.entries()) {
    if (!currentCameraIds.has(cameraId)) {
      entry.card.remove();
      cameraCards.delete(cameraId);
    }
  }

  cameras.forEach((camera) => {
    const entry = upsertCameraCard(camera);
    updateCameraMeta(entry.meta, camera.health);
    updateCameraStatus(entry.card, entry.video, entry.placeholder, camera.health);
  });

  updateEmptyState();
  return true;
}

async function loadAggregators() {
  try {
    const response = await fetch("/api/aggregators");
    if (!response.ok) {
      return false;
    }
    const data = await response.json();
    renderAggregatorStatus(data.aggregators ?? []);
    return true;
  } catch (error) {
    return false;
  }
}

async function refreshDashboard() {
  await Promise.all([loadCameras(), loadAggregators()]);
}

refreshDashboard();
loadUiConfig();

saveButton?.addEventListener("click", saveConfig);

setInterval(async () => {
  refreshDashboard();
}, 5000);
