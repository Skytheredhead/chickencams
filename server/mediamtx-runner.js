import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

function hasBinary(name) {
  const probe = spawnSync(name, ["--version"], { stdio: "ignore" });
  return probe.status === 0 || probe.status === null && probe.error == null;
}

function resolveBinary(config) {
  const candidates = [
    config.mediamtx.binary,
    path.resolve(config._paths.rootDir, "vendor/mediamtx/mediamtx"),
    "/usr/local/bin/mediamtx",
    "/usr/bin/mediamtx"
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.includes("/") && fs.existsSync(candidate)) return candidate;
    if (!candidate.includes("/") && hasBinary(candidate)) return candidate;
  }
  return null;
}

export function buildRuntimeConfig(config) {
  const templatePath = path.resolve(config._paths.rootDir, config.mediamtx.templatePath);
  const template = yaml.load(fs.readFileSync(templatePath, "utf-8"));
  template.paths = {};
  for (const camera of config.cameras) {
    if (!camera.enabled) continue;
    template.paths[camera.id] = {
      // Cameras publish to the global SRT listener (srtAddress) using:
      //   srt://<central>:<srtPort>?streamid=publish:<path>
      // so paths must accept publishers, not try to "pull" as a source.
      source: "publisher",
      record: true,
      // MediaMTX requires %path to be present in recordPath.
      // %path expands to the stream path (e.g. cam1), so it naturally namespaces recordings.
      recordPath: path.join(config._paths.recordingsRoot, "%path", "%Y-%m-%d_%H-%M-%S_%f"),
      recordFormat: "fmp4",
      recordSegmentDuration: `${config.recording.segmentSeconds}s`,
      recordDeleteAfter: "0s"
    };
  }
  const out = path.resolve(config._paths.rootDir, config.mediamtx.configPath);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, yaml.dump(template));
  return out;
}

export function startMediaMTX(config, { onExit } = {}) {
  if (!config.mediamtx.autoStart) {
    console.log("[mediamtx] autoStart disabled; assuming external instance.");
    return null;
  }
  const binary = resolveBinary(config);
  if (!binary) {
    console.warn(
      "[mediamtx] binary not found. Install mediamtx (https://github.com/bluenviron/mediamtx) or drop it in vendor/mediamtx/."
    );
    return null;
  }
  const runtimeConfigPath = buildRuntimeConfig(config);
  const child = spawn(binary, [runtimeConfigPath], { stdio: "inherit" });
  child.on("exit", (code, signal) => {
    console.warn(`[mediamtx] exited code=${code} signal=${signal}`);
    onExit?.(code, signal);
  });
  child.on("error", (error) => {
    console.warn(`[mediamtx] failed to start: ${error.message}`);
  });
  return child;
}
