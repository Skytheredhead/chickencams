const cameraGrid = document.getElementById("cameraGrid");
const siteTitle = document.getElementById("siteTitle");

let cameras = [];

function getStatusLabel(status) {
  switch (status) {
    case "ONLINE":
      return "Online";
    case "DEGRADED":
      return "Degraded";
    case "OFFLINE":
    default:
      return "Offline";
  }
}

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

  const placeholder = document.createElement("div");
  placeholder.className = "camera-placeholder";
  placeholder.textContent = "No signal";

  body.append(video, placeholder);
  card.append(header, body);

  return { card, video, placeholder, meta };
}

function updateCameraStatus(card, placeholder, health) {
  const state = health?.status ?? "OFFLINE";
  card.dataset.state = state;
  card.classList.toggle("offline", state !== "ONLINE");
  if (state === "ONLINE") {
    placeholder.classList.add("hidden");
  } else if (state === "DEGRADED") {
    placeholder.classList.remove("hidden");
    placeholder.textContent = "Signal degraded";
  } else {
    placeholder.classList.remove("hidden");
    placeholder.textContent = "No signal";
  }
}

function attachLiveStream(video, cameraId, placeholder) {
  const streamUrl = `/streams/${cameraId}/master.m3u8`;
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
      placeholder?.classList.add("hidden");
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      placeholder?.classList.remove("hidden");
      placeholder.textContent = "No signal";
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
    video.addEventListener("loadedmetadata", () => {
      placeholder?.classList.add("hidden");
    }, { once: true });
    video.addEventListener("error", () => {
      placeholder?.classList.remove("hidden");
      placeholder.textContent = "No signal";
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
    cameras = data.cameras ?? [];
  } catch (error) {
    cameras = [
      { id: "cam1", name: "Camera 1", enabled: true },
      { id: "cam2", name: "Camera 2", enabled: true },
      { id: "cam3", name: "Camera 3", enabled: true },
      { id: "cam4", name: "Camera 4", enabled: true },
      { id: "cam5", name: "Camera 5", enabled: true }
    ];
  }

  cameraGrid.innerHTML = "";
  cameras.filter((camera) => camera.enabled).forEach((camera) => {
    const { card, video, placeholder } = buildCameraCard(camera);
    cameraGrid.appendChild(card);
    updateCameraStatus(card, placeholder, camera.health);
    attachLiveStream(video, camera.id, placeholder);
  });
}

loadCameras();
loadUiConfig();

setInterval(async () => {
  try {
    const response = await fetch("/api/cameras");
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    (data.cameras ?? []).forEach((camera) => {
      const card = cameraGrid.querySelector(`[data-camera="${camera.id}"]`);
      if (!card) {
        return;
      }
      const placeholder = card.querySelector(".camera-placeholder");
      if (placeholder) {
        updateCameraStatus(card, placeholder, camera.health);
      }
    });
  } catch (error) {
    return;
  }
}, 5000);
