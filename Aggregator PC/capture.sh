#!/usr/bin/env bash
set -euo pipefail

CAMERA_ID=${1:?"camera id required (cam1-cam5)"}
DEVICE=${2:?"video device required (/dev/video0)"}
SERVER_HOST=${3:?"server hostname required"}
SERVER_PORT=${4:?"server port required"}

ffmpeg \
  -f v4l2 \
  -framerate 30 \
  -video_size 1280x720 \
  -i "${DEVICE}" \
  -c:v libx264 \
  -preset veryfast \
  -tune zerolatency \
  -b:v 2500k \
  -maxrate 2800k \
  -bufsize 4000k \
  -pix_fmt yuv420p \
  -f mpegts \
  "srt://${SERVER_HOST}:${SERVER_PORT}?mode=caller&transtype=live&latency=50"
