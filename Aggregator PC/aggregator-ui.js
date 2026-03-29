#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number.parseInt(process.env.AGGREGATOR_UI_PORT ?? "3010", 10);
const registryPath = path.join(__dirname, "registry.json");
const faviconDataUrl = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' fill='%23000'/%3E%3Ctext x='32' y='45' text-anchor='middle' font-size='40' font-weight='700' font-family='Arial%2C%20Helvetica%2C%20sans-serif' fill='%23fff'%3EA%3C/text%3E%3C/svg%3E";
const defaultRegistry = {
  defaults: {
    serverHost: process.env.AGGREGATOR_SERVER_HOST ?? "chickens.local",
    serverPortBase: Number.parseInt(process.env.AGGREGATOR_SERVER_PORT ?? "9001", 10),
  },
  cameras: [
    { id: "cam1", name: "Cam 1", enabled: true, audioDevice: "" },
    { id: "cam2", name: "Cam 2", enabled: true, audioDevice: "" },
    { id: "cam3", name: "Cam 3", enabled: true, audioDevice: "" },
    { id: "cam4", name: "Cam 4", enabled: true, audioDevice: "" },
    { id: "cam5", name: "Cam 5", enabled: true, audioDevice: "" },
  ],
};
const running = new Map();
let lastStartAt = 0;

function stopCaptureProcess(session) {
  if (!session?.process) return;
  try {
    if (Number.isFinite(session.process.pid)) {
      try { process.kill(-session.process.pid, "SIGTERM"); } catch { session.process.kill("SIGTERM"); }
      return;
    }
    session.process.kill("SIGTERM");
  } catch (error) {
    console.warn(`Failed to stop capture ${session.cameraId}:`, error.message);
  }
}

app.use(express.urlencoded({ extended: false }));

const loadRegistry = () => {
  try {
    if (!fs.existsSync(registryPath)) return defaultRegistry;
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    return {
      defaults: { ...defaultRegistry.defaults, ...(registry.defaults ?? {}) },
      cameras: Array.isArray(registry.cameras) && registry.cameras.length ? registry.cameras : defaultRegistry.cameras,
    };
  } catch (error) {
    console.warn("Failed to read registry.json, using defaults.", error);
    return defaultRegistry;
  }
};

const saveRegistry = (registry) => {
  try { fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf-8"); }
  catch (error) { console.warn("Failed to write registry.json.", error); }
};

const getVideoDevices = () => {
  const devices = new Set();
  ["/dev/v4l/by-id", "/dev/v4l/by-path"].forEach((dir) => {
    try { fs.readdirSync(dir).forEach((entry) => devices.add(path.join(dir, entry))); } catch { }
  });
  return Array.from(devices).sort();
};

const getAudioDevices = () => {
  const devices = new Set();
  devices.add("default");
  const probe = spawnSync("arecord", ["-L"], { encoding: "utf-8" });
  if (probe.status === 0 && probe.stdout) {
    probe.stdout.split("\n").map(l => l.trim()).filter(l => l && !l.includes(" ")).forEach(e => devices.add(e));
  }
  ["/dev/snd/by-id", "/dev/snd/by-path"].forEach((dir) => {
    try { fs.readdirSync(dir).forEach((entry) => devices.add(path.join(dir, entry))); } catch { }
  });
  return Array.from(devices).filter(e => e !== "null").sort();
};

const getLanAddresses = () => {
  const interfaces = os.networkInterfaces();
  return Object.values(interfaces).flat().filter(e => e && e.family === "IPv4" && !e.internal).map(e => e.address);
};

const getDefaultPort = (cameraList, cameraId, basePort) => {
  const index = cameraList.findIndex(c => c.id === cameraId);
  return index === -1 ? basePort : basePort + index;
};

const renderPage = (message = "") => {
  const registry      = loadRegistry();
  const cameraList    = registry.cameras;
  const devices       = getVideoDevices();
  const audioDevices  = getAudioDevices();
  const sessions      = Array.from(running.values());
  const addresses     = getLanAddresses();
  const addressList   = addresses.length ? addresses.join(", ") : "Unavailable";
  const defaultServer = registry.defaults.serverHost;
  const defaultPort   = registry.defaults.serverPortBase;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Chickencams Aggregator</title>
  <link rel="icon" type="image/svg+xml" href="${faviconDataUrl}" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:           #07070a;
      --surface:      #0f0f14;
      --border:       #1c1c24;
      --border-hi:    #2a2a36;
      --text:         #e8e8f0;
      --muted:        #5a5a72;
      --subtle:       #1e1e28;
      --accent:       #3b82f6;
      color-scheme: dark;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Outfit', system-ui, sans-serif;
      font-size: 14px;
      min-height: 100vh;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 0 24px;
      height: 52px;
      border-bottom: 1px solid var(--border);
    }

    .site-name {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .address-pill {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: var(--muted);
      background: var(--surface);
      border: 1px solid var(--border-hi);
      border-radius: 999px;
      padding: 3px 12px;
    }

    main {
      max-width: 860px;
      margin: 0 auto;
      padding: 24px;
      display: grid;
      gap: 16px;
    }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
    }

    .card-header {
      padding: 14px 20px;
      border-bottom: 1px solid var(--border);
    }

    .card-header h2 { font-size: 13px; font-weight: 600; }

    .card-body { padding: 20px; }

    .field { display: flex; flex-direction: column; gap: 6px; }

    .field label {
      font-size: 10px;
      font-weight: 500;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    input[type="text"],
    input[type="number"],
    select {
      width: 100%;
      padding: 7px 10px;
      background: var(--bg);
      border: 1px solid var(--border-hi);
      border-radius: 6px;
      color: var(--text);
      font-family: inherit;
      font-size: 13px;
      outline: none;
      transition: border-color 0.15s;
      -webkit-appearance: none;
    }

    input:focus, select:focus { border-color: var(--accent); }

    .server-row {
      display: flex;
      align-items: flex-end;
      gap: 16px;
      margin-bottom: 20px;
    }

    .server-row .field { width: 240px; flex-shrink: 0; }

    .server-row small {
      font-size: 11px;
      color: var(--muted);
      padding-bottom: 9px;
      line-height: 1.5;
    }

    .cam-table { width: 100%; border-collapse: collapse; }

    .cam-table thead tr { border-bottom: 1px solid var(--border); }

    .cam-table th {
      font-size: 10px;
      font-weight: 500;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.07em;
      text-align: left;
      padding: 0 10px 10px 0;
    }

    .cam-table td {
      padding: 8px 10px 8px 0;
      vertical-align: middle;
      border-bottom: 1px solid var(--border);
    }

    .cam-table td:first-child {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: var(--muted);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      white-space: nowrap;
      width: 60px;
    }

    .cam-table tbody tr:last-child td { border-bottom: none; }

    .card-actions {
      padding: 14px 20px;
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      padding: 7px 16px;
      border-radius: 6px;
      border: 1px solid var(--border-hi);
      background: var(--subtle);
      color: var(--text);
      font-family: inherit;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }

    .btn:hover { background: var(--border-hi); }
    .btn:disabled { opacity: 0.4; cursor: default; }

    .btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    .btn-primary:hover { background: #2563eb; border-color: #2563eb; }

    .btn-danger { background: transparent; border-color: var(--border-hi); color: #f87171; }
    .btn-danger:hover { background: rgba(248,113,113,0.08); border-color: rgba(248,113,113,0.3); }

    .message { font-size: 12px; color: #6ee7b7; }
    .empty { font-size: 13px; color: var(--muted); }
  </style>
</head>
<body>
  <header>
    <span class="site-name">Chickencams Aggregator</span>
    <span class="address-pill">${addressList}</span>
  </header>

  <main>
    <div class="card">
      <div class="card-header"><h2>Start captures</h2></div>
      <div class="card-body">
        <form method="post" action="/start" id="startForm">
          <div class="server-row">
            <div class="field">
              <label for="serverHost">Server IP / hostname</label>
              <input name="serverHost" id="serverHost" value="${defaultServer}" placeholder="192.168.1.50" required />
            </div>
            <small>Ports increment from ${defaultPort}.<br>Use LAN IP if .local doesn't resolve.</small>
          </div>

          <table class="cam-table">
            <thead>
              <tr>
                <th>Camera</th>
                <th>Video device</th>
                <th style="width:100px">Port</th>
                <th>Audio device</th>
              </tr>
            </thead>
            <tbody>
              ${cameraList.map(camera => `
              <tr>
                <td>${camera.id}</td>
                <td>
                  <select name="device_${camera.id}">
                    <option value="">N/A</option>
                    ${devices.map(d => `<option value="${d}"${d === camera.devicePath ? " selected" : ""}>${d}</option>`).join("")}
                  </select>
                </td>
                <td>
                  <input name="serverPort_${camera.id}" type="number" value="${camera.serverPort ?? getDefaultPort(cameraList, camera.id, defaultPort)}" />
                </td>
                <td>
                  <select name="audio_${camera.id}">
                    <option value="">No audio</option>
                    ${audioDevices.map(d => `<option value="${d}"${d === camera.audioDevice ? " selected" : ""}>${d}</option>`).join("")}
                  </select>
                </td>
              </tr>`).join("")}
            </tbody>
          </table>
        </form>
      </div>
      <div class="card-actions">
        <button class="btn btn-primary" type="submit" form="startForm" id="startButton">Start selected</button>
        ${message ? `<span class="message">${message}</span>` : ""}
      </div>
    </div>

    <div class="card">
      <div class="card-header"><h2>Active captures</h2></div>
      <div class="card-body">
        ${sessions.length ? `
        <table class="cam-table">
          <thead>
            <tr>
              <th>Camera</th>
              <th>Device</th>
              <th>Server</th>
              <th>PID</th>
              <th>Audio</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${sessions.map(s => `
            <tr>
              <td>${s.cameraId}</td>
              <td>${s.device}</td>
              <td style="font-family:'JetBrains Mono',monospace;font-size:11px">${s.serverHost}:${s.serverPort}</td>
              <td style="font-family:'JetBrains Mono',monospace;font-size:11px">${s.pid}</td>
              <td>${s.audioDevice || "—"}</td>
              <td>
                <form method="post" action="/stop" style="display:inline">
                  <input type="hidden" name="cameraId" value="${s.cameraId}" />
                  <button class="btn btn-danger" type="submit">Stop</button>
                </form>
              </td>
            </tr>`).join("")}
          </tbody>
        </table>` : `<p class="empty">No capture processes running.</p>`}
      </div>
    </div>
  </main>

  <script>
    const form            = document.getElementById("startForm");
    const button          = document.getElementById("startButton");
    const serverHostInput = document.getElementById("serverHost");
    const heartbeatHostname  = ${JSON.stringify(os.hostname())};
    const heartbeatAddresses = ${JSON.stringify(addresses)};
    const heartbeatIntervalMs = 15000;

    function getHeartbeatServerHost() {
      return (serverHostInput?.value || "").trim();
    }

    async function sendHeartbeat() {
      const serverHost = getHeartbeatServerHost();
      if (!serverHost) return;
      try {
        await fetch("http://" + serverHost + ":7979/api/aggregators/heartbeat", {
          method: "POST",
          mode: "cors",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: heartbeatHostname + ":" + (heartbeatAddresses[0] || "unknown"),
            hostname: heartbeatHostname,
            ip: heartbeatAddresses[0] || "",
            addresses: heartbeatAddresses,
          }),
        });
      } catch { }
    }

    if (form && button) {
      form.addEventListener("submit", () => {
        button.disabled = true;
        button.textContent = "Starting…";
        sendHeartbeat();
      });
    }

    sendHeartbeat();
    setInterval(sendHeartbeat, heartbeatIntervalMs);
  </script>
</body>
</html>`;
};

app.get("/", (req, res) => {
  const message = typeof req.query.message === "string" ? req.query.message : "";
  res.send(renderPage(message));
});

app.post("/start", (req, res) => {
  const now = Date.now();
  if (now - lastStartAt < 2000) { res.redirect("/?message=Capture+request+already+in+progress"); return; }
  lastStartAt = now;

  const { serverHost } = req.body;
  if (!serverHost) { res.redirect("/?message=Missing+server+host"); return; }

  const capturePath = path.join(__dirname, "capture.sh");
  const started = [];
  const registry = loadRegistry();
  const cameraList = registry.cameras;
  registry.defaults.serverHost = serverHost;

  cameraList.forEach((camera) => {
    const cameraId    = camera.id;
    const device      = req.body[`device_${cameraId}`];
    const serverPort  = req.body[`serverPort_${cameraId}`];
    const audioDevice = req.body[`audio_${cameraId}`];
    camera.devicePath  = device || "";
    camera.serverPort  = serverPort || "";
    camera.audioDevice = audioDevice || "";

    if (!device || !serverPort) return;

    const existing = running.get(cameraId);
    if (existing) { stopCaptureProcess(existing); running.delete(cameraId); }

    const args = [cameraId, device, serverHost, serverPort];
    if (audioDevice) args.push(audioDevice);

    const childProcess = spawn(capturePath, args, { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    childProcess.stdout.on("data", (chunk) => process.stderr.write(chunk));

    running.set(cameraId, { cameraId, device, serverHost, serverPort, pid: childProcess.pid, process: childProcess, audioDevice: audioDevice || "" });
    childProcess.on("exit", () => running.delete(cameraId));
    started.push(`${cameraId} (${device})`);
  });

  saveRegistry(registry);

  if (!started.length) { res.redirect("/?message=No+cameras+selected"); return; }
  res.redirect(`/?message=Started+${encodeURIComponent(started.join(",+"))}`);
});

app.post("/stop", (req, res) => {
  const { cameraId } = req.body;
  const session = running.get(cameraId);
  if (session) { stopCaptureProcess(session); running.delete(cameraId); }
  res.redirect("/?message=Stopped+capture");
});

app.listen(port, "0.0.0.0", () => {
  const addresses = getLanAddresses();
  const addressList = addresses.length ? addresses : ["<lan-ip>"];
  console.log("Chickencams Aggregator UI running:");
  addressList.forEach((address) => console.log(`  http://${address}:${port}`));
  console.log("Use CTRL+C to stop.");
});
