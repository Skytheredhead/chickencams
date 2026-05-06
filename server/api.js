import express from "express";
import morgan from "morgan";
import archiver from "archiver";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { persistConfig } from "./config.js";

function normalizeBaseUrl(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export function createApi({ config, db, hub, refreshConfig }) {
  const app = express();
  app.use(morgan("tiny", {
    skip: (req) => req.path.startsWith("/api/cameras") || req.path.startsWith("/api/edges")
  }));
  app.use(express.json());

  // ---- Cameras ---------------------------------------------------------------

  app.get("/api/cameras", (req, res) => {
    const stale = Date.now() - (config.health?.degradedSeconds ?? 15) * 1000;
    const onlineCutoff = Date.now() - (config.health?.onlineSeconds ?? 5) * 1000;
    const hlsBaseUrl = normalizeBaseUrl(config.ui?.hlsBaseUrl) || `${req.protocol}://${req.hostname}:${config.mediamtx.hlsPort}`;
    const webrtcBaseUrl = normalizeBaseUrl(config.ui?.webrtcBaseUrl) || `${req.protocol}://${req.hostname}:${config.mediamtx.webrtcPort}`;
    const latestByCamera = db.prepare(`
      SELECT camera_id, MAX(ended_at) AS last_ended_at, SUM(size_bytes) AS total_bytes
      FROM recordings GROUP BY camera_id
    `).all();
    const stats = new Map(latestByCamera.map((row) => [row.camera_id, row]));

    const cameras = config.cameras.map((cam) => {
      const stat = stats.get(cam.id);
      const lastEnded = stat?.last_ended_at ?? null;
      let status = "OFFLINE";
      if (lastEnded != null) {
        if (lastEnded >= onlineCutoff) status = "ONLINE";
        else if (lastEnded >= stale) status = "DEGRADED";
      }
      return {
        ...cam,
        webrtcUrl: `${webrtcBaseUrl}/${cam.id}/whep`,
        hlsUrl: `${hlsBaseUrl}/${cam.id}/index.m3u8`,
        health: {
          status,
          lastSegmentMs: lastEnded,
          totalRecordedBytes: stat?.total_bytes ?? 0
        }
      };
    });
    res.json({ cameras });
  });

  // ---- Edges -----------------------------------------------------------------

  app.get("/api/edges", (req, res) => {
    res.json({ edges: hub.listEdges() });
  });

  app.post("/api/edges/:edgeId/command", (req, res) => {
    const { type, ...rest } = req.body ?? {};
    if (!type) {
      res.status(400).json({ error: "command type required" });
      return;
    }
    const ok = hub.sendCommand(req.params.edgeId, type, rest);
    if (!ok) {
      res.status(404).json({ error: "edge not connected" });
      return;
    }
    res.json({ status: "ok" });
  });

  // ---- Config ----------------------------------------------------------------

  app.get("/api/config", (req, res) => {
    const { _paths, ...safe } = config;
    res.json(safe);
  });

  app.post("/api/config", (req, res) => {
    const payload = req.body ?? {};
    if (!Array.isArray(payload.cameras)) {
      res.status(400).json({ error: "cameras array required" });
      return;
    }
    const cameras = payload.cameras.map((cam, idx) => ({
      id: typeof cam.id === "string" ? cam.id : config.cameras[idx]?.id ?? `cam${idx + 1}`,
      name: typeof cam.name === "string" ? cam.name : config.cameras[idx]?.name ?? `Cam ${idx + 1}`,
      enabled: Boolean(cam.enabled),
      srtPort: Number.isFinite(cam.srtPort) ? cam.srtPort : config.cameras[idx]?.srtPort ?? 9001 + idx
    }));
    const next = {
      ...config,
      cameras,
      ui: { ...config.ui, ...(payload.ui ?? {}) },
      motion: { ...config.motion, ...(payload.motion ?? {}) },
      storage: { ...config.storage, ...(payload.storage ?? {}) }
    };
    persistConfig(next);
    refreshConfig();
    hub.broadcastToClients("config-updated", {});
    res.json({ status: "ok" });
  });

  // ---- Recordings index ------------------------------------------------------

  app.get("/api/recordings/:cameraId", (req, res) => {
    const from = Number(req.query.from);
    const to = Number(req.query.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
      res.status(400).json({ error: "from/to (unix ms) required" });
      return;
    }
    const rows = db.prepare(`
      SELECT id, started_at, ended_at, duration_ms, size_bytes
      FROM recordings WHERE camera_id = ? AND ended_at >= ? AND started_at <= ?
      ORDER BY started_at ASC
    `).all(req.params.cameraId, from, to);
    res.json({ recordings: rows });
  });

  app.get("/api/recordings/:cameraId/coverage", (req, res) => {
    const from = Number(req.query.from);
    const to = Number(req.query.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      res.status(400).json({ error: "from/to required" });
      return;
    }
    const buckets = Number(req.query.buckets) || 240;
    const rows = db.prepare(`
      SELECT started_at, ended_at FROM recordings
      WHERE camera_id = ? AND ended_at >= ? AND started_at <= ?
      ORDER BY started_at ASC
    `).all(req.params.cameraId, from, to);
    const bucketSize = (to - from) / buckets;
    const cov = new Array(buckets).fill(0);
    for (const row of rows) {
      const a = Math.max(row.started_at, from);
      const b = Math.min(row.ended_at, to);
      const i0 = Math.max(0, Math.floor((a - from) / bucketSize));
      const i1 = Math.min(buckets - 1, Math.floor((b - from) / bucketSize));
      for (let i = i0; i <= i1; i++) cov[i] = 1;
    }
    res.json({ coverage: cov, from, to, bucketSize });
  });

  // ---- Activity --------------------------------------------------------------

  app.get("/api/activity", (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 25, 100);
    const cursor = req.query.cursor ? Number(req.query.cursor) : null;
    const params = cursor != null ? [cursor, limit] : [Number.MAX_SAFE_INTEGER, limit];
    const rows = db.prepare(`
      SELECT id, camera_id AS cameraId, started_at AS startedAt, ended_at AS endedAt,
             score, thumbnail_path AS thumbnailPath, clip_path AS clipPath
      FROM motion_events WHERE started_at < ?
      ORDER BY started_at DESC LIMIT ?
    `).all(...params);
    const next = rows.length === limit ? rows[rows.length - 1].startedAt : null;
    res.json({ items: rows, nextCursor: next });
  });

  app.get("/api/activity/:id/clip", (req, res) => {
    const row = db.prepare("SELECT clip_path FROM motion_events WHERE id = ?").get(req.params.id);
    if (!row?.clip_path || !fs.existsSync(row.clip_path)) {
      res.status(404).end();
      return;
    }
    res.sendFile(row.clip_path);
  });

  app.get("/api/activity/:id/thumbnail", (req, res) => {
    const row = db.prepare("SELECT thumbnail_path FROM motion_events WHERE id = ?").get(req.params.id);
    if (!row?.thumbnail_path || !fs.existsSync(row.thumbnail_path)) {
      res.status(404).end();
      return;
    }
    res.sendFile(row.thumbnail_path);
  });

  // ---- Clip export -----------------------------------------------------------

  app.post("/api/export", async (req, res) => {
    const { cameras, from, to, quality } = req.body ?? {};
    if (!Array.isArray(cameras) || cameras.length === 0) {
      res.status(400).json({ error: "cameras required" });
      return;
    }
    const fromMs = Number(from);
    const toMs = Number(to);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
      res.status(400).json({ error: "invalid range" });
      return;
    }

    const stitched = [];
    for (const cameraId of cameras) {
      const segs = db.prepare(`
        SELECT path FROM recordings WHERE camera_id = ?
        AND ended_at >= ? AND started_at <= ?
        ORDER BY started_at ASC
      `).all(cameraId, fromMs, toMs).map((r) => r.path).filter(fs.existsSync);
      if (segs.length === 0) continue;
      const out = await stitchSegments(config, cameraId, segs, quality);
      if (out) stitched.push({ path: out, name: `${cameraId}-${fromMs}-${toMs}.mp4` });
    }

    if (stitched.length === 0) {
      res.status(404).json({ error: "no recordings in range" });
      return;
    }

    res.setHeader("Content-Disposition", "attachment; filename=chickencams-export.zip");
    res.setHeader("Content-Type", "application/zip");

    const archive = archiver("zip", { zlib: { level: 9 } });
    const cleanup = () => stitched.forEach((f) => { try { fs.unlinkSync(f.path); } catch {} });
    archive.on("error", (err) => { cleanup(); res.end(); });
    archive.on("end", cleanup);
    res.on("close", cleanup);
    archive.pipe(res);
    stitched.forEach((f) => archive.file(f.path, { name: f.name }));
    archive.finalize();
  });

  return app;
}

function transcodeArgs(quality) {
  if (quality === "med") return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "96k"];
  if (quality === "low") return ["-vf", "scale=-2:480", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-c:a", "aac", "-b:a", "96k"];
  return ["-c", "copy"];
}

async function stitchSegments(config, cameraId, segments, quality = "high") {
  const tmpDir = path.join(config._paths.rootDir, ".tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const jobId = `${cameraId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const listFile = path.join(tmpDir, `${jobId}.txt`);
  const outputFile = path.join(tmpDir, `${jobId}.mp4`);
  fs.writeFileSync(listFile, segments.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join("\n"));

  return await new Promise((resolve) => {
    const ff = spawn("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, ...transcodeArgs(quality), outputFile]);
    ff.on("error", () => { try { fs.unlinkSync(listFile); } catch {} resolve(null); });
    ff.on("close", (code) => {
      try { fs.unlinkSync(listFile); } catch {}
      resolve(code === 0 ? outputFile : null);
    });
  });
}
