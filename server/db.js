import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

let db = null;

export function openDb(config) {
  if (db) return db;
  const dbPath = path.resolve(config._paths.rootDir, config.paths.dbPath || "server/index.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS recordings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      camera_id TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      duration_ms INTEGER,
      size_bytes INTEGER NOT NULL,
      has_motion INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_recordings_camera_started ON recordings(camera_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_recordings_started ON recordings(started_at);

    CREATE TABLE IF NOT EXISTS motion_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      camera_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      thumbnail_path TEXT,
      clip_path TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_motion_camera_started ON motion_events(camera_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_motion_started ON motion_events(started_at);
  `);
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
