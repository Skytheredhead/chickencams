#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${ROOT_DIR}/.." && pwd)
SCRIPT_PATH="${ROOT_DIR}/launch-edge-ui.sh"
cd "$ROOT_DIR"

PORT=${EDGE_UI_PORT:-3010}
UI_URL="http://localhost:${PORT}/"

LOG_FILE="${REPO_ROOT}/edge-ui-launch.log"

log() { printf "[%s] %s\n" "$(date +"%H:%M:%S")" "$*" | tee -a "$LOG_FILE"; }

pause_on_exit() {
  local code=$?
  if (( code != 0 )); then
    echo
    echo "Edge UI exited with status $code."
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

open_ui() {
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$UI_URL" >/dev/null 2>&1 || true
  fi
}

run_ui() {
  if ! command -v node >/dev/null 2>&1; then
    log "ERROR: node is not on PATH. Install Node.js 20+."
    return 1
  fi

  if ! command -v npm >/dev/null 2>&1; then
    log "ERROR: npm is not on PATH."
    return 1
  fi

  log "node: $(node --version)"

  if [[ ! -d "${REPO_ROOT}/node_modules" ]] || [[ "${REPO_ROOT}/package.json" -nt "${REPO_ROOT}/node_modules" ]]; then
    log "Installing dependencies (npm install)..."
    if ! ( cd "$REPO_ROOT" && npm install ) 2>&1 | tee -a "$LOG_FILE"; then
      log "ERROR: npm install failed."
      return 1
    fi
  fi

  log "Starting Edge UI (node Edge/edge-ui.js)..."
  node "${ROOT_DIR}/edge-ui.js" 2>&1 | tee -a "$LOG_FILE"
}

if command -v curl >/dev/null 2>&1 && curl --silent --fail --max-time 1 "$UI_URL" >/dev/null; then
  echo "Edge UI is already running at $UI_URL"
  open_ui
  exit 0
fi

if [[ -n "${EDGE_UI_CHILD:-}" || ( -t 0 && -t 1 ) ]]; then
  run_ui
  exit $?
fi

launch_command="\"${SCRIPT_PATH}\""

if command -v x-terminal-emulator >/dev/null 2>&1; then
  x-terminal-emulator -e bash -lc "EDGE_UI_CHILD=1 ${launch_command}; exec bash"
elif command -v gnome-terminal >/dev/null 2>&1; then
  gnome-terminal -- bash -lc "EDGE_UI_CHILD=1 ${launch_command}; exec bash"
elif command -v konsole >/dev/null 2>&1; then
  konsole -e bash -lc "EDGE_UI_CHILD=1 ${launch_command}; exec bash"
elif command -v xfce4-terminal >/dev/null 2>&1; then
  xfce4-terminal -e "bash -lc 'EDGE_UI_CHILD=1 ${launch_command}; exec bash'"
else
  echo "No terminal emulator found; running in this shell."
  run_ui
fi

open_ui
