#!/usr/bin/env bash
set -euo pipefail

CAMERA_ID=${1:?"camera id required (cam1-cam5)"}
DEVICE=${2:?"video device required (/dev/video0)"}
SERVER_HOST=${3:?"server hostname required"}
SERVER_PORT=${4:?"server port required"}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR=${LOG_DIR:-"${SCRIPT_DIR}/logs"}
LOG_FILE=${LOG_FILE:-"${LOG_DIR}/${CAMERA_ID}.log"}
MAX_FPS=${MAX_FPS:-30}

mkdir -p "${LOG_DIR}"
exec > >(tee -a "${LOG_FILE}") 2>&1

log() {
  printf "[%s] %s\n" "$(date +"%Y-%m-%d %H:%M:%S")" "$*"
}

log "Logging to ${LOG_FILE}"

if ! command -v nc >/dev/null 2>&1; then
  log "Error: nc (netcat) is required to preflight the server listener check."
  exit 1
fi

log "Checking for SRT listener on ${SERVER_HOST}:${SERVER_PORT}..."
LISTENER_RETRY_COUNT=${LISTENER_RETRY_COUNT:-12}
LISTENER_RETRY_DELAY=${LISTENER_RETRY_DELAY:-5}

listener_attempt=0
until nc -u -z -w 2 "${SERVER_HOST}" "${SERVER_PORT}"; do
  listener_attempt=$((listener_attempt + 1))
  if (( listener_attempt > LISTENER_RETRY_COUNT )); then
    log "Error: No listener reachable at ${SERVER_HOST}:${SERVER_PORT}."
    log "Hint: Ensure the server is running and listening on that port before starting capture."
    exit 1
  fi
  log "Listener not ready yet. Retrying in ${LISTENER_RETRY_DELAY}s... (${listener_attempt}/${LISTENER_RETRY_COUNT})"
  sleep "${LISTENER_RETRY_DELAY}"
done

if [[ "${DEVICE}" =~ ^/dev/video[0-9]+$ ]]; then
  log "Error: Use a stable /dev/v4l/by-id or /dev/v4l/by-path symlink instead of ${DEVICE}."
  exit 1
fi

detect_camera_fps() {
  local fps=""
  if command -v v4l2-ctl >/dev/null 2>&1; then
    fps=$(v4l2-ctl --device "${DEVICE}" --get-parm 2>/dev/null | awk -F'/' '/Frames per second/ { print $2 }')
  fi
  if [[ -z "${fps}" ]]; then
    fps="${MAX_FPS}"
  fi
  if ! [[ "${fps}" =~ ^[0-9]+$ ]]; then
    fps="${MAX_FPS}"
  fi
  if (( fps > MAX_FPS )); then
    fps="${MAX_FPS}"
  fi
  echo "${fps}"
}

INPUT_FPS=$(detect_camera_fps)
log "Capture settings: device=${DEVICE}, fps=${INPUT_FPS}, max_fps=${MAX_FPS}, server=${SERVER_HOST}:${SERVER_PORT}"
if command -v v4l2-ctl >/dev/null 2>&1; then
  log "Device formats: $(v4l2-ctl --device "${DEVICE}" --list-formats-ext 2>/dev/null | tr '\n' ' ')"
fi

PROGRESS_ARGS=()
if [[ "${FFMPEG_PROGRESS:-}" == "1" ]]; then
  PROGRESS_ARGS=(-progress pipe:1 -nostats)
fi

exec ffmpeg \
  -fflags +genpts+nobuffer \
  -flags low_delay \
  -thread_queue_size 64 \
  -f v4l2 \
  -framerate "${INPUT_FPS}" \
  -video_size 1280x720 \
  -i "${DEVICE}" \
  -use_wallclock_as_timestamps 1 \
  -c:v libx264 \
  -preset veryfast \
  -tune zerolatency \
  -b:v 2500k \
  -maxrate 2800k \
  -bufsize 4000k \
  -fps_mode drop \
  -max_delay 0 \
  -flush_packets 1 \
  -pix_fmt yuv420p \
  -f mpegts \
  "${PROGRESS_ARGS[@]}" \
  "srt://${SERVER_HOST}:${SERVER_PORT}?mode=caller&transtype=live&latency=50"
