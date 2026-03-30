#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SERVICE_NAME=${1:-aggregator}
TEMPLATE_PATH="$ROOT_DIR/server/${SERVICE_NAME}.service"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
NODE_BIN=$(command -v node || true)
SERVICE_USER=${SUDO_USER:-${USER:-}}

if [[ ! -f "$TEMPLATE_PATH" ]]; then
  echo "Missing service template for '$SERVICE_NAME' at $TEMPLATE_PATH" >&2
  exit 1
fi

if [[ -z "$NODE_BIN" ]]; then
  echo "Couldn't find node in PATH. Install Node.js first." >&2
  exit 1
fi

if [[ -z "$SERVICE_USER" ]]; then
  echo "Couldn't determine which Linux user should run the service." >&2
  exit 1
fi

SERVICE_GROUP=$(id -gn "$SERVICE_USER")
TMP_FILE=$(mktemp)

escape_sed_replacement() {
  printf '%s' "$1" | sed -e 's/[\\/&]/\\&/g'
}

sed \
  -e "s|__CHICKENCAMS_WORKDIR__|$(escape_sed_replacement "$ROOT_DIR")|g" \
  -e "s|__CHICKENCAMS_NODE__|$(escape_sed_replacement "$NODE_BIN")|g" \
  -e "s|__CHICKENCAMS_USER__|$(escape_sed_replacement "$SERVICE_USER")|g" \
  -e "s|__CHICKENCAMS_GROUP__|$(escape_sed_replacement "$SERVICE_GROUP")|g" \
  "$TEMPLATE_PATH" > "$TMP_FILE"

cleanup() {
  rm -f "$TMP_FILE"
}
trap cleanup EXIT

sudo install -m 0644 "$TMP_FILE" "$UNIT_PATH"
sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE_NAME"

echo
echo "Installed $SERVICE_NAME:"
echo "  $UNIT_PATH"
echo
sudo systemctl status "$SERVICE_NAME" --no-pager
