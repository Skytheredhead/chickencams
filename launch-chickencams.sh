#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$ROOT_DIR"

LOG_FILE="${ROOT_DIR}/launch.log"

log() { printf "[%s] %s\n" "$(date +"%H:%M:%S")" "$*" | tee -a "$LOG_FILE"; }

pause_on_exit() {
  local code=$?
  if (( code != 0 )); then
    echo
    echo "Chickencams exited with status $code."
    echo "Log: $LOG_FILE"
  else
    echo
    echo "Chickencams exited successfully."
    echo "Log: $LOG_FILE"
  fi
  if [[ -t 0 ]]; then
    echo
    read -r -p "Press Enter to close this window..." _
  fi
  exit "$code"
}
trap pause_on_exit EXIT

: > "$LOG_FILE"
log "Working directory: $ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  log "ERROR: node is not on PATH. Install Node.js 20+."
  exit 1
fi
log "node: $(node --version)"

if ! command -v npm >/dev/null 2>&1; then
  log "ERROR: npm is not on PATH."
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  log "WARNING: ffmpeg is not on PATH. Motion clips and exports will fail."
fi

if ! command -v mediamtx >/dev/null 2>&1 && [[ ! -x "${ROOT_DIR}/vendor/mediamtx/mediamtx" ]]; then
  log "WARNING: mediamtx binary not found. Live/DVR/recording will not work until you install it."
  log "         Download from https://github.com/bluenviron/mediamtx/releases or 'brew install mediamtx'."
fi

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:\\.]${port}$"
    return $?
  fi
  return 1
}

if port_in_use 7979; then
  log "ERROR: Port 7979 is already in use."
  log "Stop the existing process, then rerun."
  if command -v lsof >/dev/null 2>&1; then
    log "Tip: lsof -nP -iTCP:7979 -sTCP:LISTEN"
  elif command -v ss >/dev/null 2>&1; then
    log "Tip: ss -ltnp | grep ':7979'"
  fi
  exit 1
fi

if [[ ! -d "${ROOT_DIR}/node_modules" ]] || [[ "${ROOT_DIR}/package.json" -nt "${ROOT_DIR}/node_modules" ]]; then
  log "Installing root dependencies (npm install)..."
  if ! npm install 2>&1 | tee -a "$LOG_FILE"; then
    log "ERROR: npm install failed."
    exit 1
  fi
fi

ensure_better_sqlite3() {
  # better-sqlite3 is a native addon; on some Linux setups it may not have a prebuilt
  # binary and must be compiled locally. Detect that case early with a cheap require().
  if node -e "require('better-sqlite3');" >/dev/null 2>&1; then
    return 0
  fi

  log "WARNING: better-sqlite3 native bindings failed to load."
  log "Attempting a local rebuild (npm rebuild better-sqlite3 --build-from-source)..."

  if ! command -v python3 >/dev/null 2>&1; then
    log "ERROR: python3 is required to build native Node modules (node-gyp)."
    log "On Debian/Ubuntu: sudo apt-get update && sudo apt-get install -y python3 make g++"
    return 1
  fi

  if ! command -v make >/dev/null 2>&1 || ! command -v g++ >/dev/null 2>&1; then
    log "ERROR: build tools are required to compile better-sqlite3."
    log "On Debian/Ubuntu: sudo apt-get update && sudo apt-get install -y make g++"
    return 1
  fi

  if ! npm rebuild better-sqlite3 --build-from-source 2>&1 | tee -a "$LOG_FILE"; then
    log "ERROR: better-sqlite3 rebuild failed."
    return 1
  fi

  if ! node -e "require('better-sqlite3');" >/dev/null 2>&1; then
    log "ERROR: better-sqlite3 still failed to load after rebuild."
    return 1
  fi

  log "better-sqlite3 rebuild succeeded."
  return 0
}

if ! ensure_better_sqlite3; then
  log "ERROR: Cannot start until better-sqlite3 loads successfully."
  exit 1
fi

if [[ ! -d "${ROOT_DIR}/web/dist" ]]; then
  log "Building web UI (cd web && npm install && npm run build)..."
  if ! ( cd web && npm install && npm run build ) 2>&1 | tee -a "$LOG_FILE"; then
    log "ERROR: web build failed. The API will still run but the dashboard won't load."
  fi
fi

log "Starting central server (node server/index.js)..."
node server/index.js 2>&1 | tee -a "$LOG_FILE"
