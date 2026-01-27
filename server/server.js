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
const configPath = path.join(__dirname, "config.default.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const app = express();
app.use(morgan("dev"));
app.use(express.json());

const publicDir = path.join(rootDir, "public");
app.use(express.static(publicDir));

const streamsRoot = path.resolve(rootDir, config.paths.streamsRoot);
const recordingsRoot = path.resolve(rootDir, config.paths.recordingsRoot);
const activityRoot = path.resolve(rootDir, config.paths.activityRoot);

app.get("/config", (req, res) => {
  res.sendFile(path.join(publicDir, "config.html"));
});

app.get("/api/config", (req, res) => {
  res.json(config);
});

app.post("/api/config", (req, res) => {
  const updated = { ...config, ...req.body };
  fs.writeFileSync(configPath, JSON.stringify(updated, null, 2));
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
  const cameraId = req.params.cameraId;
  const playlistPath = path.join(streamsRoot, cameraId, "dvr", "playlist.m3u8");
  if (!fs.existsSync(playlistPath)) {
    res.status(404).json({ error: "Playlist not found" });
    return;
  }
  res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
  res.send(fs.readFileSync(playlistPath));
});

app.post("/api/download", async (req, res) => {
  const { cameras, startTimestamp, endTimestamp } = req.body ?? {};
  if (!Array.isArray(cameras) || cameras.length === 0) {
    res.status(400).json({ error: "Select at least one camera." });
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
  archive.on("error", (err) => {
    res.status(500).json({ error: err.message });
  });

  archive.pipe(res);

  for (const cameraId of cameras) {
    const segments = findSegmentsForRange(recordingsRoot, cameraId, startSeconds, endSeconds);
    if (segments.length === 0) {
      continue;
    }

    const stitchedPath = await stitchSegments(cameraId, segments);
    if (stitchedPath) {
      const filename = `${cameraId}-${start}-${end}.mp4`;
      archive.file(stitchedPath, { name: filename });
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

function findSegmentsForRange(root, cameraId, start, end) {
  const cameraDir = path.join(root, cameraId);
  if (!fs.existsSync(cameraDir)) {
    return [];
  }
  return fs
    .readdirSync(cameraDir)
    .filter((file) => file.endsWith(".mp4"))
    .map((file) => ({
      file,
      timestamp: Number.parseInt(file.split(".")[0], 10)
    }))
    .filter((entry) => Number.isFinite(entry.timestamp))
    .filter((entry) => entry.timestamp >= start && entry.timestamp <= end)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((entry) => path.join(cameraDir, entry.file));
}

async function stitchSegments(cameraId, segments) {
  const tmpDir = path.join(rootDir, ".tmp");
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  const listFile = path.join(tmpDir, `${cameraId}-${Date.now()}.txt`);
  const outputFile = path.join(tmpDir, `${cameraId}-${Date.now()}.mp4`);
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

    ffmpeg.on("close", (code) => {
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
