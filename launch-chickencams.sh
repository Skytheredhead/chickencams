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

if [[ ! -d "${ROOT_DIR}/node_modules" ]] || [[ "${ROOT_DIR}/package.json" -nt "${ROOT_DIR}/node_modules" ]]; then
  log "Installing root dependencies (npm install)..."
  if ! npm install 2>&1 | tee -a "$LOG_FILE"; then
    log "ERROR: npm install failed."
    exit 1
  fi
fi

if [[ ! -d "${ROOT_DIR}/web/dist" ]]; then
  log "Building web UI (cd web && npm install && npm run build)..."
  if ! ( cd web && npm install && npm run build ) 2>&1 | tee -a "$LOG_FILE"; then
    log "ERROR: web build failed. The API will still run but the dashboard won't load."
  fi
fi

log "Starting central server (node server/index.js)..."
node server/index.js 2>&1 | tee -a "$LOG_FILE"
