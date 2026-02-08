#!/usr/bin/env node
import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const registryPath = path.join(__dirname, "registry.json");
const telemetryPath = path.join(__dirname, "telemetry.json");
const capturePath = path.join(__dirname, "capture.sh");

const defaultRegistry = {
  defaults: {
    serverHost: "chickens.local",
    serverPortBase: 9001,
    restartLimit: 5,
    restartWindowSeconds: 120,
    freezeTimeoutSeconds: 8,
    pollIntervalMs: 2000,
    cpuLimitPercent: 160,
    memoryLimitMb: 600,
  },
  cameras: [],
};

const running = new Map();

function loadRegistry() {
  try {
    if (!fs.existsSync(registryPath)) {
      return defaultRegistry;
    }
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    return {
      defaults: { ...defaultRegistry.defaults, ...(registry.defaults ?? {}) },
      cameras: Array.isArray(registry.cameras) ? registry.cameras : defaultRegistry.cameras,
    };
  } catch (error) {
    console.warn("Failed to read registry.json, using defaults.", error);
    return defaultRegistry;
  }
}

function isStableDevicePath(devicePath) {
  return (
    typeof devicePath === "string" &&
    (devicePath.startsWith("/dev/v4l/by-id/") ||
      devicePath.startsWith("/dev/v4l/by-path/") ||
      devicePath.startsWith("/dev/serial/"))
  );
}

function ensureState(camera) {
  if (running.has(camera.id)) {
    return running.get(camera.id);
  }
  const state = {
    cameraId: camera.id,
    name: camera.name ?? camera.id,
    status: "OFFLINE",
    lastFrameMs: null,
    fps: null,
    restartCount: 0,
    restartWindow: [],
    lastRestartMs: null,
    cpuPercent: null,
    memoryMb: null,
    process: null,
    devicePresent: false,
    dead: false,
    suppressRestart: false,
  };
  running.set(camera.id, state);
  return state;
}

function updateRestartWindow(state, limit, windowSeconds) {
  const now = Date.now();
  state.restartWindow = state.restartWindow.filter((timestamp) => now - timestamp < windowSeconds * 1000);
  state.restartWindow.push(now);
  state.restartCount += 1;
  state.lastRestartMs = now;
  if (state.restartWindow.length > limit) {
    state.dead = true;
    state.status = "DEAD";
    console.warn(`[${state.cameraId}] Marked DEAD after ${state.restartWindow.length} restarts.`);
  }
}

function stopProcess(state, reason = "stopped") {
  if (state.process) {
    state.process.kill("SIGTERM");
  }
  state.process = null;
  if (!state.dead) {
    state.status = reason === "missing-device" ? "OFFLINE" : "DEGRADED";
  }
  state.suppressRestart = ["missing-device", "disabled"].includes(reason);
}

function startProcess(camera, defaults, index) {
  const state = ensureState(camera);
  if (state.dead) {
    return;
  }
  const devicePath = camera.devicePath;
  if (!isStableDevicePath(devicePath)) {
    state.status = "OFFLINE";
    console.warn(`[${camera.id}] Skipping because device path is not a stable symlink: ${devicePath}`);
    return;
  }
  if (!fs.existsSync(devicePath)) {
    state.devicePresent = false;
    state.status = "OFFLINE";
    return;
  }
  state.devicePresent = true;
  const serverHost = camera.serverHost ?? defaults.serverHost;
  const basePort = Number.isFinite(defaults.serverPortBase) ? defaults.serverPortBase : 9001;
  const serverPort = camera.serverPort ?? basePort + (Number.isFinite(index) ? index : 0);
  const args = [camera.id, devicePath, serverHost, String(serverPort)];
  if (camera.audioDevice) {
    args.push(camera.audioDevice);
  }
  const child = spawn(capturePath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FFMPEG_PROGRESS: "1" },
  });
  state.process = child;
  state.suppressRestart = false;
  state.status = "ONLINE";
  state.lastFrameMs = null;
  state.fps = null;

  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach((line) => {
      const [key, value] = line.split("=");
      if (!key) {
        return;
      }
      if (key === "fps") {
        const parsed = Number.parseFloat(value);
        state.fps = Number.isFinite(parsed) ? parsed : state.fps;
      }
      if (key === "out_time_ms") {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) {
          state.lastFrameMs = Date.now();
        }
      }
    });
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${camera.id}] ${chunk.toString()}`);
  });

  child.on("exit", () => {
    state.process = null;
    if (!state.dead) {
      state.status = "OFFLINE";
      if (state.suppressRestart) {
        state.suppressRestart = false;
      } else {
        updateRestartWindow(state, defaults.restartLimit, defaults.restartWindowSeconds);
      }
    }
  });
}

function getProcessStats(pid) {
  return new Promise((resolve) => {
    execFile("ps", ["-o", "%cpu,rss", "-p", String(pid)], (error, stdout) => {
      if (error) {
        resolve({ cpuPercent: null, memoryMb: null });
        return;
      }
      const lines = stdout.trim().split("\n");
      if (lines.length < 2) {
        resolve({ cpuPercent: null, memoryMb: null });
        return;
      }
      const [cpuRaw, rssRaw] = lines[1].trim().split(/\s+/);
      const cpuPercent = Number.parseFloat(cpuRaw);
      const rssKb = Number.parseInt(rssRaw, 10);
      resolve({
        cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : null,
        memoryMb: Number.isFinite(rssKb) ? Math.round(rssKb / 1024) : null,
      });
    });
  });
}

async function enforceResourceLimits(state, camera, defaults) {
  if (!state.process) {
    return;
  }
  const limits = {
    cpu: camera.cpuLimitPercent ?? defaults.cpuLimitPercent,
    mem: camera.memoryLimitMb ?? defaults.memoryLimitMb,
  };
  const stats = await getProcessStats(state.process.pid);
  state.cpuPercent = stats.cpuPercent;
  state.memoryMb = stats.memoryMb;
  if ((limits.cpu && stats.cpuPercent && stats.cpuPercent > limits.cpu) || (limits.mem && stats.memoryMb && stats.memoryMb > limits.mem)) {
    console.warn(`[${state.cameraId}] Resource limits exceeded, restarting.`);
    stopProcess(state, "resource-limit");
  }
}

function checkWatchdog(state, camera, defaults) {
  if (!state.process || state.dead) {
    return;
  }
  const freezeTimeoutMs = (camera.freezeTimeoutSeconds ?? defaults.freezeTimeoutSeconds) * 1000;
  if (state.lastFrameMs && Date.now() - state.lastFrameMs > freezeTimeoutMs) {
    console.warn(`[${state.cameraId}] Stream frozen, restarting.`);
    stopProcess(state, "frozen");
  }
}

function writeTelemetry() {
  const registry = loadRegistry();
  const payload = {
    updatedAt: new Date().toISOString(),
    cameras: registry.cameras.map((camera) => {
      const state = ensureState(camera);
      return {
        id: camera.id,
        name: camera.name ?? camera.id,
        status: state.dead ? "DEAD" : state.status,
        devicePath: camera.devicePath ?? null,
        lastFrameMs: state.lastFrameMs,
        fps: state.fps,
        restartCount: state.restartCount,
        cpuPercent: state.cpuPercent,
        memoryMb: state.memoryMb,
      };
    }),
  };
  fs.writeFileSync(telemetryPath, JSON.stringify(payload, null, 2));
}

async function tick() {
  const registry = loadRegistry();
  const defaults = registry.defaults ?? defaultRegistry.defaults;

  registry.cameras.forEach((camera, index) => {
    const state = ensureState(camera);
    if (!camera.enabled) {
      stopProcess(state, "disabled");
      state.status = "OFFLINE";
      return;
    }
    const devicePath = camera.devicePath;
    state.devicePresent = Boolean(devicePath && fs.existsSync(devicePath));
    if (!state.devicePresent) {
      stopProcess(state, "missing-device");
      return;
    }
    if (!state.process) {
      startProcess(camera, defaults, index);
    }
  });

  for (const state of running.values()) {
    if (state.dead) {
      continue;
    }
    const camera = registry.cameras.find((item) => item.id === state.cameraId);
    if (camera) {
      checkWatchdog(state, camera, defaults);
      await enforceResourceLimits(state, camera, defaults);
    }
  }

  writeTelemetry();
}

function main() {
  const registry = loadRegistry();
  const pollInterval = registry.defaults?.pollIntervalMs ?? defaultRegistry.defaults.pollIntervalMs;
  console.log(`Starting Chickencams supervisor. Registry: ${registryPath}`);
  tick();
  setInterval(() => {
    tick();
  }, pollInterval);
}

main();
