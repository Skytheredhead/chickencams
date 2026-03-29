#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${ROOT_DIR}/.." && pwd)
SCRIPT_PATH="${ROOT_DIR}/launch-aggregator-ui.sh"
cd "$ROOT_DIR"

PORT=${AGGREGATOR_UI_PORT:-3010}
UI_URL="http://localhost:${PORT}/"

open_ui() {
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$UI_URL" >/dev/null 2>&1 || true
  fi
}

run_ui() {
  if ! node -p "require.resolve('express')" >/dev/null 2>&1; then
    echo "Missing Node.js dependencies for the Aggregator UI."
    echo "Run these commands first:"
    echo "  cd \"${REPO_ROOT}\""
    echo "  npm install"
    return 1
  fi

  node "${ROOT_DIR}/aggregator-ui.js"
}

if command -v curl >/dev/null 2>&1 && curl --silent --fail --max-time 1 "$UI_URL" >/dev/null; then
  echo "Aggregator UI is already running at $UI_URL"
  open_ui
  exit 0
fi

if [[ -n "${AGGREGATOR_UI_CHILD:-}" || ( -t 0 && -t 1 ) ]]; then
  run_ui
  exit $?
fi

launch_command="\"${SCRIPT_PATH}\""

if command -v x-terminal-emulator >/dev/null 2>&1; then
  x-terminal-emulator -e bash -lc "AGGREGATOR_UI_CHILD=1 ${launch_command}; exec bash"
elif command -v gnome-terminal >/dev/null 2>&1; then
  gnome-terminal -- bash -lc "AGGREGATOR_UI_CHILD=1 ${launch_command}; exec bash"
elif command -v konsole >/dev/null 2>&1; then
  konsole -e bash -lc "AGGREGATOR_UI_CHILD=1 ${launch_command}; exec bash"
elif command -v xfce4-terminal >/dev/null 2>&1; then
  xfce4-terminal -e "bash -lc 'AGGREGATOR_UI_CHILD=1 ${launch_command}; exec bash'"
else
  echo "No terminal emulator found; running in this shell."
  run_ui
fi

open_ui
