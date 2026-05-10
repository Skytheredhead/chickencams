#!/usr/bin/env node
import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { discoverCentral } from "./mdns-client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const registryPath = path.join(__dirname, "registry.json");
const telemetryPath = path.join(__dirname, "telemetry.json");
const capturePath = path.join(__dirname, "capture.sh");

const defaultRegistry = {
  defaults: {
    serverHost: process.env.CHICKENCAMS_HOST || "",
    serverWsPort: 7979,
    // MediaMTX listens for SRT publishers on a single port (default 8890).
    srtPortBase: 8890,
    restartLimit: 5,
    restartWindowSeconds: 120,
    freezeTimeoutSeconds: 8,
    pollIntervalMs: 2000,
    cpuLimitPercent: 160,
    memoryLimitMb: 600
  },
  cameras: []
};

const running = new Map();
let activeCentral = null;
let ws = null;
let wsBackoffMs = 1000;
let wsReconnectTimer = null;
let telemetryTimer = null;
let lastCentralLogAt = 0;
let lastWsErrorAt = 0;

function loadRegistry() {
  try {
    if (!fs.existsSync(registryPath)) return defaultRegistry;
    const reg = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    return {
      defaults: { ...defaultRegistry.defaults, ...(reg.defaults ?? {}) },
      cameras: Array.isArray(reg.cameras) ? reg.cameras : []
    };
  } catch (error) {
    console.warn("[edge] failed to read registry.json:", error.message);
    return defaultRegistry;
  }
}

function saveRegistry(reg) {
  fs.writeFileSync(registryPath, JSON.stringify(reg, null, 2));
}

function isStableDevicePath(devicePath) {
  return typeof devicePath === "string" &&
    (devicePath.startsWith("/dev/v4l/by-id/") || devicePath.startsWith("/dev/v4l/by-path/"));
}

function ensureState(camera) {
  if (running.has(camera.id)) return running.get(camera.id);
  const state = {
    cameraId: camera.id,
    name: camera.name ?? camera.id,
    status: "OFFLINE",
    lastFrameMs: null,
    fps: null,
    restartCount: 0,
    restartWindow: [],
    cpuPercent: null,
    memoryMb: null,
    process: null,
    devicePresent: false,
    dead: false,
    suppressRestart: false
  };
  running.set(camera.id, state);
  return state;
}

function updateRestartWindow(state, limit, windowSeconds) {
  const now = Date.now();
  state.restartWindow = state.restartWindow.filter((t) => now - t < windowSeconds * 1000);
  state.restartWindow.push(now);
  state.restartCount += 1;
  if (state.restartWindow.length > limit) {
    state.dead = true;
    state.status = "DEAD";
    sendEvent({ kind: "camera-dead", cameraId: state.cameraId });
  }
}

function stopProcess(state, reason = "stopped") {
  if (state.process) {
    try { state.process.kill("SIGTERM"); } catch {}
  }
  state.process = null;
  if (!state.dead) state.status = reason === "missing-device" ? "OFFLINE" : "DEGRADED";
  state.suppressRestart = ["missing-device", "disabled"].includes(reason);
}

function startProcess(camera, defaults, index) {
  if (!activeCentral) return;
  const state = ensureState(camera);
  if (state.dead) return;
  if (!isStableDevicePath(camera.devicePath) || !fs.existsSync(camera.devicePath)) {
    state.devicePresent = false;
    state.status = "OFFLINE";
    return;
  }
  state.devicePresent = true;
  void index;
  const srtPort = camera.srtPort ?? defaults.srtPortBase;
  const args = [camera.id, camera.devicePath, activeCentral.host, String(srtPort)];
  if (camera.audioDevice) args.push(camera.audioDevice);
  const child = spawn(capturePath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FFMPEG_PROGRESS: "1" }
  });
  state.process = child;
  state.suppressRestart = false;
  state.status = "ONLINE";
  state.lastFrameMs = null;

  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const [k, v] = line.split("=");
      if (k === "fps") {
        const parsed = Number.parseFloat(v);
        if (Number.isFinite(parsed)) state.fps = parsed;
      } else if (k === "out_time_ms") {
        if (Number.isFinite(Number.parseInt(v, 10))) state.lastFrameMs = Date.now();
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${camera.id}] ${chunk.toString()}`);
  });
  child.on("exit", () => {
    state.process = null;
    if (!state.dead) {
      state.status = "OFFLINE";
      if (state.suppressRestart) state.suppressRestart = false;
      else updateRestartWindow(state, defaults.restartLimit, defaults.restartWindowSeconds);
    }
  });
}

function getProcessStats(pid) {
  return new Promise((resolve) => {
    execFile("ps", ["-o", "%cpu,rss", "-p", String(pid)], (err, stdout) => {
      if (err) return resolve({ cpuPercent: null, memoryMb: null });
      const lines = stdout.trim().split("\n");
      if (lines.length < 2) return resolve({ cpuPercent: null, memoryMb: null });
      const [cpuRaw, rssRaw] = lines[1].trim().split(/\s+/);
      resolve({
        cpuPercent: Number.parseFloat(cpuRaw) || null,
        memoryMb: Number.isFinite(Number.parseInt(rssRaw, 10)) ? Math.round(Number(rssRaw) / 1024) : null
      });
    });
  });
}

async function enforceLimits(state, cam, defaults) {
  if (!state.process) return;
  const cpuLimit = cam.cpuLimitPercent ?? defaults.cpuLimitPercent;
  const memLimit = cam.memoryLimitMb ?? defaults.memoryLimitMb;
  const stats = await getProcessStats(state.process.pid);
  state.cpuPercent = stats.cpuPercent;
  state.memoryMb = stats.memoryMb;
  if ((cpuLimit && stats.cpuPercent && stats.cpuPercent > cpuLimit) ||
      (memLimit && stats.memoryMb && stats.memoryMb > memLimit)) {
    sendEvent({ kind: "camera-resource-restart", cameraId: state.cameraId });
    stopProcess(state, "resource-limit");
  }
}

function checkWatchdog(state, cam, defaults) {
  if (!state.process || state.dead) return;
  const timeoutMs = (cam.freezeTimeoutSeconds ?? defaults.freezeTimeoutSeconds) * 1000;
  if (state.lastFrameMs && Date.now() - state.lastFrameMs > timeoutMs) {
    sendEvent({ kind: "camera-frozen", cameraId: state.cameraId });
    stopProcess(state, "frozen");
  }
}

function getLanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((e) => e && e.family === "IPv4" && !e.internal)
    .map((e) => e.address);
}

function buildHello(reg) {
  const addrs = getLanAddresses();
  return {
    type: "hello",
    id: `${os.hostname()}:${addrs[0] || "unknown"}`,
    hostname: os.hostname(),
    addresses: addrs,
    ip: addrs[0] || "",
    cameras: reg.cameras.map((c) => ({ id: c.id, name: c.name, enabled: !!c.enabled }))
  };
}

function buildTelemetry() {
  return {
    type: "telemetry",
    payload: {
      updatedAt: Date.now(),
      cpuLoad: os.loadavg()[0],
      cameras: Array.from(running.values()).map((s) => ({
        id: s.cameraId,
        name: s.name,
        status: s.dead ? "DEAD" : s.status,
        lastFrameMs: s.lastFrameMs,
        fps: s.fps,
        restartCount: s.restartCount,
        cpuPercent: s.cpuPercent,
        memoryMb: s.memoryMb
      }))
    }
  };
}

function sendEvent(event) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "event", event }));
  }
}

function writeTelemetryFile() {
  try { fs.writeFileSync(telemetryPath, JSON.stringify(buildTelemetry().payload, null, 2)); } catch {}
}

async function ensureCentral() {
  if (activeCentral) return activeCentral;
  const reg = loadRegistry();
  if (reg.defaults.serverHost) {
    activeCentral = { host: reg.defaults.serverHost, port: reg.defaults.serverWsPort };
    const now = Date.now();
    if (now - lastCentralLogAt > 5000) {
      console.log(`[edge] using configured central ${activeCentral.host}:${activeCentral.port}`);
      lastCentralLogAt = now;
    }
    return activeCentral;
  }
  console.log("[edge] discovering central via mDNS...");
  const found = await discoverCentral({ timeoutMs: 5000 });
  if (found) {
    activeCentral = found;
    console.log(`[edge] discovered central at ${found.host}:${found.port}`);
  } else {
    const now = Date.now();
    if (now - lastCentralLogAt > 5000) {
      console.warn("[edge] no central discovered yet (mDNS). Set a Central host in the UI or CHICKENCAMS_HOST.");
      lastCentralLogAt = now;
    }
  }
  return activeCentral;
}

function connectWs() {
  if (!activeCentral) return;
  if (ws && [WebSocket.CONNECTING, WebSocket.OPEN].includes(ws.readyState)) return;
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
  const url = `ws://${activeCentral.host}:${activeCentral.port}/ws/edge`;
  console.log(`[edge] connecting websocket ${url}`);
  const socket = new WebSocket(url);
  ws = socket;
  socket.on("open", () => {
    wsBackoffMs = 1000;
    console.log(`[edge] websocket connected (${url})`);
    socket.send(JSON.stringify(buildHello(loadRegistry())));
    if (telemetryTimer) clearInterval(telemetryTimer);
    telemetryTimer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(buildTelemetry()));
      writeTelemetryFile();
    }, 1000);
  });
  socket.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    handleCommand(msg);
  });
  socket.on("close", (code, reason) => {
    if (ws !== socket) return;
    ws = null;
    if (telemetryTimer) { clearInterval(telemetryTimer); telemetryTimer = null; }
    console.warn(`[edge] websocket closed code=${code} reason=${reason?.toString?.() || ""}`.trim());
    wsReconnectTimer = setTimeout(() => {
      wsReconnectTimer = null;
      connectWs();
    }, wsBackoffMs);
    wsBackoffMs = Math.min(wsBackoffMs * 2, 30000);
  });
  socket.on("error", (err) => {
    const now = Date.now();
    if (now - lastWsErrorAt > 2000) {
      console.warn(`[edge] websocket error: ${err?.message || String(err)}`);
      lastWsErrorAt = now;
    }
    try { socket.close(); } catch {}
  });
}

function handleCommand(msg) {
  const reg = loadRegistry();
  if (msg.type === "stop-camera") {
    const cam = reg.cameras.find((c) => c.id === msg.cameraId);
    if (cam) { cam.enabled = false; saveRegistry(reg); }
  } else if (msg.type === "start-camera") {
    const cam = reg.cameras.find((c) => c.id === msg.cameraId);
    if (cam) { cam.enabled = true; saveRegistry(reg); }
  } else if (msg.type === "restart-supervisor") {
    process.exit(0);
  }
}

async function tick() {
  await ensureCentral();
  writeTelemetryFile();
  if (!activeCentral) return;
  if (!ws || ws.readyState === WebSocket.CLOSED) connectWs();

  const reg = loadRegistry();
  const defaults = reg.defaults;

  reg.cameras.forEach((cam, idx) => {
    const state = ensureState(cam);
    // Treat "N/A" (no devicePath) as disabled. The UI also forces this, but keep it safe here.
    if (!cam.devicePath) {
      cam.enabled = false;
    }
    if (!cam.enabled) {
      stopProcess(state, "disabled");
      state.status = "OFFLINE";
      return;
    }
    state.devicePresent = Boolean(cam.devicePath && fs.existsSync(cam.devicePath));
    if (!state.devicePresent) {
      // Don't spam logs: missing devices can be transient and are visible in telemetry/UI.
      stopProcess(state, "missing-device");
      return;
    }
    if (!state.process) {
      console.log(`[edge] starting ${cam.id} -> ${activeCentral.host} srtPort=${cam.srtPort ?? defaults.srtPortBase}`);
      startProcess(cam, defaults, idx);
    }
  });

  for (const state of running.values()) {
    if (state.dead) continue;
    const cam = reg.cameras.find((c) => c.id === state.cameraId);
    if (cam) {
      checkWatchdog(state, cam, defaults);
      await enforceLimits(state, cam, defaults);
    }
  }
}

function main() {
  const reg = loadRegistry();
  const interval = reg.defaults.pollIntervalMs ?? defaultRegistry.defaults.pollIntervalMs;
  console.log(`[edge] starting supervisor (registry: ${registryPath})`);
  tick();
  setInterval(tick, interval);
}

main();
