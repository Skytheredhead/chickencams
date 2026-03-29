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
HLS_SEGMENT_TIME=${HLS_SEGMENT_TIME:-1}
HLS_PLAYLIST_SIZE=${HLS_PLAYLIST_SIZE:-300}
RECORD_SEGMENT_TIME=${RECORD_SEGMENT_TIME:-60}

supports_nvenc() {
  command -v nvidia-smi >/dev/null 2>&1 || return 1
  ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc=size=128x72:rate=1 -t 0.1 \
    -c:v h264_nvenc -f null - >/dev/null 2>&1
}

NVENC_RETRY_COUNT=${NVENC_RETRY_COUNT:-6}
NVENC_RETRY_DELAY=${NVENC_RETRY_DELAY:-5}

if ! supports_nvenc; then
  attempts=0
  while (( attempts < NVENC_RETRY_COUNT )); do
    attempts=$((attempts + 1))
    sleep "${NVENC_RETRY_DELAY}"
    if supports_nvenc; then
      break
    fi
  done
fi

if ! supports_nvenc; then
  ENCODER="libx264"
  PRESET="veryfast"
  TUNE=(-tune zerolatency)
  SC_THRESHOLD=(-sc_threshold 0)
fi

get_setting() {
  local key=${1}
  local fallback=${2:-}
  printf '%s' "${!key:-${fallback}}"
}

set_rate_args() {
  local -n output_ref=$1
  local stream_specifier=$2
  local encoder=$3
  local rate_mode=$4
  local bitrate_kbps=$5
  local maxrate_kbps=$6
  local bufsize_kbps=$7
  local crf=$8

  output_ref=()
  if [[ "${rate_mode}" == "vbr" ]]; then
    if [[ "${encoder}" == "h264_nvenc" ]]; then
      output_ref=("-rc:v${stream_specifier}" vbr "-cq:v${stream_specifier}" "${crf}" "-b:v${stream_specifier}" 0)
    else
      output_ref=("-crf:v${stream_specifier}" "${crf}")
    fi
    if [[ -n "${maxrate_kbps}" ]]; then
      output_ref+=("-maxrate:v${stream_specifier}" "${maxrate_kbps}k")
    fi
    if [[ -n "${bufsize_kbps}" ]]; then
      output_ref+=("-bufsize:v${stream_specifier}" "${bufsize_kbps}k")
    fi
    return
  fi

  local target_bitrate=${bitrate_kbps:-2000}
  local target_maxrate=${maxrate_kbps:-${target_bitrate}}
  local target_bufsize=${bufsize_kbps:-$((target_maxrate * 2))}
  if [[ "${encoder}" == "h264_nvenc" ]]; then
    output_ref=("-rc:v${stream_specifier}" cbr "-b:v${stream_specifier}" "${target_bitrate}k" "-maxrate:v${stream_specifier}" "${target_maxrate}k" "-bufsize:v${stream_specifier}" "${target_bufsize}k")
  else
    output_ref=("-b:v${stream_specifier}" "${target_bitrate}k" "-maxrate:v${stream_specifier}" "${target_maxrate}k" "-bufsize:v${stream_specifier}" "${target_bufsize}k")
  fi
}

VARIANT_0_RATE_MODE=$(get_setting HLS_VARIANT_0_RATE_MODE vbr)
VARIANT_0_BITRATE_KBPS=$(get_setting HLS_VARIANT_0_BITRATE_KBPS 2000)
VARIANT_0_MAXRATE_KBPS=$(get_setting HLS_VARIANT_0_MAXRATE_KBPS)
VARIANT_0_BUFSIZE_KBPS=$(get_setting HLS_VARIANT_0_BUFSIZE_KBPS)
VARIANT_0_CRF=$(get_setting HLS_VARIANT_0_CRF 20)
VARIANT_0_FPS=$(get_setting HLS_VARIANT_0_FPS 10)

VARIANT_1_RATE_MODE=$(get_setting HLS_VARIANT_1_RATE_MODE vbr)
VARIANT_1_BITRATE_KBPS=$(get_setting HLS_VARIANT_1_BITRATE_KBPS 1000)
VARIANT_1_MAXRATE_KBPS=$(get_setting HLS_VARIANT_1_MAXRATE_KBPS)
VARIANT_1_BUFSIZE_KBPS=$(get_setting HLS_VARIANT_1_BUFSIZE_KBPS)
VARIANT_1_CRF=$(get_setting HLS_VARIANT_1_CRF 23)
VARIANT_1_FPS=$(get_setting HLS_VARIANT_1_FPS 10)

VARIANT_2_RATE_MODE=$(get_setting HLS_VARIANT_2_RATE_MODE vbr)
VARIANT_2_BITRATE_KBPS=$(get_setting HLS_VARIANT_2_BITRATE_KBPS 500)
VARIANT_2_MAXRATE_KBPS=$(get_setting HLS_VARIANT_2_MAXRATE_KBPS)
VARIANT_2_BUFSIZE_KBPS=$(get_setting HLS_VARIANT_2_BUFSIZE_KBPS)
VARIANT_2_CRF=$(get_setting HLS_VARIANT_2_CRF 27)
VARIANT_2_FPS=$(get_setting HLS_VARIANT_2_FPS 10)

VARIANT_3_RATE_MODE=$(get_setting HLS_VARIANT_3_RATE_MODE vbr)
VARIANT_3_BITRATE_KBPS=$(get_setting HLS_VARIANT_3_BITRATE_KBPS 100)
VARIANT_3_MAXRATE_KBPS=$(get_setting HLS_VARIANT_3_MAXRATE_KBPS)
VARIANT_3_BUFSIZE_KBPS=$(get_setting HLS_VARIANT_3_BUFSIZE_KBPS)
VARIANT_3_CRF=$(get_setting HLS_VARIANT_3_CRF 31)
VARIANT_3_FPS=$(get_setting HLS_VARIANT_3_FPS 10)

RECORD_RATE_MODE=$(get_setting RECORD_RATE_MODE "${VARIANT_0_RATE_MODE}")
RECORD_BITRATE_KBPS=$(get_setting RECORD_BITRATE_KBPS "${VARIANT_0_BITRATE_KBPS}")
RECORD_MAXRATE_KBPS=$(get_setting RECORD_MAXRATE_KBPS "${VARIANT_0_MAXRATE_KBPS}")
RECORD_BUFSIZE_KBPS=$(get_setting RECORD_BUFSIZE_KBPS "${VARIANT_0_BUFSIZE_KBPS}")
RECORD_CRF=$(get_setting RECORD_CRF "${VARIANT_0_CRF}")
RECORD_FPS=$(get_setting RECORD_FPS "${VARIANT_0_FPS}")

set_rate_args RECORD_RATE_ARGS "" "${ENCODER}" "${RECORD_RATE_MODE}" "${RECORD_BITRATE_KBPS}" "${RECORD_MAXRATE_KBPS}" "${RECORD_BUFSIZE_KBPS}" "${RECORD_CRF}"
set_rate_args VARIANT_0_RATE_ARGS ":0" "${ENCODER}" "${VARIANT_0_RATE_MODE}" "${VARIANT_0_BITRATE_KBPS}" "${VARIANT_0_MAXRATE_KBPS}" "${VARIANT_0_BUFSIZE_KBPS}" "${VARIANT_0_CRF}"
set_rate_args VARIANT_1_RATE_ARGS ":1" "${ENCODER}" "${VARIANT_1_RATE_MODE}" "${VARIANT_1_BITRATE_KBPS}" "${VARIANT_1_MAXRATE_KBPS}" "${VARIANT_1_BUFSIZE_KBPS}" "${VARIANT_1_CRF}"
set_rate_args VARIANT_2_RATE_ARGS ":2" "${ENCODER}" "${VARIANT_2_RATE_MODE}" "${VARIANT_2_BITRATE_KBPS}" "${VARIANT_2_MAXRATE_KBPS}" "${VARIANT_2_BUFSIZE_KBPS}" "${VARIANT_2_CRF}"
set_rate_args VARIANT_3_RATE_ARGS ":3" "${ENCODER}" "${VARIANT_3_RATE_MODE}" "${VARIANT_3_BITRATE_KBPS}" "${VARIANT_3_MAXRATE_KBPS}" "${VARIANT_3_BUFSIZE_KBPS}" "${VARIANT_3_CRF}"

VARIANT_0_GOP=$((VARIANT_0_FPS * HLS_SEGMENT_TIME))
VARIANT_1_GOP=$((VARIANT_1_FPS * HLS_SEGMENT_TIME))
VARIANT_2_GOP=$((VARIANT_2_FPS * HLS_SEGMENT_TIME))
VARIANT_3_GOP=$((VARIANT_3_FPS * HLS_SEGMENT_TIME))
RECORD_GOP=${RECORD_FPS}

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
    "${RECORD_RATE_ARGS[@]}"
    -r "${RECORD_FPS}"
    -g "${RECORD_GOP}"
    -keyint_min "${RECORD_GOP}"
    "${SC_THRESHOLD[@]}"
    -force_key_frames:v "expr:gte(t,n_forced*${HLS_SEGMENT_TIME})"
    "${AUDIO_CODEC[@]}"
    -f segment
    -segment_time "${RECORD_SEGMENT_TIME}"
    -reset_timestamps 1
    -strftime 1
    "${RECORDINGS_DIR}/${CAMERA_ID}/%s.mp4"
  )
fi

TIMESTAMP_FILTER="drawtext=fontfile=${FONT_PATH}:text='%{localtime\\:%Y-%m-%d %H.%M.%S}':x=w-tw-60:y=h-th-20:fontsize=32:fontcolor=white:box=1:boxcolor=0x00000099"
IMAGE_FILTER="eq=contrast=1.15,unsharp=5:5:0.8:5:5:0.0"

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
  -analyzeduration 0 \
  -probesize 32 \
  -strict experimental \
  -i "${SOURCE_URL}" \
  -filter_complex "[0:v]${TIMESTAMP_FILTER},${IMAGE_FILTER}[v0];[v0]split=5[vrec][v1][v2][v3][v4]" \
  -map "[v1]" -c:v:0 "${ENCODER}" -preset "${PRESET}" "${TUNE[@]}" -pix_fmt:v:0 "${PIX_FMT}" "${VARIANT_0_RATE_ARGS[@]}" -r:v:0 "${VARIANT_0_FPS}" -g:v:0 "${VARIANT_0_GOP}" -keyint_min:v:0 "${VARIANT_0_GOP}" "${SC_THRESHOLD[@]}" -force_key_frames:v:0 "expr:gte(t,n_forced*${HLS_SEGMENT_TIME})" \
  -map "[v2]" -c:v:1 "${ENCODER}" -preset "${PRESET}" "${TUNE[@]}" -pix_fmt:v:1 "${PIX_FMT}" "${VARIANT_1_RATE_ARGS[@]}" -r:v:1 "${VARIANT_1_FPS}" -g:v:1 "${VARIANT_1_GOP}" -keyint_min:v:1 "${VARIANT_1_GOP}" "${SC_THRESHOLD[@]}" -force_key_frames:v:1 "expr:gte(t,n_forced*${HLS_SEGMENT_TIME})" \
  -map "[v3]" -c:v:2 "${ENCODER}" -preset "${PRESET}" "${TUNE[@]}" -pix_fmt:v:2 "${PIX_FMT}" "${VARIANT_2_RATE_ARGS[@]}" -r:v:2 "${VARIANT_2_FPS}" -g:v:2 "${VARIANT_2_GOP}" -keyint_min:v:2 "${VARIANT_2_GOP}" "${SC_THRESHOLD[@]}" -force_key_frames:v:2 "expr:gte(t,n_forced*${HLS_SEGMENT_TIME})" \
  -map "[v4]" -c:v:3 "${ENCODER}" -preset "${PRESET}" "${TUNE[@]}" -pix_fmt:v:3 "${PIX_FMT}" "${VARIANT_3_RATE_ARGS[@]}" -r:v:3 "${VARIANT_3_FPS}" -g:v:3 "${VARIANT_3_GOP}" -keyint_min:v:3 "${VARIANT_3_GOP}" "${SC_THRESHOLD[@]}" -force_key_frames:v:3 "expr:gte(t,n_forced*${HLS_SEGMENT_TIME})" \
  "${AUDIO_MAP[@]}" \
  "${AUDIO_CODEC[@]}" \
  -f hls \
  -hls_time "${HLS_SEGMENT_TIME}" \
  -hls_list_size "${HLS_PLAYLIST_SIZE}" \
  -hls_flags delete_segments+append_list+independent_segments+program_date_time+temp_file \
  -master_pl_name master.m3u8 \
  -var_stream_map "${VAR_STREAM_MAP}" \
  -hls_segment_filename "${OUTPUT_DIR}/${CAMERA_ID}/%v/segment_%06d.ts" \
  "${OUTPUT_DIR}/${CAMERA_ID}/%v/playlist.m3u8" \
  "${RECORDING_ARGS[@]}"
