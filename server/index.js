import http from "node:http";
import path from "node:path";
import express from "express";
import fs from "node:fs";

import { loadConfig, ensureStorageDirs } from "./config.js";
import { openDb } from "./db.js";
import { startRecordingsIndex, pruneOldRecordings } from "./recordings-index.js";
import { createWsHub } from "./ws-hub.js";
import { advertiseCentral } from "./mdns.js";
import { startMediaMTX } from "./mediamtx-runner.js";
import { createApi } from "./api.js";
import { startMotionWorker } from "./motion-worker.js";

let config = loadConfig();
ensureStorageDirs(config);

const db = openDb(config);
let mediamtxChild = null;
let motionStop = null;

function refreshConfig() {
  config = loadConfig();
  ensureStorageDirs(config);
  // Restart mediamtx with the new path table.
  if (mediamtxChild) {
    try { mediamtxChild.kill("SIGTERM"); } catch {}
  }
  mediamtxChild = startMediaMTX(config, { onExit: () => { mediamtxChild = null; } });
  // Restart motion worker.
  motionStop?.();
  motionStop = startMotionWorker({ db, config });
}

const watcher = startRecordingsIndex({ db, config, onChange: () => {} });
setInterval(() => pruneOldRecordings(db, config), 10 * 60 * 1000).unref?.();

const app = express();
const webDist = path.join(config._paths.rootDir, "web", "dist");

const httpServer = http.createServer(app);
const hub = createWsHub({ httpServer, onEdgeMessage: () => {} });
const api = createApi({ config, db, hub, refreshConfig });
app.use(api);

if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api|ws|streams|activity).*/, (req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
} else {
  app.get("/", (req, res) => {
    res.type("html").send(`
      <h1>Chickencams</h1>
      <p>The web UI hasn't been built yet. Run <code>npm run build:web</code> in the repo root.</p>
      <p>API is live at <code>/api/*</code>.</p>
    `);
  });
}

mediamtxChild = startMediaMTX(config, { onExit: () => { mediamtxChild = null; } });
motionStop = startMotionWorker({ db, config });

const stopMdns = advertiseCentral({ port: config.server.port });

httpServer.listen(config.server.port, config.server.host, () => {
  console.log(`[central] listening on http://${config.server.host}:${config.server.port}`);
});

function shutdown() {
  console.log("[central] shutting down");
  try { watcher.close(); } catch {}
  try { stopMdns(); } catch {}
  try { motionStop?.(); } catch {}
  try { mediamtxChild?.kill("SIGTERM"); } catch {}
  try { httpServer.close(); } catch {}
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
