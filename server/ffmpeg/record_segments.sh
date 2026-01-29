#!/usr/bin/env bash
set -euo pipefail

CAMERA_ID=${1:?"camera id required"}
SOURCE_URL=${2:?"source url required"}
OUTPUT_DIR=${3:-"./recordings"}
FONT_PATH=${4:-"/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"}

ENCODER="h264_nvenc"
PRESET="p4"
TUNE=()
PIX_FMT="yuv420p"

supports_nvenc() {
  command -v nvidia-smi >/dev/null 2>&1 || return 1
  ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc=size=128x72:rate=1 -t 0.1 \
    -c:v h264_nvenc -f null - >/dev/null 2>&1
}

if ! supports_nvenc; then
  ENCODER="libx264"
  PRESET="veryfast"
  TUNE=(-tune zerolatency)
fi

mkdir -p "${OUTPUT_DIR}/${CAMERA_ID}"

TIMESTAMP_FILTER="drawtext=fontfile=${FONT_PATH}:text='%{localtime\\:%Y-%m-%d %H.%M.%S}':x=w-tw-20:y=h-th-20:fontsize=32:fontcolor=white:box=1:boxcolor=0x00000099"

ffmpeg \
  -hide_banner \
  -loglevel error \
  -nostats \
  -fflags +genpts+discardcorrupt \
  -use_wallclock_as_timestamps 1 \
  -avoid_negative_ts make_zero \
  -err_detect ignore_err \
  -max_delay 0 \
  -i "${SOURCE_URL}" \
  -vf "${TIMESTAMP_FILTER}" \
  -c:v "${ENCODER}" -preset "${PRESET}" "${TUNE[@]}" -pix_fmt "${PIX_FMT}" -b:v 2000k -maxrate 2200k -bufsize 4000k -r 30 -g 30 -keyint_min 30 -sc_threshold 0 -force_key_frames "expr:gte(t,n_forced*1)" \
  -c:a aac -b:a 96k -ac 2 \
  -f segment \
  -segment_time 60 \
  -reset_timestamps 1 \
  -strftime 1 \
  "${OUTPUT_DIR}/${CAMERA_ID}/%s.mp4"
