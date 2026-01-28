#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$ROOT_DIR"

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:3000/" >/dev/null 2>&1 || true
fi

npm run start
