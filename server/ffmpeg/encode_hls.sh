#!/usr/bin/env bash
set -euo pipefail

CAMERA_ID=${1:?"camera id required"}
SOURCE_URL=${2:?"source url required"}
OUTPUT_DIR=${3:-"./streams"}
RECORDINGS_DIR=${4:-""}
FONT_PATH=${5:-"/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"}

ENCODER="h264_nvenc"
PRESET="p4"
TUNE=()
PIX_FMT="yuv420p"

if ! command -v nvidia-smi >/dev/null 2>&1; then
  ENCODER="libx264"
  PRESET="veryfast"
  TUNE=(-tune zerolatency)
fi

mkdir -p "${OUTPUT_DIR}/${CAMERA_ID}"
for variant in 0 1 2 3; do
  mkdir -p "${OUTPUT_DIR}/${CAMERA_ID}/${variant}"
done

RECORDING_ARGS=()
if [[ -n "${RECORDINGS_DIR}" ]]; then
  mkdir -p "${RECORDINGS_DIR}/${CAMERA_ID}"
  RECORDING_ARGS=(
    -map "[vrec]"
    -map 0:a?
    -c:v "${ENCODER}"
    -preset "${PRESET}"
    "${TUNE[@]}"
    -pix_fmt "${PIX_FMT}"
    -b:v 2000k
    -maxrate 2200k
    -bufsize 4000k
    -r 30
    -g 30
    -keyint_min 30
    -sc_threshold 0
    -force_key_frames "expr:gte(t,n_forced*1)"
    -c:a aac
    -b:a 96k
    -ac 2
    -f segment
    -segment_time 60
    -reset_timestamps 1
    -strftime 1
    "${RECORDINGS_DIR}/${CAMERA_ID}/%s.mp4"
  )
fi

TIMESTAMP_FILTER="drawtext=fontfile=${FONT_PATH}:text='%{localtime\\:%m/%d/%Y - %H\\:%M\\:%S}':x=w-tw-20:y=h-th-20:fontsize=20:fontcolor=white:box=1:boxcolor=0x00000099"

ffmpeg \
  -fflags nobuffer \
  -flags low_delay \
  -strict experimental \
  -i "${SOURCE_URL}" \
  -filter_complex "[0:v]${TIMESTAMP_FILTER}[v0];[v0]split=5[vrec][v1][v2][v3][v4]" \
  -map "[v1]" -map 0:a? -c:v:0 "${ENCODER}" -preset "${PRESET}" "${TUNE[@]}" -pix_fmt "${PIX_FMT}" -b:v:0 2000k -maxrate:v:0 2200k -bufsize:v:0 4000k -r:v:0 30 -g:v:0 30 -keyint_min:v:0 30 -sc_threshold 0 -force_key_frames "expr:gte(t,n_forced*1)" \
  -map "[v2]" -map 0:a? -c:v:1 "${ENCODER}" -preset "${PRESET}" "${TUNE[@]}" -pix_fmt "${PIX_FMT}" -b:v:1 1000k -maxrate:v:1 1100k -bufsize:v:1 2000k -r:v:1 20 -g:v:1 20 -keyint_min:v:1 20 -sc_threshold 0 -force_key_frames "expr:gte(t,n_forced*1)" \
  -map "[v3]" -map 0:a? -c:v:2 "${ENCODER}" -preset "${PRESET}" "${TUNE[@]}" -pix_fmt "${PIX_FMT}" -b:v:2 500k -maxrate:v:2 600k -bufsize:v:2 1200k -r:v:2 20 -g:v:2 20 -keyint_min:v:2 20 -sc_threshold 0 -force_key_frames "expr:gte(t,n_forced*1)" \
  -map "[v4]" -map 0:a? -c:v:3 "${ENCODER}" -preset "${PRESET}" "${TUNE[@]}" -pix_fmt "${PIX_FMT}" -b:v:3 100k -maxrate:v:3 120k -bufsize:v:3 300k -r:v:3 15 -g:v:3 15 -keyint_min:v:3 15 -sc_threshold 0 -force_key_frames "expr:gte(t,n_forced*1)" \
  -c:a aac -b:a 96k -ac 2 \
  -f hls \
  -hls_time 1 \
  -hls_list_size 6 \
  -hls_flags delete_segments+append_list+independent_segments+program_date_time+temp_file \
  -master_pl_name master.m3u8 \
  -var_stream_map "v:0,a:0 v:1,a:0 v:2,a:0 v:3,a:0" \
  -hls_segment_filename "${OUTPUT_DIR}/${CAMERA_ID}/%v/segment_%06d.ts" \
  "${OUTPUT_DIR}/${CAMERA_ID}/%v/playlist.m3u8" \
  "${RECORDING_ARGS[@]}"
