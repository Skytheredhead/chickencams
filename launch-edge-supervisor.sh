#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$ROOT_DIR"

LOG_FILE="${ROOT_DIR}/edge-supervisor-launch.log"

log() { printf "[%s] %s\n" "$(date +"%H:%M:%S")" "$*" | tee -a "$LOG_FILE"; }

pause_on_exit() {
  local code=$?
  if (( code != 0 )); then
    echo
    echo "Edge supervisor exited with status $code."
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
  log "WARNING: ffmpeg is not on PATH. Camera capture will fail."
fi

ensure_edge_deps() {
  # The edge supervisor uses ESM imports; if deps are missing but node_modules exists,
  # we won't hit the install condition below. Explicitly verify required packages.
  local missing=0
  if ! node -e "import('ws').then(()=>process.exit(0)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    log "Missing dependency: ws"
    missing=1
  fi

  if (( missing == 0 )); then
    return 0
  fi

  log "Installing dependencies (npm install)..."
  if ! npm install 2>&1 | tee -a "$LOG_FILE"; then
    log "ERROR: npm install failed."
    return 1
  fi
  return 0
}

if [[ ! -d "${ROOT_DIR}/node_modules" ]] || [[ "${ROOT_DIR}/package.json" -nt "${ROOT_DIR}/node_modules" ]]; then
  log "Installing dependencies (npm install)..."
  if ! npm install 2>&1 | tee -a "$LOG_FILE"; then
    log "ERROR: npm install failed."
    exit 1
  fi
fi

if ! ensure_edge_deps; then
  exit 1
fi

log "Starting Edge supervisor (node Edge/supervisor.js)..."
node Edge/supervisor.js 2>&1 | tee -a "$LOG_FILE"
