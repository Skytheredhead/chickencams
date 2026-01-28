import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import morgan from "morgan";
import archiver from "archiver";
import mime from "mime-types";
import { spawn, spawnSync } from "child_process";
import dgram from "dgram";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const defaultConfigPath = path.join(__dirname, "config.default.json");
const runtimeConfigPath = path.join(__dirname, "config.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function loadConfig() {
  const base = readJson(defaultConfigPath);
  const override = fs.existsSync(runtimeConfigPath) ? readJson(runtimeConfigPath) : {};
  return {
    ...base,
    ...override,
    server: { ...base.server, ...override.server },
    paths: { ...base.paths, ...override.paths },
    hls: { ...base.hls, ...override.hls },
    storage: { ...base.storage, ...override.storage },
    health: { ...base.health, ...override.health },
    ingestHost: normalizeString(override.ingestHost) || normalizeString(base.ingestHost) || "0.0.0.0",
    cameras: Array.isArray(override.cameras) ? override.cameras : base.cameras
  };
}

let config = loadConfig();
const cameraRegistryPath = path.resolve(rootDir, config.paths?.cameraRegistryPath || "camera-registry.json");

function loadCameraRegistry(baseCameras) {
  if (!fs.existsSync(cameraRegistryPath)) {
    return baseCameras;
  }
  try {
    const registry = readJson(cameraRegistryPath);
    if (Array.isArray(registry)) {
      return registry;
    }
    if (Array.isArray(registry.cameras)) {
      return registry.cameras;
    }
  } catch (error) {
    console.warn(`Failed to read camera registry at ${cameraRegistryPath}:`, error.message);
  }
  return baseCameras;
}

config = {
  ...config,
  cameras: loadCameraRegistry(config.cameras)
};

function persistRuntimeConfig() {
  const { cameras: _cameras, ...runtimeConfig } = config;
  fs.writeFileSync(runtimeConfigPath, JSON.stringify(runtimeConfig, null, 2));
}

const app = express();
app.use(morgan("dev"));
app.use(express.json());

const publicDir = path.join(rootDir, "public");
app.use(express.static(publicDir));

const streamsRoot = path.resolve(rootDir, config.paths.streamsRoot);
const recordingsRoot = path.resolve(rootDir, config.paths.recordingsRoot);
const activityRoot = path.resolve(rootDir, config.paths.activityRoot);
const encoderRoot = path.join(__dirname, "ffmpeg");

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildSrtSource(ingestHost, port, fallbackSource) {
  if (!Number.isFinite(port)) {
    return normalizeString(fallbackSource);
  }
  const host = normalizeString(ingestHost) || "0.0.0.0";
  return `srt://${host}:${port}?mode=listener`;
}

const recordingSafetyBufferSeconds = Number.isFinite(config.hls.recordingSafetyBufferSeconds)
  ? config.hls.recordingSafetyBufferSeconds
  : 5;
const maxBackupBytes = Number.isFinite(config.storage?.maxBackupGb)
  ? config.storage.maxBackupGb * 1024 * 1024 * 1024
  : null;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureStoragePaths() {
  ensureDir(streamsRoot);
  ensureDir(recordingsRoot);
  ensureDir(activityRoot);
}

ensureStoragePaths();

const encoderProcesses = new Map();

function isSrtSource(source) {
  return typeof source === "string" && source.startsWith("srt://");
}

function hasFfmpeg() {
  const result = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  return result.status === 0;
}

function hasCommand(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

function spawnEncoder(scriptName, args, label) {
  const scriptPath = path.join(encoderRoot, scriptName);
  const child = spawn(scriptPath, args, { stdio: "inherit" });
  encoderProcesses.set(label, child);
  child.on("close", (code) => {
    encoderProcesses.delete(label);
    console.warn(`[encoders] ${label} stopped with code ${code ?? "unknown"}.`);
  });
  child.on("error", (error) => {
    encoderProcesses.delete(label);
    console.warn(`[encoders] ${label} failed to start: ${error.message}`);
  });
}

function listUdpPortOwners(port) {
  if (!hasCommand("lsof")) {
    return [];
  }
  const result = spawnSync("lsof", ["-nP", `-iUDP:${port}`], { encoding: "utf-8" });
  if (result.status !== 0 || !result.stdout) {
    return [];
  }
  const lines = result.stdout.split("\n").slice(1).filter(Boolean);
  return lines
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2)
    .map(([command, pid]) => ({ command, pid: Number.parseInt(pid, 10) }))
    .filter((entry) => Number.isFinite(entry.pid));
}

async function releaseFfmpegPort(port) {
  const owners = listUdpPortOwners(port).filter((entry) => entry.command === "ffmpeg");
  if (owners.length === 0) {
    return false;
  }
  for (const owner of owners) {
    try {
      process.kill(owner.pid, "SIGTERM");
    } catch (error) {
      continue;
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  const remaining = listUdpPortOwners(port).filter((entry) => entry.command === "ffmpeg");
  if (remaining.length === 0) {
    return true;
  }
  for (const owner of remaining) {
    try {
      process.kill(owner.pid, "SIGKILL");
    } catch (error) {
      continue;
    }
  }
  return true;
}

function checkUdpPortAvailable(port, host) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const handleError = (error) => {
      socket.close();
      if (error && error.code === "EADDRINUSE") {
        resolve(false);
        return;
      }
      resolve(false);
    };
    socket.once("error", handleError);
    socket.bind(port, host, () => {
      socket.close();
      resolve(true);
    });
  });
}

async function startCameraEncoders() {
  if (!config.autoStartEncoders) {
    console.log("[encoders] Auto-start disabled.");
    return;
  }
  if (!hasFfmpeg()) {
    console.warn(
      "[encoders] ffmpeg not found. Install ffmpeg or disable autoStartEncoders to suppress this warning."
    );
    return;
  }
  for (const camera of config.cameras) {
    if (!camera.enabled || !isSrtSource(camera.source)) {
      continue;
    }
    const hlsLabel = `${camera.id}:hls`;
    const recordLabel = `${camera.id}:record`;
    const match = camera.source.match(/^srt:\/\/([^:/]+):(\d+)/i);
    const ingestHost = match?.[1] ?? config.ingestHost ?? "0.0.0.0";
    const ingestPort = match ? Number.parseInt(match[2], 10) : null;
    if (Number.isFinite(ingestPort)) {
      let available = await checkUdpPortAvailable(ingestPort, ingestHost);
      if (!available) {
        const released = await releaseFfmpegPort(ingestPort);
        if (released) {
          available = await checkUdpPortAvailable(ingestPort, ingestHost);
        }
      }
      if (!available) {
        console.warn(
          `[encoders] ${camera.id} skipped because ${ingestHost}:${ingestPort} is already in use.`
        );
        continue;
      }
    }
    if (!encoderProcesses.has(hlsLabel)) {
      spawnEncoder("encode_hls.sh", [camera.id, camera.source, streamsRoot], hlsLabel);
    }
    if (!encoderProcesses.has(recordLabel)) {
      spawnEncoder("record_segments.sh", [camera.id, camera.source, recordingsRoot], recordLabel);
    }
  }
}

function listBackupFiles(root) {
  if (!fs.existsSync(root)) {
    return [];
  }
  const files = [];
  const cameraDirs = fs.readdirSync(root);
  for (const cameraDir of cameraDirs) {
    const fullDir = path.join(root, cameraDir);
    if (!fs.statSync(fullDir).isDirectory()) {
      continue;
    }
    for (const file of fs.readdirSync(fullDir)) {
      if (!file.endsWith(".mp4")) {
        continue;
      }
      const fullPath = path.join(fullDir, file);
      try {
        const stats = fs.statSync(fullPath);
        files.push({ path: fullPath, size: stats.size, mtimeMs: stats.mtimeMs });
      } catch (error) {
        continue;
      }
    }
  }
  return files;
}

function enforceBackupStorageCap() {
  if (!maxBackupBytes) {
    return;
  }
  const files = listBackupFiles(recordingsRoot);
  let totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize <= maxBackupBytes) {
    return;
  }
  files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const file of files) {
    if (totalSize <= maxBackupBytes) {
      break;
    }
    try {
      fs.unlinkSync(file.path);
      totalSize -= file.size;
    } catch (error) {
      continue;
    }
  }
}

enforceBackupStorageCap();
setInterval(enforceBackupStorageCap, 10 * 60 * 1000);

function requireApiToken(req, res, next) {
  next();
}

function isKnownCamera(cameraId) {
  return config.cameras.some((camera) => camera.id === cameraId);
}

function sanitizeCameraId(cameraId) {
  if (!cameraId || !isKnownCamera(cameraId)) {
    return null;
  }
  return cameraId;
}

app.get("/config", (req, res) => {
  res.sendFile(path.join(publicDir, "config.html"));
});

app.get("/api/config", requireApiToken, (req, res) => {
  res.json(config);
});

app.post("/api/config", requireApiToken, (req, res) => {
  const payload = req.body ?? {};
  const cameras = Array.isArray(payload.cameras) ? payload.cameras : null;
  if (!cameras) {
    res.status(400).json({ error: "Invalid camera payload." });
    return;
  }
  const ingestHost = normalizeString(payload.ingestHost) || config.ingestHost || "0.0.0.0";
  const updated = {
    ...config,
    ingestHost,
    cameras: cameras.map((camera, index) => ({
      id: typeof camera.id === "string" ? camera.id : config.cameras[index]?.id ?? `cam${index + 1}`,
      name: typeof camera.name === "string" ? camera.name : config.cameras[index]?.name ?? `Cam ${index + 1}`,
      enabled: Boolean(camera.enabled),
      source: buildSrtSource(
        ingestHost,
        Number.parseInt(camera.port, 10),
        typeof camera.source === "string" ? camera.source : config.cameras[index]?.source ?? ""
      )
    }))
  };
  const { cameras: _cameras, ...runtimeConfig } = updated;
  fs.writeFileSync(runtimeConfigPath, JSON.stringify(runtimeConfig, null, 2));
  fs.writeFileSync(cameraRegistryPath, JSON.stringify({ cameras: updated.cameras }, null, 2));
  config = updated;
  res.json({ status: "ok" });
});

app.get("/api/cameras", (req, res) => {
  res.json({
    cameras: config.cameras.map((camera) => ({
      ...camera,
      health: getCameraHealth(camera.id)
    }))
  });
});

app.get("/api/activity", (req, res) => {
  const limit = Number.parseInt(req.query.limit ?? "5", 10);
  const cursor = req.query.cursor ? Number.parseInt(req.query.cursor, 10) : 0;
  const items = readActivityItems(activityRoot);
  const slice = items.slice(cursor, cursor + limit);
  const nextCursor = cursor + slice.length < items.length ? cursor + slice.length : null;
  res.json({ items: slice, nextCursor });
});

app.get("/api/rewind/:cameraId", (req, res) => {
  const cameraId = sanitizeCameraId(req.params.cameraId);
  if (!cameraId) {
    res.status(404).json({ error: "Camera not found." });
    return;
  }
  const playlistPath = path.join(streamsRoot, cameraId, "dvr", "playlist.m3u8");
  if (!fs.existsSync(playlistPath)) {
    res.status(404).json({ error: "Playlist not found" });
    return;
  }
  res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
  res.send(fs.readFileSync(playlistPath));
});

app.post("/api/download", requireApiToken, async (req, res) => {
  const { cameras, startTimestamp, endTimestamp, quality } = req.body ?? {};
  if (!Array.isArray(cameras) || cameras.length === 0) {
    res.status(400).json({ error: "Select at least one camera." });
    return;
  }

  const validCameras = cameras.map((cameraId) => sanitizeCameraId(cameraId)).filter(Boolean);
  if (validCameras.length === 0) {
    res.status(400).json({ error: "No valid cameras provided." });
    return;
  }

  const start = Number.parseInt(startTimestamp, 10);
  const end = Number.parseInt(endTimestamp, 10);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    res.status(400).json({ error: "Invalid time range." });
    return;
  }

  const startSeconds = Math.floor(start / 1000);
  const endSeconds = Math.floor(end / 1000);

  const selectedQuality = ["high", "med", "low"].includes(quality) ? quality : "high";
  const stitchedFiles = [];

  for (const cameraId of validCameras) {
    const segments = findSegmentsForRange(
      recordingsRoot,
      cameraId,
      startSeconds,
      endSeconds,
      config.hls.recordingSegmentSeconds,
      recordingSafetyBufferSeconds
    );
    if (segments.length === 0) {
      continue;
    }

    const stitchedPath = await stitchSegments(cameraId, segments, selectedQuality);
    if (stitchedPath) {
      const filename = `${cameraId}-${start}-${end}.mp4`;
      stitchedFiles.push({ path: stitchedPath, name: filename });
    }
  }

  if (stitchedFiles.length === 0) {
    res.status(404).json({ error: "No recordings found for the selected time range." });
    return;
  }

  res.setHeader("Content-Disposition", "attachment; filename=chickencams-download.zip");
  res.setHeader("Content-Type", "application/zip");

  const archive = archiver("zip", { zlib: { level: 9 } });
  const tempFiles = new Set(stitchedFiles.map((file) => file.path));
  const cleanupTemp = () => {
    tempFiles.forEach((file) => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
  };

  archive.on("warning", (err) => {
    console.warn("Archive warning:", err.message);
  });

  archive.on("error", (err) => {
    cleanupTemp();
    res.status(500).json({ error: err.message });
  });

  archive.on("end", cleanupTemp);
  res.on("close", cleanupTemp);

  archive.pipe(res);

  stitchedFiles.forEach((file) => {
    archive.file(file.path, { name: file.name });
  });

  await archive.finalize();
});

app.use("/streams", express.static(streamsRoot, {
  setHeaders(res, filePath) {
    const contentType = mime.lookup(filePath);
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }
    res.setHeader("Cache-Control", "no-store");
  }
}));

app.use("/activity", express.static(activityRoot, {
  setHeaders(res, filePath) {
    const contentType = mime.lookup(filePath);
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }
    res.setHeader("Cache-Control", "no-store");
  }
}));

function readActivityItems(root) {
  if (!fs.existsSync(root)) {
    return [];
  }
  const items = [];
  for (const camera of config.cameras) {
    const cameraDir = path.join(root, camera.id);
    if (!fs.existsSync(cameraDir)) {
      continue;
    }
    const files = fs.readdirSync(cameraDir);
    for (const file of files) {
      if (!file.endsWith(".mp4")) {
        continue;
      }
      const fullPath = path.join(cameraDir, file);
      const stats = fs.statSync(fullPath);
      items.push({
        cameraId: camera.id,
        cameraName: camera.name,
        url: `/activity/${camera.id}/${file}`,
        timestamp: stats.mtimeMs
      });
    }
  }
  return items.sort((a, b) => b.timestamp - a.timestamp);
}

function getLatestSegmentMtimeMs(cameraId) {
  const cameraDir = path.join(streamsRoot, cameraId);
  if (!fs.existsSync(cameraDir)) {
    return null;
  }
  const variants = fs
    .readdirSync(cameraDir)
    .filter((entry) => fs.statSync(path.join(cameraDir, entry)).isDirectory());
  let latest = null;
  variants.forEach((variant) => {
    const variantDir = path.join(cameraDir, variant);
    if (!fs.existsSync(variantDir)) {
      return;
    }
    const entries = fs.readdirSync(variantDir).filter((file) => file.endsWith(".ts"));
    entries.forEach((file) => {
      try {
        const stats = fs.statSync(path.join(variantDir, file));
        latest = latest == null ? stats.mtimeMs : Math.max(latest, stats.mtimeMs);
      } catch (error) {
        return;
      }
    });
  });
  return latest;
}

function getCameraHealth(cameraId) {
  const onlineSeconds = Number.isFinite(config.health?.onlineSeconds) ? config.health.onlineSeconds : 5;
  const degradedSeconds = Number.isFinite(config.health?.degradedSeconds) ? config.health.degradedSeconds : 15;
  const lastSegmentMs = getLatestSegmentMtimeMs(cameraId);
  if (!lastSegmentMs) {
    return { status: "OFFLINE", lastSegmentMs: null };
  }
  const ageSeconds = (Date.now() - lastSegmentMs) / 1000;
  if (ageSeconds <= onlineSeconds) {
    return { status: "ONLINE", lastSegmentMs };
  }
  if (ageSeconds <= degradedSeconds) {
    return { status: "DEGRADED", lastSegmentMs };
  }
  return { status: "OFFLINE", lastSegmentMs };
}

function findSegmentsForRange(root, cameraId, start, end, segmentDurationSeconds, safetyBufferSeconds) {
  const cameraDir = path.join(root, cameraId);
  if (!fs.existsSync(cameraDir)) {
    return [];
  }
  const duration = Number.isFinite(segmentDurationSeconds) ? segmentDurationSeconds : 60;
  const safetyBufferMs = Number.isFinite(safetyBufferSeconds) ? safetyBufferSeconds * 1000 : 0;
  const now = Date.now();
  return fs
    .readdirSync(cameraDir)
    .filter((file) => file.endsWith(".mp4"))
    .map((file) => {
      const fullPath = path.join(cameraDir, file);
      try {
        return {
          file,
          timestamp: Number.parseInt(file.split(".")[0], 10),
          stats: fs.statSync(fullPath)
        };
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean)
    .filter((entry) => Number.isFinite(entry.timestamp))
    .filter((entry) => entry.stats.size > 0)
    .filter((entry) => entry.stats.mtimeMs + safetyBufferMs < now)
    .filter((entry) => entry.timestamp + duration > start && entry.timestamp <= end)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((entry) => path.join(cameraDir, entry.file));
}

function getTranscodeSettings(quality) {
  if (quality === "med") {
    return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "96k"];
  }
  if (quality === "low") {
    return [
      "-vf",
      "scale=-2:480",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "30",
      "-c:a",
      "aac",
      "-b:a",
      "96k"
    ];
  }
  return ["-c", "copy"];
}

async function stitchSegments(cameraId, segments, quality = "high") {
  const tmpDir = path.join(rootDir, ".tmp");
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  const jobId = `${cameraId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const listFile = path.join(tmpDir, `${jobId}.txt`);
  const outputFile = path.join(tmpDir, `${jobId}.mp4`);
  const listContents = segments.map((segment) => `file '${segment.replace(/'/g, "'\\''")}'`).join("\n");
  fs.writeFileSync(listFile, listContents);

  return await new Promise((resolve) => {
    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listFile,
      ...getTranscodeSettings(quality),
      outputFile
    ]);

    ffmpeg.on("error", () => {
      if (fs.existsSync(listFile)) {
        fs.unlinkSync(listFile);
      }
      resolve(null);
    });

    ffmpeg.on("close", (code) => {
      if (fs.existsSync(listFile)) {
        fs.unlinkSync(listFile);
      }
      if (code === 0) {
        resolve(outputFile);
      } else {
        resolve(null);
      }
    });
  });
}

function startServer(port, host, attemptsRemaining = 5) {
  const server = app.listen(port, host, () => {
    console.log(`Chickencams server running on http://${host}:${port}`);
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && attemptsRemaining > 0) {
      const nextPort = port + 1;
      console.warn(`Port ${port} is in use. Trying ${nextPort}...`);
      config = {
        ...config,
        server: {
          ...config.server,
          port: nextPort
        }
      };
      persistRuntimeConfig();
      startServer(nextPort, host, attemptsRemaining - 1);
      return;
    }
    console.error("Failed to start server:", error.message);
    process.exitCode = 1;
  });
}

const { port, host } = config.server;
startCameraEncoders();
startServer(port, host);
