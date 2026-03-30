#!/usr/bin/env bash
set -euo pipefail

CAMERA_ID=${1:?"camera id required (cam1-cam5)"}
DEVICE=${2:?"video device required (/dev/video0)"}
SERVER_HOST=${3:?"server hostname required"}
SERVER_PORT=${4:?"server port required"}
AUDIO_DEVICE=${5:-""}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR=${LOG_DIR:-"${SCRIPT_DIR}/logs"}
LOG_FILE=${LOG_FILE:-"${LOG_DIR}/${CAMERA_ID}.log"}
MAX_FPS=${MAX_FPS:-10}
VIDEO_RATE_MODE=${VIDEO_RATE_MODE:-vbr}
VIDEO_CRF=${VIDEO_CRF:-23}
VIDEO_BITRATE_KBPS=${VIDEO_BITRATE_KBPS:-3000}
VIDEO_MAXRATE_KBPS=${VIDEO_MAXRATE_KBPS:-4500}
VIDEO_BUFSIZE_KBPS=${VIDEO_BUFSIZE_KBPS:-9000}

mkdir -p "${LOG_DIR}"
exec > >(tee -a "${LOG_FILE}") 2>&1

log() {
  printf "[%s] %s\n" "$(date +"%Y-%m-%d %H:%M:%S")" "$*"
}

log "Logging to ${LOG_FILE}"

LISTENER_RETRY_COUNT=${LISTENER_RETRY_COUNT:-12}
LISTENER_RETRY_DELAY=${LISTENER_RETRY_DELAY:-5}
LISTENER_PREFLIGHT_MODE=${LISTENER_PREFLIGHT_MODE:-skip}
FFMPEG_RETRY_DELAY=${FFMPEG_RETRY_DELAY:-5}
CURRENT_FFMPEG_PID=""

stop_capture() {
  if [[ -n "${CURRENT_FFMPEG_PID}" ]]; then
    kill "${CURRENT_FFMPEG_PID}" 2>/dev/null || true
  fi
  exit 0
}

trap stop_capture TERM INT

wait_for_listener() {
  case "${LISTENER_PREFLIGHT_MODE}" in
    skip|off|none)
      log "Skipping listener preflight (LISTENER_PREFLIGHT_MODE=${LISTENER_PREFLIGHT_MODE})."
      return 0
      ;;
    udp-nc|netcat|best-effort)
      ;;
    *)
      log "Unknown LISTENER_PREFLIGHT_MODE=${LISTENER_PREFLIGHT_MODE}; expected skip or udp-nc. Skipping preflight."
      return 0
      ;;
  esac

  if ! command -v nc >/dev/null 2>&1; then
    log "nc (netcat) not found; skipping listener preflight."
    return 0
  fi

  log "Checking for SRT listener on ${SERVER_HOST}:${SERVER_PORT}..."
  local listener_attempt=0
  until nc -u -z -w 2 "${SERVER_HOST}" "${SERVER_PORT}"; do
    listener_attempt=$((listener_attempt + 1))
    if (( listener_attempt > LISTENER_RETRY_COUNT )); then
      log "Listener preflight did not succeed for ${SERVER_HOST}:${SERVER_PORT}; continuing anyway because UDP netcat is not a reliable SRT readiness check."
      return 0
    fi
    log "Listener not ready yet. Retrying in ${LISTENER_RETRY_DELAY}s... (${listener_attempt}/${LISTENER_RETRY_COUNT})"
    sleep "${LISTENER_RETRY_DELAY}"
  done
}

wait_for_listener

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
if [[ -n "${AUDIO_DEVICE}" ]]; then
  log "Audio device: ${AUDIO_DEVICE}"
fi
log "Capture settings: device=${DEVICE}, fps=${INPUT_FPS}, max_fps=${MAX_FPS}, rate_mode=${VIDEO_RATE_MODE}, server=${SERVER_HOST}:${SERVER_PORT}"
if command -v v4l2-ctl >/dev/null 2>&1; then
  log "Device formats: $(v4l2-ctl --device "${DEVICE}" --list-formats-ext 2>/dev/null | tr '\n' ' ')"
fi

PROGRESS_ARGS=()
if [[ "${FFMPEG_PROGRESS:-}" == "1" ]]; then
  PROGRESS_ARGS=(-progress pipe:1 -nostats)
fi

AUDIO_INPUT_ARGS=()
AUDIO_OUTPUT_ARGS=()
if [[ -n "${AUDIO_DEVICE}" ]]; then
  AUDIO_INPUT_ARGS=(-thread_queue_size 64 -f alsa -i "${AUDIO_DEVICE}")
  AUDIO_OUTPUT_ARGS=(-c:a aac -b:a 128k -ac 2 -ar 48000 -map 0:v:0 -map 1:a:0)
fi

VIDEO_RATE_ARGS=()
if [[ "${VIDEO_RATE_MODE}" == "cbr" ]]; then
  VIDEO_RATE_ARGS=(-b:v "${VIDEO_BITRATE_KBPS}k" -maxrate "${VIDEO_BITRATE_KBPS}k" -bufsize "${VIDEO_BUFSIZE_KBPS}k")
else
  VIDEO_RATE_ARGS=(-crf "${VIDEO_CRF}" -maxrate "${VIDEO_MAXRATE_KBPS}k" -bufsize "${VIDEO_BUFSIZE_KBPS}k")
fi

FFMPEG_ARGS=(
  -fflags +genpts+nobuffer
  -flags low_delay
  -use_wallclock_as_timestamps 1
  -thread_queue_size 64
  -f v4l2
  -framerate "${INPUT_FPS}"
  -video_size 1280x720
  -i "${DEVICE}"
  "${AUDIO_INPUT_ARGS[@]}"
  -c:v libx264
  -preset veryfast
  -tune zerolatency
  "${VIDEO_RATE_ARGS[@]}"
  -fps_mode drop
  -max_delay 0
  -flush_packets 1
  -muxpreload 0
  -muxdelay 0
  -pix_fmt yuv420p
  "${AUDIO_OUTPUT_ARGS[@]}"
  -f mpegts
  "${PROGRESS_ARGS[@]}"
  "srt://${SERVER_HOST}:${SERVER_PORT}?mode=caller&transtype=live&latency=50"
)

while true; do
  ffmpeg "${FFMPEG_ARGS[@]}" &
  CURRENT_FFMPEG_PID=$!
  set +e
  wait "${CURRENT_FFMPEG_PID}"
  exit_code=$?
  set -e
  CURRENT_FFMPEG_PID=""

  if (( exit_code == 0 )); then
    log "ffmpeg exited cleanly."
    exit 0
  fi

  log "ffmpeg exited with code ${exit_code}. Retrying in ${FFMPEG_RETRY_DELAY}s..."
  sleep "${FFMPEG_RETRY_DELAY}"
done
