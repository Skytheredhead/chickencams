const cameraGrid = document.getElementById("cameraGrid");
const bottomTabs = document.querySelectorAll(".bottom-tab");
const sections = {
  live: document.getElementById("live"),
  activity: document.getElementById("activity"),
  download: document.getElementById("download"),
  rewind: document.getElementById("rewind")
};

const activityList = document.getElementById("activityList");
const activityStatus = document.getElementById("activityStatus");
const downloadCameras = document.getElementById("downloadCameras");
const downloadButton = document.getElementById("downloadButton");
const downloadStatus = document.getElementById("downloadStatus");
const downloadQuality = document.getElementById("downloadQuality");
const rewindCamera = document.getElementById("rewindCamera");
const rewindTime = document.getElementById("rewindTime");
const rewindWindow = document.getElementById("rewindWindow");
const rewindPlayer = document.getElementById("rewindPlayer");
const rewindDownloadButton = document.getElementById("rewindDownloadButton");
const rewindDownloadStatus = document.getElementById("rewindDownloadStatus");

let cameras = [];
let activeAudioCamera = "cam1";
let isLiveMuted = true;
let activityCursor = 0;
let activityLoading = false;
let activityDone = false;
let rewindHls = null;


function setActiveSection(tab) {
  Object.entries(sections).forEach(([key, section]) => {
    section.classList.toggle("hidden", key !== tab);
  });
}

bottomTabs.forEach((button) => {
  button.addEventListener("click", () => {
    bottomTabs.forEach((tab) => tab.classList.remove("active"));
    button.classList.add("active");
    setActiveSection(button.dataset.tab);
    if (button.dataset.tab === "download") {
      setDefaultDownloadTime();
    }
    if (button.dataset.tab === "rewind") {
      setDefaultRewindTime();
      loadRewindStream();
    }
  });
});

function buildCameraTile(camera) {
  const tile = document.createElement("div");
  tile.className = "camera-tile";
  tile.dataset.camera = camera.id;

  const title = document.createElement("div");
  title.className = "camera-title";
  title.textContent = camera.name;

  const status = document.createElement("div");
  status.className = "camera-status";
  status.dataset.state = camera.health?.status ?? "OFFLINE";
  status.textContent = getStatusLabel(camera.health?.status);

  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.muted = camera.id !== activeAudioCamera;
  video.dataset.camera = camera.id;

  const placeholder = document.createElement("div");
  placeholder.className = "video-placeholder";
  placeholder.textContent = "Waiting for live feed…";

  const speaker = document.createElement("button");
  speaker.className = "speaker-toggle";
  speaker.setAttribute("type", "button");
  speaker.innerHTML = getSpeakerIcon(isLiveMuted || activeAudioCamera !== camera.id);
  speaker.classList.toggle("muted", isLiveMuted || activeAudioCamera !== camera.id);

  speaker.addEventListener("click", () => {
    toggleCameraAudio(camera.id);
  });

  tile.append(title, status, video, placeholder, speaker);
  return { tile, video, placeholder, status };
}

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

function getSpeakerIcon(isMuted) {
  if (isMuted) {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 9v6h4l5 5V4L9 9H5Zm11.3 3.3L20 16l-1.3 1.3-3.7-3.7-3.7 3.7L10 16l3.7-3.7L10 8.6 11.3 7.3l3.7 3.7 3.7-3.7L20 8.6Z" />
      </svg>
    `;
  }
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 9v6h4l5 5V4L9 9H5Zm11.5 3a4.5 4.5 0 0 0-3.5-4.38v8.76A4.5 4.5 0 0 0 16.5 12Zm3.5 0c0-2.33-1.2-4.38-3-5.57v2.33c.7.89 1.1 2.01 1.1 3.24s-.4 2.35-1.1 3.24v2.33c1.8-1.2 3-3.24 3-5.57Z" />
    </svg>
  `;
}

function applyAudioState() {
  const videos = document.querySelectorAll("video[data-camera]");
  const speakers = document.querySelectorAll(".speaker-toggle");

  videos.forEach((video) => {
    const isMuted = isLiveMuted || video.dataset.camera !== activeAudioCamera;
    video.muted = isMuted;
  });

  speakers.forEach((button) => {
    const isMuted = isLiveMuted || button.parentElement.dataset.camera !== activeAudioCamera;
    button.classList.toggle("muted", isMuted);
    button.innerHTML = getSpeakerIcon(isMuted);
  });
}

function toggleCameraAudio(cameraId) {
  if (activeAudioCamera === cameraId) {
    isLiveMuted = !isLiveMuted;
  } else {
    activeAudioCamera = cameraId;
    isLiveMuted = false;
  }
  applyAudioState();
}

function updateCameraStatus(placeholder, statusElement, health) {
  const state = health?.status ?? "OFFLINE";
  statusElement.dataset.state = state;
  statusElement.textContent = getStatusLabel(state);
  placeholder.classList.toggle("hidden", state === "ONLINE");
  if (state === "OFFLINE") {
    placeholder.textContent = "Live feed offline.";
  } else if (state === "DEGRADED") {
    placeholder.textContent = "Live feed degraded.";
  } else {
    placeholder.textContent = "Waiting for live feed…";
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
      { id: "cam1", name: "Cam 1", enabled: true },
      { id: "cam2", name: "Cam 2", enabled: true },
      { id: "cam3", name: "Cam 3", enabled: true },
      { id: "cam4", name: "Cam 4", enabled: true },
      { id: "cam5", name: "Cam 5", enabled: true }
    ];
  }
  cameraGrid.innerHTML = "";
  downloadCameras.innerHTML = "";
  rewindCamera.innerHTML = "";

  cameras.filter((camera) => camera.enabled).forEach((camera) => {
    const { tile, video, placeholder, status } = buildCameraTile(camera);
    cameraGrid.appendChild(tile);
    updateCameraStatus(placeholder, status, camera.health);
    attachLiveStream(video, camera.id, placeholder, status);

    const checkboxLabel = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = camera.id;
    checkboxLabel.append(checkbox, document.createTextNode(camera.name));
    downloadCameras.appendChild(checkboxLabel);

    const option = document.createElement("option");
    option.value = camera.id;
    option.textContent = camera.name;
    rewindCamera.appendChild(option);
  });

  if (!cameras.some((camera) => camera.id === activeAudioCamera)) {
    activeAudioCamera = cameras[0]?.id ?? activeAudioCamera;
  }
  applyAudioState();
}

function attachLiveStream(video, cameraId, placeholder, statusElement) {
  const streamUrl = `/streams/${cameraId}/master.m3u8`;
  let retryTimeout = null;
  const scheduleRetry = () => {
    if (retryTimeout) {
      return;
    }
    retryTimeout = window.setTimeout(() => {
      retryTimeout = null;
      attachLiveStream(video, cameraId, placeholder, statusElement);
    }, 3000);
  };

  if (window.Hls && Hls.isSupported()) {
    const hls = new Hls({
      lowLatencyMode: true,
      backBufferLength: 10,
      maxLiveSyncPlaybackRate: 1.3
    });
    hls.loadSource(streamUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      placeholder?.classList.add("hidden");
      if (statusElement) {
        statusElement.dataset.state = "ONLINE";
        statusElement.textContent = getStatusLabel("ONLINE");
      }
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      placeholder?.classList.remove("hidden");
      placeholder.textContent = "Waiting for live feed…";
      if (statusElement) {
        statusElement.dataset.state = "DEGRADED";
        statusElement.textContent = getStatusLabel("DEGRADED");
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
    video.addEventListener("loadedmetadata", () => {
      placeholder?.classList.add("hidden");
      if (statusElement) {
        statusElement.dataset.state = "ONLINE";
        statusElement.textContent = getStatusLabel("ONLINE");
      }
    }, { once: true });
    video.addEventListener("error", () => {
      placeholder?.classList.remove("hidden");
      placeholder.textContent = "Waiting for live feed…";
      if (statusElement) {
        statusElement.dataset.state = "DEGRADED";
        statusElement.textContent = getStatusLabel("DEGRADED");
      }
      scheduleRetry();
    });
  }
}

async function loadActivity() {
  if (activityLoading || activityDone) {
    return;
  }
  activityLoading = true;
  activityStatus.textContent = "Loading…";
  try {
    const response = await fetch(`/api/activity?limit=5&cursor=${activityCursor}`);
    if (!response.ok) {
      throw new Error("Activity fetch failed");
    }
    const data = await response.json();
    (data.items ?? []).forEach((item) => {
      const container = document.createElement("div");
      container.className = "activity-item";
      const video = document.createElement("video");
      video.src = item.url;
      video.controls = true;
      const meta = document.createElement("div");
      meta.className = "activity-meta";
      const name = document.createElement("strong");
      name.textContent = item.cameraName;
      const time = document.createElement("span");
      time.textContent = new Date(item.timestamp).toLocaleString();
      meta.append(name, time);
      container.append(video, meta);
      activityList.appendChild(container);
    });

    activityCursor = data.nextCursor ?? activityCursor;
    activityDone = data.nextCursor == null || data.items?.length === 0;
    activityStatus.textContent = activityDone ? "No more clips." : "Scroll for more…";
  } catch (error) {
    activityStatus.textContent = "Activity feed unavailable in static preview.";
    activityDone = true;
  } finally {
    activityLoading = false;
  }
}

function formatDateTimeLocal(value) {
  const date = value instanceof Date ? value : new Date(value);
  const pad = (number) => number.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function setDefaultDownloadTime() {
  const startInput = document.getElementById("downloadStart");
  const start = new Date(Date.now() - 60 * 1000);
  startInput.value = formatDateTimeLocal(start);
}

function setDefaultRewindTime() {
  const now = new Date();
  rewindTime.value = formatDateTimeLocal(now);
}

function getSelectedQuality() {
  return downloadQuality?.value || "high";
}

async function requestDownloadForRange({ cameraIds, start, end, statusElement }) {
  if (!Array.isArray(cameraIds) || cameraIds.length === 0) {
    statusElement.textContent = "Select at least one camera.";
    return;
  }

  statusElement.textContent = "Preparing download…";
  try {
    const response = await fetch("/api/download", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        cameras: cameraIds,
        startTimestamp: start,
        endTimestamp: end,
        quality: getSelectedQuality()
      })
    });

    if (!response.ok) {
      const error = await response.json();
      statusElement.textContent = error.error ?? "Download failed.";
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "chickencams-download.zip";
    link.click();
    URL.revokeObjectURL(url);
    statusElement.textContent = "Download ready.";
  } catch (error) {
    statusElement.textContent = "Download failed. Check the server logs.";
  }
}

async function requestDownload() {
  const startInput = document.getElementById("downloadStart");
  const durationInput = document.getElementById("downloadDuration");
  const checked = Array.from(downloadCameras.querySelectorAll("input:checked"));
  if (!startInput.value || checked.length === 0) {
    downloadStatus.textContent = "Select a start time and at least one camera.";
    return;
  }

  const duration = Number.parseInt(durationInput.value, 10);
  if (Number.isNaN(duration) || duration < 10 || duration > 300) {
    downloadStatus.textContent = "Duration must be between 10 and 300 seconds.";
    return;
  }

  const start = new Date(startInput.value).getTime();
  const end = start + duration * 1000;

  await requestDownloadForRange({
    cameraIds: checked.map((item) => item.value),
    start,
    end,
    statusElement: downloadStatus
  });
}

function loadRewindStream() {
  const cameraId = rewindCamera.value;
  if (!cameraId) {
    return;
  }
  if (rewindHls) {
    rewindHls.destroy();
    rewindHls = null;
  }
  const streamUrl = `/api/rewind/${cameraId}`;
  if (window.Hls && Hls.isSupported()) {
    rewindHls = new Hls({
      lowLatencyMode: false,
      maxLiveSyncPlaybackRate: 1.0
    });
    rewindHls.loadSource(streamUrl);
    rewindHls.attachMedia(rewindPlayer);
  } else if (rewindPlayer.canPlayType("application/vnd.apple.mpegurl")) {
    rewindPlayer.src = streamUrl;
  }

  rewindPlayer.addEventListener("loadedmetadata", () => {
    const liveEdge = rewindPlayer.duration;
    const windowSeconds = Number.parseInt(rewindWindow.value, 10) || 3600;
    const target = rewindTime.value ? new Date(rewindTime.value).getTime() : Date.now();
    const deltaSeconds = Math.max(0, (Date.now() - target) / 1000);
    const minTime = Math.max(0, liveEdge - windowSeconds);
    const desiredTime = Math.max(minTime, liveEdge - deltaSeconds);
    rewindPlayer.currentTime = Math.min(liveEdge, desiredTime);
  }, { once: true });
}

async function downloadLast30Seconds() {
  const cameraId = rewindCamera.value;
  if (!cameraId) {
    rewindDownloadStatus.textContent = "Select a camera first.";
    return;
  }
  const target = rewindTime.value ? new Date(rewindTime.value).getTime() : Date.now();
  const start = target - 30 * 1000;
  const end = target;
  await requestDownloadForRange({
    cameraIds: [cameraId],
    start,
    end,
    statusElement: rewindDownloadStatus
  });
}

function setupActivityObserver() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        loadActivity();
      }
    });
  });
  observer.observe(activityStatus);
}

rewindCamera.addEventListener("change", loadRewindStream);
rewindTime.addEventListener("change", loadRewindStream);
rewindWindow.addEventListener("change", loadRewindStream);

downloadButton.addEventListener("click", requestDownload);
rewindDownloadButton.addEventListener("click", downloadLast30Seconds);

loadCameras();
loadActivity();
setupActivityObserver();
setActiveSection("live");
setDefaultDownloadTime();
setDefaultRewindTime();

setInterval(async () => {
  try {
    const response = await fetch("/api/cameras");
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    (data.cameras ?? []).forEach((camera) => {
      const tile = cameraGrid.querySelector(`[data-camera="${camera.id}"]`);
      if (!tile) {
        return;
      }
      const placeholder = tile.querySelector(".video-placeholder");
      const statusElement = tile.querySelector(".camera-status");
      if (placeholder && statusElement) {
        updateCameraStatus(placeholder, statusElement, camera.health);
      }
    });
  } catch (error) {
    return;
  }
}, 5000);
