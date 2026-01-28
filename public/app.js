const cameraGrid = document.getElementById("cameraGrid");
const bottomTabs = document.querySelectorAll(".bottom-tab");
const topTabs = document.querySelectorAll(".top-tab");
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
const globalMuteButton = document.getElementById("globalMuteButton");
const globalMuteLabel = document.getElementById("globalMuteLabel");
const globalMuteIcon = document.getElementById("globalMuteIcon");
const rewindCamera = document.getElementById("rewindCamera");
const rewindTime = document.getElementById("rewindTime");
const rewindPlayer = document.getElementById("rewindPlayer");

let cameras = [];
let activeAudioCamera = "cam1";
let activityCursor = 0;
let activityLoading = false;
let activityDone = false;
let rewindHls = null;

const apiTokenStorageKey = "chickencamsApiToken";

async function requestPairingToken() {
  const pairingCode = window.prompt("Enter the 6-digit pairing code shown in the server logs:");
  if (!pairingCode) {
    return null;
  }
  try {
    const response = await fetch("/api/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: pairingCode })
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return typeof data.token === "string" ? data.token : null;
  } catch (error) {
    return null;
  }
}

async function getApiToken({ promptIfMissing } = { promptIfMissing: false }) {
  let token = localStorage.getItem(apiTokenStorageKey);
  if (!token && promptIfMissing) {
    token = await requestPairingToken();
    if (token) {
      localStorage.setItem(apiTokenStorageKey, token);
    }
  }
  return token;
}

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
  });
});

topTabs.forEach((button) => {
  button.addEventListener("click", () => {
    topTabs.forEach((tab) => tab.classList.remove("active"));
    button.classList.add("active");
    setActiveSection(button.dataset.tab);
  });
});

function buildCameraTile(camera) {
  const tile = document.createElement("div");
  tile.className = "camera-tile";
  tile.dataset.camera = camera.id;

  const title = document.createElement("div");
  title.className = "camera-title";
  title.textContent = camera.name;

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
  speaker.innerHTML = getSpeakerIcon(video.muted);
  if (video.muted) {
    speaker.classList.add("muted");
  }

  speaker.addEventListener("click", () => {
    setActiveAudio(camera.id);
  });

  tile.append(title, video, placeholder, speaker);
  return { tile, video, placeholder };
}

function getSpeakerIcon(isMuted) {
  if (isMuted) {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M16.5 12a4.5 4.5 0 0 0-3.5-4.38v8.76A4.5 4.5 0 0 0 16.5 12Zm3.5 0c0-2.33-1.2-4.38-3-5.57v2.33c.7.89 1.1 2.01 1.1 3.24s-.4 2.35-1.1 3.24v2.33c1.8-1.2 3-3.24 3-5.57ZM5 9v6h4l5 5V4L9 9H5Zm13.59-5L20 5.41 15.41 10 20 14.59 18.59 16 14 11.41 9.41 16 8 14.59 12.59 10 8 5.41 9.41 4 14 8.59 18.59 4Z" />
      </svg>
    `;
  }
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16.5 12a4.5 4.5 0 0 0-3.5-4.38v8.76A4.5 4.5 0 0 0 16.5 12Zm3.5 0c0-2.33-1.2-4.38-3-5.57v2.33c.7.89 1.1 2.01 1.1 3.24s-.4 2.35-1.1 3.24v2.33c1.8-1.2 3-3.24 3-5.57ZM5 9v6h4l5 5V4L9 9H5Z" />
    </svg>
  `;
}

function setActiveAudio(cameraId) {
  activeAudioCamera = cameraId;
  const videos = document.querySelectorAll("video[data-camera]");
  const speakers = document.querySelectorAll(".speaker-toggle");

  videos.forEach((video) => {
    video.muted = video.dataset.camera !== cameraId || isGloballyMuted;
  });

  speakers.forEach((button) => {
    const isMuted = button.parentElement.dataset.camera !== cameraId || isGloballyMuted;
    button.classList.toggle("muted", isMuted);
    button.innerHTML = getSpeakerIcon(isMuted);
  });
}

let isGloballyMuted = false;
function toggleGlobalMute() {
  isGloballyMuted = !isGloballyMuted;
  globalMuteLabel.textContent = isGloballyMuted ? "Unmute" : "Mute all";
  globalMuteIcon.textContent = isGloballyMuted ? "🔇" : "🔊";
  setActiveAudio(activeAudioCamera);
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
    const { tile, video, placeholder } = buildCameraTile(camera);
    cameraGrid.appendChild(tile);
    attachLiveStream(video, camera.id, placeholder);

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

  setActiveAudio(activeAudioCamera);
}

function attachLiveStream(video, cameraId, placeholder) {
  const streamUrl = `/streams/${cameraId}/master.m3u8`;
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
    });
    hls.on(Hls.Events.ERROR, () => {
      placeholder?.classList.remove("hidden");
      placeholder.textContent = "Live feed unavailable.";
    });
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = streamUrl;
    video.addEventListener("loadedmetadata", () => {
      placeholder?.classList.add("hidden");
    }, { once: true });
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

  downloadStatus.textContent = "Preparing download…";
  const apiToken = await getApiToken({ promptIfMissing: true });
  if (!apiToken) {
    downloadStatus.textContent = "Download cancelled (missing pairing code).";
    return;
  }
  try {
    const response = await fetch("/api/download", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`
      },
      body: JSON.stringify({
        cameras: checked.map((item) => item.value),
        startTimestamp: start,
        endTimestamp: end
      })
    });

    if (!response.ok) {
      const error = await response.json();
      if (response.status === 401) {
        localStorage.removeItem(apiTokenStorageKey);
      }
      downloadStatus.textContent = error.error ?? "Download failed.";
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "chickencams-download.zip";
    link.click();
    URL.revokeObjectURL(url);
    downloadStatus.textContent = "Download ready.";
  } catch (error) {
    downloadStatus.textContent = "Download failed. Check the server logs.";
  }
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

  if (rewindTime.value) {
    const target = new Date(rewindTime.value).getTime();
    rewindPlayer.addEventListener("loadedmetadata", () => {
      const deltaSeconds = (Date.now() - target) / 1000;
      if (deltaSeconds > 0) {
        rewindPlayer.currentTime = Math.max(0, rewindPlayer.duration - deltaSeconds);
      }
    }, { once: true });
  }
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

globalMuteButton.addEventListener("click", toggleGlobalMute);

rewindCamera.addEventListener("change", loadRewindStream);
rewindTime.addEventListener("change", loadRewindStream);

downloadButton.addEventListener("click", requestDownload);

loadCameras();
loadActivity();
setupActivityObserver();
setActiveSection("live");
