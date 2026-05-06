import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const rootDir = path.resolve(__dirname, "..");
const defaultConfigPath = path.join(__dirname, "config.default.json");
const runtimeConfigPath = path.join(__dirname, "config.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function deepMerge(base, override) {
  if (!override) return base;
  const out = { ...base };
  for (const key of Object.keys(override)) {
    const a = base?.[key];
    const b = override[key];
    if (a && b && typeof a === "object" && !Array.isArray(a) && typeof b === "object" && !Array.isArray(b)) {
      out[key] = deepMerge(a, b);
    } else if (b !== undefined) {
      out[key] = b;
    }
  }
  return out;
}

function loadCameraRegistry(registryPath, fallback) {
  if (!fs.existsSync(registryPath)) return fallback;
  try {
    const raw = readJson(registryPath);
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw.cameras)) return raw.cameras;
  } catch (error) {
    console.warn(`[config] failed to read ${registryPath}: ${error.message}`);
  }
  return fallback;
}

export function loadConfig() {
  const base = readJson(defaultConfigPath);
  const override = fs.existsSync(runtimeConfigPath) ? readJson(runtimeConfigPath) : {};
  const merged = deepMerge(base, override);
  if (Array.isArray(override.cameras)) merged.cameras = override.cameras;
  const registryPath = path.resolve(rootDir, merged.paths?.cameraRegistryPath || "server/camera-registry.json");
  merged.cameras = loadCameraRegistry(registryPath, merged.cameras);
  merged._paths = {
    runtimeConfigPath,
    cameraRegistryPath: registryPath,
    streamsRoot: path.resolve(rootDir, merged.paths.streamsRoot),
    recordingsRoot: path.resolve(rootDir, merged.paths.recordingsRoot),
    activityRoot: path.resolve(rootDir, merged.paths.activityRoot),
    rootDir
  };
  return merged;
}

export function persistConfig(config) {
  const { _paths, cameras, ...rest } = config;
  fs.writeFileSync(_paths.runtimeConfigPath, JSON.stringify(rest, null, 2));
  fs.writeFileSync(_paths.cameraRegistryPath, JSON.stringify({ cameras }, null, 2));
}

export function ensureStorageDirs(config) {
  for (const dir of [config._paths.streamsRoot, config._paths.recordingsRoot, config._paths.activityRoot]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
