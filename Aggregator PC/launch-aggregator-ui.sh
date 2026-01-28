#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$ROOT_DIR"

PORT=${AGGREGATOR_UI_PORT:-3010}
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:${PORT}/" >/dev/null 2>&1 || true
fi

node "${ROOT_DIR}/aggregator-ui.js"
