#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number.parseInt(process.env.EDGE_UI_PORT ?? "3010", 10);
const registryPath = path.join(__dirname, "registry.json");

const defaultRegistry = {
  defaults: {
    serverHost: process.env.CHICKENCAMS_HOST ?? "",
    serverWsPort: 7979,
    // MediaMTX listens for SRT publishers on a single port (default 8890).
    srtPortBase: Number.parseInt(process.env.CHICKENCAMS_SRT_BASE ?? "8890", 10)
  },
  cameras: [
    { id: "cam1", name: "Cam 1", enabled: true, audioDevice: "" },
    { id: "cam2", name: "Cam 2", enabled: true, audioDevice: "" },
    { id: "cam3", name: "Cam 3", enabled: true, audioDevice: "" },
    { id: "cam4", name: "Cam 4", enabled: true, audioDevice: "" },
    { id: "cam5", name: "Cam 5", enabled: true, audioDevice: "" }
  ]
};

app.use(express.urlencoded({ extended: false }));

const loadRegistry = () => {
  try {
    if (!fs.existsSync(registryPath)) return defaultRegistry;
    const reg = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    const merged = {
      defaults: { ...defaultRegistry.defaults, ...(reg.defaults ?? {}) },
      cameras: Array.isArray(reg.cameras) && reg.cameras.length ? reg.cameras : defaultRegistry.cameras
    };
    // If a camera has no device selected (N/A), it should be treated as disabled.
    merged.cameras.forEach((cam) => {
      if (!cam.devicePath) cam.enabled = false;
    });
    return merged;
  } catch {
    return defaultRegistry;
  }
};

const saveRegistry = (reg) => {
  fs.writeFileSync(registryPath, `${JSON.stringify(reg, null, 2)}\n`);
};

const getVideoDevices = () => {
  const entries = [];
  for (const dir of ["/dev/v4l/by-id", "/dev/v4l/by-path"]) {
    try {
      for (const entry of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, entry);
        entries.push({
          fullPath,
          realPath: fs.existsSync(fullPath) ? fs.realpathSync(fullPath) : fullPath,
          isById: dir.endsWith("/by-id"),
          isIndex0: entry.endsWith("video-index0"),
          physicalKey: entry.replace(/-video-index\d+$/, "").replace(/-usbv\d+-/g, "-usb-")
        });
      }
    } catch {}
  }
  const byNode = new Map();
  entries.forEach((e) => {
    const cur = byNode.get(e.realPath);
    if (!cur || (e.isById && !cur.isById) || (e.isIndex0 && !cur.isIndex0)) byNode.set(e.realPath, e);
  });
  const byCam = new Map();
  byNode.forEach((e) => {
    const cur = byCam.get(e.physicalKey);
    if (!cur || (e.isIndex0 && !cur.isIndex0) || (e.isById && !cur.isById)) byCam.set(e.physicalKey, e);
  });
  return Array.from(byCam.values()).map((e) => e.fullPath).sort();
};

const getAudioDevices = () => {
  const devices = new Set(["default"]);
  const probe = spawnSync("arecord", ["-L"], { encoding: "utf-8" });
  if (probe.status === 0 && probe.stdout) {
    probe.stdout.split("\n").map((l) => l.trim())
      .filter((l) => l && !l.includes(" "))
      .forEach((entry) => devices.add(entry));
  }
  for (const dir of ["/dev/snd/by-id", "/dev/snd/by-path"]) {
    try { fs.readdirSync(dir).forEach((e) => devices.add(path.join(dir, e))); } catch {}
  }
  return Array.from(devices).filter((e) => e !== "null").sort();
};

const getLanAddresses = () => Object.values(os.networkInterfaces()).flat()
  .filter((e) => e && e.family === "IPv4" && !e.internal).map((e) => e.address);

const getDefaultPort = (cams, cameraId, basePort) => {
  // A single SRT listener port is shared by all cameras; streamid routes to paths.
  void cams; void cameraId;
  return basePort;
};

const renderPage = (message = "") => {
  const reg = loadRegistry();
  const cams = reg.cameras;
  const devices = getVideoDevices();
  const audioDevices = getAudioDevices();
  const addresses = getLanAddresses();
  const addressList = addresses.length ? addresses.join(", ") : "Unavailable";
  const basePort = reg.defaults.srtPortBase;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Chickencams Edge</title>
    <style>
      :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #09090b; color: #f4f4f5; }
      body { margin: 0; padding: 24px; }
      .container { max-width: 880px; margin: 0 auto; }
      h1 { font-size: 24px; margin: 0 0 16px; letter-spacing: -0.01em; }
      h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: #a1a1aa; margin: 0 0 12px; }
      .card { background: rgba(24, 24, 27, 0.8); border: 1px solid #27272a; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
      label { display: block; font-size: 12px; color: #a1a1aa; margin-bottom: 4px; }
      input, select { width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid #3f3f46; background: rgba(9,9,11,0.7); color: inherit; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      th, td { text-align: left; padding: 8px; border-bottom: 1px solid #27272a; font-size: 13px; }
      button { margin-top: 12px; padding: 8px 14px; border-radius: 8px; border: 1px solid #3f3f46; cursor: pointer; background: #18181b; color: #f4f4f5; font-weight: 500; }
      button:hover { background: #27272a; }
      .message { margin-top: 12px; color: #4ade80; font-size: 13px; }
      .empty { color: #71717a; font-size: 12px; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Chickencams Edge</h1>
      <p class="empty">Select USB cameras to publish to the central server over SRT.</p>

      <div class="card">
        <h2>This edge</h2>
        <p>Hostname: <strong>${os.hostname()}</strong></p>
        <p>LAN addresses: ${addressList}</p>
      </div>

      <div class="card">
        <h2>Capture configuration</h2>
        <p class="empty">Leave the central host blank to auto-discover via mDNS. SRT port is usually <code>${basePort}</code> for all cameras (MediaMTX uses streamid routing).</p>
        <form method="post" action="/save">
          <label for="serverHost">Central host (optional)</label>
          <input name="serverHost" id="serverHost" value="${reg.defaults.serverHost}" placeholder="auto-discover via mDNS" />
          <table>
            <thead><tr><th>Camera</th><th>Video device</th><th>SRT port</th><th>Audio</th><th>Enabled</th></tr></thead>
            <tbody>
              ${cams.map((cam) => `
                <tr>
                  <td>${cam.id}</td>
                  <td>
                    <select name="device_${cam.id}">
                      <option value="">N/A</option>
                      ${devices.map((d) => `<option value="${d}" ${d === cam.devicePath ? "selected" : ""}>${d}</option>`).join("")}
                    </select>
                  </td>
                  <td><input name="srtPort_${cam.id}" value="${cam.srtPort ?? getDefaultPort(cams, cam.id, basePort)}" /></td>
                  <td>
                    <select name="audio_${cam.id}">
                      <option value="">No audio</option>
                      ${audioDevices.map((d) => `<option value="${d}" ${d === cam.audioDevice ? "selected" : ""}>${d}</option>`).join("")}
                    </select>
                  </td>
                  <td><input type="checkbox" name="enabled_${cam.id}" ${cam.enabled ? "checked" : ""} /></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
          <button type="submit">Save configuration</button>
        </form>
        ${message ? `<div class="message">${message}</div>` : ""}
      </div>

      <div class="card">
        <h2>Supervisor</h2>
        <p class="empty">The supervisor reads this configuration. Run via <code>node Edge/supervisor.js</code> or install as the <code>edge.service</code> systemd unit.</p>
      </div>
    </div>
  </body>
</html>`;
};

app.get("/", (req, res) => {
  const message = typeof req.query.message === "string" ? req.query.message : "";
  res.send(renderPage(message));
});

app.post("/save", (req, res) => {
  const reg = loadRegistry();
  const serverHost = (req.body.serverHost || "").trim();
  reg.defaults.serverHost = serverHost;
  reg.cameras.forEach((cam) => {
    cam.devicePath = (req.body[`device_${cam.id}`] || "").trim();
    cam.srtPort = Number.parseInt(req.body[`srtPort_${cam.id}`], 10) || reg.defaults.srtPortBase;
    cam.audioDevice = (req.body[`audio_${cam.id}`] || "").trim();
    // If no device is selected (N/A), force disabled regardless of checkbox state.
    cam.enabled = Boolean(cam.devicePath) && req.body[`enabled_${cam.id}`] === "on";
  });
  saveRegistry(reg);
  res.redirect("/?message=Saved.+Supervisor+will+pick+up+changes+on+next+tick.");
});

const server = app.listen(port, "0.0.0.0", () => {
  const addrs = getLanAddresses();
  const list = addrs.length ? addrs : ["<lan-ip>"];
  console.log("Chickencams Edge UI running:");
  list.forEach((a) => console.log(`  http://${a}:${port}`));
});

server.on("error", (err) => {
  if (err?.code === "EADDRINUSE") {
    console.error(`Edge UI already running on port ${port}.`);
    process.exit(1);
  }
  console.error("Edge UI failed to start:", err);
  process.exit(1);
});
