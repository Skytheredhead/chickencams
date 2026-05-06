import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Per-camera motion detection. Pulls the LL-HLS rendition from MediaMTX,
// runs an ffmpeg `select=gt(scene,X)` filter, debounces hits, and on a
// sustained event stitches a clip from indexed recordings + saves a thumbnail.

function hasFfmpeg() {
  return spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
}

export function startMotionWorker({ db, config }) {
  if (!config.motion?.enabled) {
    console.log("[motion] disabled");
    return () => {};
  }
  if (!hasFfmpeg()) {
    console.warn("[motion] ffmpeg not found; motion disabled");
    return () => {};
  }

  const procs = new Map();
  const sensitivity = Number(config.motion.sensitivity) || 0.04;
  const minDurationMs = Number(config.motion.minDurationMs) || 1500;
  const preRollMs = Number(config.motion.preRollSeconds) * 1000 || 5000;
  const postRollMs = Number(config.motion.postRollSeconds) * 1000 || 5000;
  const activityRoot = config._paths.activityRoot;

  function spawnForCamera(cam) {
    const url = `http://127.0.0.1:${config.mediamtx.hlsPort}/${cam.id}/index.m3u8`;
    const args = [
      "-hide_banner", "-loglevel", "info",
      "-i", url,
      "-an",
      "-vf", `select='gt(scene,${sensitivity})',metadata=print:file=-`,
      "-f", "null", "-"
    ];
    const child = spawn("ffmpeg", args);
    let state = { firstHit: null, lastHit: null, eventOpen: false };

    const handleLine = (line) => {
      // ffmpeg prints `lavfi.scene_score=0.123` lines.
      const m = line.match(/scene_score=([\d.]+)/);
      if (!m) return;
      const score = Number(m[1]);
      if (!Number.isFinite(score) || score < sensitivity) return;
      const now = Date.now();
      state.lastHit = now;
      if (state.firstHit == null) state.firstHit = now;
      if (!state.eventOpen && now - state.firstHit >= minDurationMs) {
        state.eventOpen = true;
      }
    };

    let buf = "";
    child.stderr.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      lines.forEach(handleLine);
    });

    // Idle scan: every 1s, if event was open and lastHit is older than postRoll,
    // close the event and persist a clip.
    const idle = setInterval(async () => {
      if (!state.eventOpen) {
        if (state.lastHit && Date.now() - state.lastHit > 5000) {
          state = { firstHit: null, lastHit: null, eventOpen: false };
        }
        return;
      }
      if (Date.now() - state.lastHit < postRollMs) return;
      const startedAt = state.firstHit - preRollMs;
      const endedAt = state.lastHit + 200;
      state = { firstHit: null, lastHit: null, eventOpen: false };
      try {
        await persistMotionEvent({ db, config, cameraId: cam.id, startedAt, endedAt, score: sensitivity, activityRoot });
      } catch (err) {
        console.warn(`[motion] ${cam.id} persist failed: ${err.message}`);
      }
    }, 1000);

    child.on("exit", () => clearInterval(idle));
    return child;
  }

  for (const cam of config.cameras) {
    if (!cam.enabled) continue;
    procs.set(cam.id, spawnForCamera(cam));
  }

  return () => {
    for (const child of procs.values()) {
      try { child.kill("SIGTERM"); } catch {}
    }
    procs.clear();
  };
}

async function persistMotionEvent({ db, config, cameraId, startedAt, endedAt, score, activityRoot }) {
  const segs = db.prepare(`
    SELECT path FROM recordings WHERE camera_id = ?
    AND ended_at >= ? AND started_at <= ?
    ORDER BY started_at ASC
  `).all(cameraId, startedAt, endedAt).map((r) => r.path).filter(fs.existsSync);
  if (segs.length === 0) {
    db.prepare(`INSERT INTO motion_events (camera_id, started_at, ended_at, score) VALUES (?, ?, ?, ?)`)
      .run(cameraId, startedAt, endedAt, score);
    return;
  }

  const dir = path.join(activityRoot, cameraId);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, "-");
  const clipPath = path.join(dir, `${stamp}.mp4`);
  const thumbPath = path.join(dir, `${stamp}.jpg`);

  const listFile = clipPath + ".list";
  fs.writeFileSync(listFile, segs.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join("\n"));
  await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", clipPath]);
  try { fs.unlinkSync(listFile); } catch {}
  await runFfmpeg(["-y", "-i", clipPath, "-frames:v", "1", "-q:v", "3", thumbPath]);

  db.prepare(`
    INSERT INTO motion_events (camera_id, started_at, ended_at, score, thumbnail_path, clip_path)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(cameraId, startedAt, endedAt, score, thumbPath, clipPath);

  console.log(`[motion] ${cameraId} ${stamp} (${Math.round((endedAt - startedAt) / 1000)}s)`);
}

function runFfmpeg(args) {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", args, { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}
