#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SERVICE_NAME=${1:-edge}
TEMPLATE_PATH="$ROOT_DIR/server/${SERVICE_NAME}.service"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
NODE_BIN=$(command -v node || true)
SERVICE_USER=${SUDO_USER:-${USER:-}}

if [[ ! -f "$TEMPLATE_PATH" ]]; then
  echo "Missing service template for '$SERVICE_NAME' at $TEMPLATE_PATH" >&2
  echo "Available: edge, central, klipper, moonraker" >&2
  exit 1
fi

KLIPPER_ENV="${KLIPPER_ENV:-$HOME/klippy-env}"
KLIPPER_DIR="${KLIPPER_DIR:-$HOME/klipper}"
MOONRAKER_ENV="${MOONRAKER_ENV:-$HOME/moonraker-env}"
MOONRAKER_DIR="${MOONRAKER_DIR:-$HOME/moonraker}"
PRINTER_DATA="${PRINTER_DATA:-$HOME/printer_data}"

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

escape_sed_replacement() { printf '%s' "$1" | sed -e 's/[\\/&]/\\&/g'; }

sed \
  -e "s|__CHICKENCAMS_WORKDIR__|$(escape_sed_replacement "$ROOT_DIR")|g" \
  -e "s|__CHICKENCAMS_NODE__|$(escape_sed_replacement "$NODE_BIN")|g" \
  -e "s|__CHICKENCAMS_USER__|$(escape_sed_replacement "$SERVICE_USER")|g" \
  -e "s|__CHICKENCAMS_GROUP__|$(escape_sed_replacement "$SERVICE_GROUP")|g" \
  -e "s|__KLIPPER_ENV__|$(escape_sed_replacement "$KLIPPER_ENV")|g" \
  -e "s|__KLIPPER_DIR__|$(escape_sed_replacement "$KLIPPER_DIR")|g" \
  -e "s|__MOONRAKER_ENV__|$(escape_sed_replacement "$MOONRAKER_ENV")|g" \
  -e "s|__MOONRAKER_DIR__|$(escape_sed_replacement "$MOONRAKER_DIR")|g" \
  -e "s|__PRINTER_DATA__|$(escape_sed_replacement "$PRINTER_DATA")|g" \
  "$TEMPLATE_PATH" > "$TMP_FILE"

trap 'rm -f "$TMP_FILE"' EXIT

sudo install -m 0644 "$TMP_FILE" "$UNIT_PATH"
sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE_NAME"

echo
echo "Installed $SERVICE_NAME:"
echo "  $UNIT_PATH"
echo
sudo systemctl status "$SERVICE_NAME" --no-pager
