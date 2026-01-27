import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import morgan from "morgan";
import archiver from "archiver";
import mime from "mime-types";
import { spawn } from "child_process";

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
    cameras: Array.isArray(override.cameras) ? override.cameras : base.cameras
  };
}

let config = loadConfig();

const app = express();
app.use(morgan("dev"));
app.use(express.json());

const publicDir = path.join(rootDir, "public");
app.use(express.static(publicDir));

const streamsRoot = path.resolve(rootDir, config.paths.streamsRoot);
const recordingsRoot = path.resolve(rootDir, config.paths.recordingsRoot);
const activityRoot = path.resolve(rootDir, config.paths.activityRoot);

const apiToken = (process.env.CHICKENCAMS_API_TOKEN ?? config.server.apiToken ?? "").trim() || null;
if (!apiToken) {
  console.warn("CHICKENCAMS_API_TOKEN is not set. /api/config and /api/download are disabled.");
}

const recordingSafetyBufferSeconds = Number.isFinite(config.hls.recordingSafetyBufferSeconds)
  ? config.hls.recordingSafetyBufferSeconds
  : 5;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureStoragePaths() {
  ensureDir(streamsRoot);
  ensureDir(recordingsRoot);
  ensureDir(activityRoot);
}

ensureStoragePaths();

function requireApiToken(req, res, next) {
  if (!apiToken) {
    res.status(503).json({
      error: "API token not configured. Set CHICKENCAMS_API_TOKEN or server.apiToken."
    });
    return;
  }
  const authHeader = req.get("authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const headerToken = req.get("x-api-key") ?? bearer;
  if (!headerToken || headerToken !== apiToken) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
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
  const updated = {
    ...config,
    cameras: cameras.map((camera, index) => ({
      id: typeof camera.id === "string" ? camera.id : config.cameras[index]?.id ?? `cam${index + 1}`,
      name: typeof camera.name === "string" ? camera.name : config.cameras[index]?.name ?? `Cam ${index + 1}`,
      enabled: Boolean(camera.enabled),
      source: typeof camera.source === "string" ? camera.source : config.cameras[index]?.source ?? ""
    }))
  };
  fs.writeFileSync(runtimeConfigPath, JSON.stringify(updated, null, 2));
  config = updated;
  res.json({ status: "ok" });
});

app.get("/api/cameras", (req, res) => {
  res.json({ cameras: config.cameras });
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
  const { cameras, startTimestamp, endTimestamp } = req.body ?? {};
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

  res.setHeader("Content-Disposition", "attachment; filename=chickencams-download.zip");
  res.setHeader("Content-Type", "application/zip");

  const archive = archiver("zip", { zlib: { level: 9 } });
  const tempFiles = new Set();
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

    const stitchedPath = await stitchSegments(cameraId, segments);
    if (stitchedPath) {
      const filename = `${cameraId}-${start}-${end}.mp4`;
      archive.file(stitchedPath, { name: filename });
      tempFiles.add(stitchedPath);
    }
  }

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

async function stitchSegments(cameraId, segments) {
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
      "-c",
      "copy",
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

const { port, host } = config.server;
app.listen(port, host, () => {
  console.log(`Chickencams server running on http://${host}:${port}`);
});
