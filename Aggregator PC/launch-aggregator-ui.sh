#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$ROOT_DIR"

PORT=${AGGREGATOR_UI_PORT:-3010}
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:${PORT}/" >/dev/null 2>&1 || true
fi

launch_command="node \"${ROOT_DIR}/aggregator-ui.js\""

if command -v x-terminal-emulator >/dev/null 2>&1; then
  x-terminal-emulator -e bash -lc "${launch_command}; exec bash"
elif command -v gnome-terminal >/dev/null 2>&1; then
  gnome-terminal -- bash -lc "${launch_command}; exec bash"
elif command -v konsole >/dev/null 2>&1; then
  konsole -e bash -lc "${launch_command}; exec bash"
elif command -v xfce4-terminal >/dev/null 2>&1; then
  xfce4-terminal -e "bash -lc '${launch_command}; exec bash'"
else
  echo "No terminal emulator found; running in this shell."
  node "${ROOT_DIR}/aggregator-ui.js"
fi
