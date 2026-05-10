#!/usr/bin/env bash
set -euo pipefail

CAMERA_ID=${1:?"camera id required (cam1-cam5)"}
DEVICE=${2:?"video device required (/dev/v4l/by-id/...)"}
SERVER_HOST=${3:?"server hostname required"}
SERVER_PORT=${4:?"server port required"}
AUDIO_DEVICE=${5:-""}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR=${LOG_DIR:-"${SCRIPT_DIR}/logs"}
LOG_FILE=${LOG_FILE:-"${LOG_DIR}/${CAMERA_ID}.log"}
MAX_FPS=${MAX_FPS:-10}
VIDEO_SIZE=${VIDEO_SIZE:-640x360}
INPUT_FORMAT=${INPUT_FORMAT:-auto} # auto|mjpeg|yuyv422|...
GOP_SECONDS=${GOP_SECONDS:-2} # keyframe interval target (seconds) for HLS/WebRTC friendliness
VIDEO_RATE_MODE=${VIDEO_RATE_MODE:-vbr}
VIDEO_CRF=${VIDEO_CRF:-23}
VIDEO_BITRATE_KBPS=${VIDEO_BITRATE_KBPS:-3000}
VIDEO_MAXRATE_KBPS=${VIDEO_MAXRATE_KBPS:-4500}
VIDEO_BUFSIZE_KBPS=${VIDEO_BUFSIZE_KBPS:-9000}
SRT_LATENCY_MS=${SRT_LATENCY_MS:-120}
SRT_PKT_SIZE=${SRT_PKT_SIZE:-1316}
FFMPEG_RETRY_DELAY=${FFMPEG_RETRY_DELAY:-5}

mkdir -p "${LOG_DIR}"
exec > >(tee -a "${LOG_FILE}") 2>&1

log() { printf "[%s] %s\n" "$(date +"%Y-%m-%d %H:%M:%S")" "$*"; }

CURRENT_FFMPEG_PID=""
trap 'if [[ -n "${CURRENT_FFMPEG_PID}" ]]; then kill "${CURRENT_FFMPEG_PID}" 2>/dev/null || true; fi; exit 0' TERM INT

if [[ "${DEVICE}" =~ ^/dev/video[0-9]+$ ]]; then
  log "Error: use a stable /dev/v4l/by-id or /dev/v4l/by-path symlink instead of ${DEVICE}."
  exit 1
fi

detect_camera_fps() {
  local fps=""
  if command -v v4l2-ctl >/dev/null 2>&1; then
    fps=$(v4l2-ctl --device "${DEVICE}" --get-parm 2>/dev/null | awk -F'/' '/Frames per second/ { print $2 }')
  fi
  [[ -z "${fps}" || ! "${fps}" =~ ^[0-9]+$ ]] && fps="${MAX_FPS}"
  (( fps > MAX_FPS )) && fps="${MAX_FPS}"
  echo "${fps}"
}

INPUT_FPS=$(detect_camera_fps)
log "Capture: device=${DEVICE} fps=${INPUT_FPS} target=${SERVER_HOST}:${SERVER_PORT} streamid=publish:${CAMERA_ID}"

GOP_FRAMES=$(( INPUT_FPS * GOP_SECONDS ))
(( GOP_FRAMES < 10 )) && GOP_FRAMES=10
log "Encoder: gop=${GOP_FRAMES} frames (~${GOP_SECONDS}s)"

PROGRESS_ARGS=()
[[ "${FFMPEG_PROGRESS:-}" == "1" ]] && PROGRESS_ARGS=(-progress pipe:1 -nostats)

detect_input_format() {
  if [[ "${INPUT_FORMAT}" != "auto" ]]; then
    log "Using explicit input_format=${INPUT_FORMAT}"
    echo "${INPUT_FORMAT}"
    return
  fi

  if ! command -v v4l2-ctl >/dev/null 2>&1; then
    log "v4l2-ctl not found; skipping format detection"
    echo ""
    return
  fi

  local formats_output
  formats_output=$(v4l2-ctl --device "${DEVICE}" --list-formats-ext 2>/dev/null || true)

  if [[ -n "${formats_output}" ]]; then
    log "Supported formats for ${DEVICE}:"
    while IFS= read -r line; do
      [[ -n "${line}" ]] && log "  ${line}"
    done <<< "${formats_output}"
  else
    log "Could not enumerate formats for ${DEVICE}"
    echo ""
    return
  fi

  if echo "${formats_output}" | grep -qiE "MJPG|Motion-JPEG"; then
    echo "mjpeg"
    return
  fi
  if echo "${formats_output}" | grep -qi "YUYV"; then
    echo "yuyv422"
    return
  fi

  echo ""
}

INPUT_FORMAT_FLAG=()
SELECTED_INPUT_FORMAT="$(detect_input_format)"
if [[ -n "${SELECTED_INPUT_FORMAT}" ]]; then
  INPUT_FORMAT_FLAG=(-input_format "${SELECTED_INPUT_FORMAT}")
fi
log "Negotiated capture: format=${SELECTED_INPUT_FORMAT:-auto} resolution=${VIDEO_SIZE} maxFps=${MAX_FPS} actualFps=${INPUT_FPS}"

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

# MediaMTX expects `streamid=publish:<path>` to authorize the SRT publisher.
SRT_URL="srt://${SERVER_HOST}:${SERVER_PORT}?mode=caller&transtype=live&latency=${SRT_LATENCY_MS}&pkt_size=${SRT_PKT_SIZE}&streamid=publish:${CAMERA_ID}"

FFMPEG_ARGS=(
  -fflags +genpts+nobuffer
  -flags low_delay
  # Wallclock timestamps can jitter and cause MediaMTX recorder "drift" warnings.
  # Let ffmpeg generate monotonic timestamps instead.
  -avoid_negative_ts make_zero
  -thread_queue_size 64
  -f v4l2
  "${INPUT_FORMAT_FLAG[@]}"
  -framerate "${INPUT_FPS}"
  -video_size "${VIDEO_SIZE}"
  -i "${DEVICE}"
  "${AUDIO_INPUT_ARGS[@]}"
  -c:v libx264
  -preset veryfast
  -tune zerolatency
  -g "${GOP_FRAMES}"
  -keyint_min "${GOP_FRAMES}"
  -sc_threshold 0
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
  "${SRT_URL}"
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
