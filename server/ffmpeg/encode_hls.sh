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
SC_THRESHOLD=()

supports_nvenc() {
  command -v nvidia-smi >/dev/null 2>&1 || return 1
  ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc=size=128x72:rate=1 -t 0.1 \
    -c:v h264_nvenc -f null - >/dev/null 2>&1
}

if ! supports_nvenc; then
  ENCODER="libx264"
  PRESET="veryfast"
  TUNE=(-tune zerolatency)
  SC_THRESHOLD=(-sc_threshold 0)
fi

AUDIO_PRESENT=false
if command -v ffprobe >/dev/null 2>&1; then
  probe_output=$(timeout 5 ffprobe -v error -select_streams a:0 -show_entries stream=index -of csv=p=0 "${SOURCE_URL}" 2>/dev/null || true)
  if [[ -n "${probe_output}" ]]; then
    AUDIO_PRESENT=true
  fi
fi

AUDIO_MAP=()
AUDIO_CODEC=()
VAR_STREAM_MAP="v:0 v:1 v:2 v:3"
if [[ "${AUDIO_PRESENT}" == "true" ]]; then
  AUDIO_MAP=(-map 0:a?)
  AUDIO_CODEC=(-c:a aac -b:a 96k -ac 2)
  VAR_STREAM_MAP="v:0,a:0 v:1,a:0 v:2,a:0 v:3,a:0"
fi

mkdir -p "${OUTPUT_DIR}/${CAMERA_ID}"
for variant in 0 1 2 3; do
  mkdir -p "${OUTPUT_DIR}/${CAMERA_ID}/${variant}"
done

rm -f "${OUTPUT_DIR}/${CAMERA_ID}/master.m3u8"
for variant in 0 1 2 3; do
  rm -f "${OUTPUT_DIR}/${CAMERA_ID}/${variant}/"*.ts
  rm -f "${OUTPUT_DIR}/${CAMERA_ID}/${variant}/"*.m3u8
done

RECORDING_ARGS=()
if [[ -n "${RECORDINGS_DIR}" ]]; then
  mkdir -p "${RECORDINGS_DIR}/${CAMERA_ID}"
  RECORDING_ARGS=(
    -map "[vrec]"
    "${AUDIO_MAP[@]}"
    -c:v "${ENCODER}"
    -preset "${PRESET}"
    "${TUNE[@]}"
    -pix_fmt:v "${PIX_FMT}"
    -b:v 2000k
    -maxrate 2200k
    -bufsize 4000k
    -r 30
    -g 30
    -keyint_min 30
    "${SC_THRESHOLD[@]}"
    -force_key_frames:v "expr:gte(t,n_forced*1)"
    "${AUDIO_CODEC[@]}"
    -f segment
    -segment_time 60
    -reset_timestamps 1
    -strftime 1
    "${RECORDINGS_DIR}/${CAMERA_ID}/%s.mp4"
  )
fi

TIMESTAMP_FILTER="drawtext=fontfile=${FONT_PATH}:text='%{localtime\\:%Y-%m-%d %H.%M.%S}':x=w-tw-20:y=h-th-20:fontsize=32:fontcolor=white:box=1:boxcolor=0x00000099"

ffmpeg \
  -hide_banner \
  -loglevel error \
  -nostats \
  -fflags +genpts+nobuffer+discardcorrupt \
  -use_wallclock_as_timestamps 1 \
  -avoid_negative_ts make_zero \
  -flags low_delay \
  -err_detect ignore_err \
  -max_delay 0 \
  -strict experimental \
  -i "${SOURCE_URL}" \
  -filter_complex "[0:v]${TIMESTAMP_FILTER}[v0];[v0]split=5[vrec][v1][v2][v3][v4]" \
  -map "[v1]" -c:v:0 "${ENCODER}" -preset "${PRESET}" "${TUNE[@]}" -pix_fmt:v:0 "${PIX_FMT}" -b:v:0 2000k -maxrate:v:0 2200k -bufsize:v:0 4000k -r:v:0 30 -g:v:0 30 -keyint_min:v:0 30 "${SC_THRESHOLD[@]}" -force_key_frames:v:0 "expr:gte(t,n_forced*1)" \
  -map "[v2]" -c:v:1 "${ENCODER}" -preset "${PRESET}" "${TUNE[@]}" -pix_fmt:v:1 "${PIX_FMT}" -b:v:1 1000k -maxrate:v:1 1100k -bufsize:v:1 2000k -r:v:1 20 -g:v:1 20 -keyint_min:v:1 20 "${SC_THRESHOLD[@]}" -force_key_frames:v:1 "expr:gte(t,n_forced*1)" \
  -map "[v3]" -c:v:2 "${ENCODER}" -preset "${PRESET}" "${TUNE[@]}" -pix_fmt:v:2 "${PIX_FMT}" -b:v:2 500k -maxrate:v:2 600k -bufsize:v:2 1200k -r:v:2 20 -g:v:2 20 -keyint_min:v:2 20 "${SC_THRESHOLD[@]}" -force_key_frames:v:2 "expr:gte(t,n_forced*1)" \
  -map "[v4]" -c:v:3 "${ENCODER}" -preset "${PRESET}" "${TUNE[@]}" -pix_fmt:v:3 "${PIX_FMT}" -b:v:3 100k -maxrate:v:3 120k -bufsize:v:3 300k -r:v:3 15 -g:v:3 15 -keyint_min:v:3 15 "${SC_THRESHOLD[@]}" -force_key_frames:v:3 "expr:gte(t,n_forced*1)" \
  "${AUDIO_MAP[@]}" \
  "${AUDIO_CODEC[@]}" \
  -f hls \
  -hls_time 1 \
  -hls_list_size 300 \
  -hls_flags delete_segments+append_list+independent_segments+program_date_time+temp_file \
  -master_pl_name master.m3u8 \
  -var_stream_map "${VAR_STREAM_MAP}" \
  -hls_segment_filename "${OUTPUT_DIR}/${CAMERA_ID}/%v/segment_%06d.ts" \
  "${OUTPUT_DIR}/${CAMERA_ID}/%v/playlist.m3u8" \
  "${RECORDING_ARGS[@]}"
