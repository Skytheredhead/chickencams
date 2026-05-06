import chokidar from "chokidar";
import fs from "node:fs";
import path from "node:path";

// Filename format: <camera_id>/<YYYY-MM-DD_HH-MM-SS_fraction>.<ext>
const FILENAME_RE = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:[_.](\d+))?\.[a-z0-9]+$/i;

function parseStartedAt(filename) {
  const m = filename.match(FILENAME_RE);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, frac] = m;
  const ms = frac ? Math.min(999, Math.round(Number(`0.${frac}`) * 1000)) : 0;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms);
}

function extractCameraId(fullPath, recordingsRoot) {
  const rel = path.relative(recordingsRoot, fullPath);
  const segs = rel.split(path.sep);
  return segs.length >= 2 ? segs[0] : null;
}

export function startRecordingsIndex({ db, config, onChange }) {
  const recordingsRoot = config._paths.recordingsRoot;
  fs.mkdirSync(recordingsRoot, { recursive: true });

  const upsert = db.prepare(`
    INSERT INTO recordings (camera_id, path, started_at, ended_at, duration_ms, size_bytes)
    VALUES (@camera_id, @path, @started_at, @ended_at, @duration_ms, @size_bytes)
    ON CONFLICT(path) DO UPDATE SET
      ended_at = excluded.ended_at,
      duration_ms = excluded.duration_ms,
      size_bytes = excluded.size_bytes
  `);
  const remove = db.prepare("DELETE FROM recordings WHERE path = ?");

  function indexFile(fullPath) {
    let stats;
    try { stats = fs.statSync(fullPath); } catch { return; }
    if (!stats.isFile() || stats.size === 0) return;
    const cameraId = extractCameraId(fullPath, recordingsRoot);
    if (!cameraId) return;
    const filename = path.basename(fullPath);
    const startedAt = parseStartedAt(filename) ?? stats.birthtimeMs;
    const endedAt = stats.mtimeMs;
    const durationMs = Math.max(0, endedAt - startedAt);
    upsert.run({
      camera_id: cameraId,
      path: fullPath,
      started_at: Math.round(startedAt),
      ended_at: Math.round(endedAt),
      duration_ms: Math.round(durationMs),
      size_bytes: stats.size
    });
    onChange?.({ type: "add", cameraId, path: fullPath });
  }

  function removeFile(fullPath) {
    remove.run(fullPath);
    onChange?.({ type: "remove", path: fullPath });
  }

  const watcher = chokidar.watch(recordingsRoot, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 500 },
    depth: 4
  });

  watcher.on("add", indexFile);
  watcher.on("change", indexFile);
  watcher.on("unlink", removeFile);
  watcher.on("error", (err) => console.warn("[index] watcher error:", err.message));

  return watcher;
}

export function pruneOldRecordings(db, config) {
  const cap = Number(config.storage?.maxBackupGb);
  if (!Number.isFinite(cap) || cap <= 0) return;
  const capBytes = cap * 1024 * 1024 * 1024;
  const total = db.prepare("SELECT COALESCE(SUM(size_bytes),0) AS total FROM recordings").get().total;
  if (total <= capBytes) return;

  let toFree = total - capBytes;
  const oldest = db.prepare("SELECT id, path, size_bytes FROM recordings ORDER BY started_at ASC");
  const remove = db.prepare("DELETE FROM recordings WHERE id = ?");
  for (const row of oldest.iterate()) {
    if (toFree <= 0) break;
    try { fs.unlinkSync(row.path); } catch {}
    remove.run(row.id);
    toFree -= row.size_bytes;
  }
}
