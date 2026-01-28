#!/usr/bin/env bash
set -euo pipefail

CAMERA_ID=${1:?"camera id required (cam1-cam5)"}
DEVICE=${2:?"video device required (/dev/video0)"}
SERVER_HOST=${3:?"server hostname required"}
SERVER_PORT=${4:?"server port required"}

if ! command -v nc >/dev/null 2>&1; then
  echo "Error: nc (netcat) is required to preflight the server listener check." >&2
  exit 1
fi

echo "Checking for SRT listener on ${SERVER_HOST}:${SERVER_PORT}..."
if ! nc -z -w 2 "${SERVER_HOST}" "${SERVER_PORT}"; then
  echo "Error: No listener reachable at ${SERVER_HOST}:${SERVER_PORT}." >&2
  echo "Hint: Ensure the server is running and listening on that port before starting capture." >&2
  exit 1
fi

if [[ "${DEVICE}" =~ ^/dev/video[0-9]+$ ]]; then
  echo "Error: Use a stable /dev/v4l/by-id or /dev/v4l/by-path symlink instead of ${DEVICE}." >&2
  exit 1
fi

PROGRESS_ARGS=()
if [[ "${FFMPEG_PROGRESS:-}" == "1" ]]; then
  PROGRESS_ARGS=(-progress pipe:1 -nostats)
fi

ffmpeg \
  -fflags nobuffer \
  -flags low_delay \
  -thread_queue_size 64 \
  -f v4l2 \
  -framerate 30 \
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
