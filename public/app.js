const cameraGrid = document.getElementById("cameraGrid");
const siteTitle = document.getElementById("siteTitle");
const aggregatorStatusBar = document.getElementById("aggregatorStatusBar");
const cameraEmptyState = document.getElementById("cameraEmptyState");

let cameras = [];
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

  body.append(video);
  card.append(header, body);

  return { card, video, meta, title };
}

function markStreamReady(video) {
  if (!video) {
    return;
  }
  video.dataset.streamReady = "true";
}

function attachPlaybackListeners(video) {
  if (!video || video.dataset.playbackListenersAttached === "true") {
    return;
  }
  const onPlaybackReady = () => {
    markStreamReady(video);
  };
  ["loadedmetadata", "loadeddata", "canplay", "playing", "timeupdate"].forEach((eventName) => {
    video.addEventListener(eventName, onPlaybackReady);
  });
  video.dataset.playbackListenersAttached = "true";
}

function updateCameraStatus(card, health) {
  const state = health?.status ?? "OFFLINE";
  card.dataset.state = state;
}

function updateCameraMeta(meta, health) {
  if (!meta) {
    return;
  }
  const bitrateKbps = Number.isFinite(health?.bitrateKbps) ? Math.round(health.bitrateKbps) : null;
  meta.textContent = bitrateKbps != null ? `${bitrateKbps.toLocaleString()} kbps` : "— kbps";
}

function updateEmptyState() {
  if (cameraEmptyState) {
    cameraEmptyState.classList.toggle("hidden", cameraCards.size > 0);
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
    attachLiveStream(entry.video, camera.id);
  }
  entry.title.textContent = camera.name;
  return entry;
}

function attachLiveStream(video, cameraId) {
  const streamUrl = `/streams/${cameraId}/master.m3u8`;
  attachPlaybackListeners(video);
  let retryTimeout = null;
  const scheduleRetry = () => {
    if (retryTimeout) {
      return;
    }
    retryTimeout = window.setTimeout(() => {
      retryTimeout = null;
      attachLiveStream(video, cameraId);
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
      video.play().catch(() => {});
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
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
    video.play().catch(() => {});
    video.addEventListener("error", () => {
      scheduleRetry();
    });
  }
}

async function loadUiConfig() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    const ui = data.ui ?? {};
    const titleText = typeof ui.title === "string" && ui.title.trim() ? ui.title.trim() : "Chickencams";
    document.title = titleText;
    if (siteTitle) {
      siteTitle.textContent = titleText;
    }
  } catch (error) {
    return;
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
    updateCameraStatus(entry.card, camera.health);
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

setInterval(async () => {
  refreshDashboard();
}, 5000);
