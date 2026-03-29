#!/usr/bin/env bash
set -euo pipefail

CAMERA_ID=${1:?"camera id required"}
SOURCE_URL=${2:?"source url required"}
OUTPUT_DIR=${3:-"./recordings"}
FONT_PATH=${4:-"/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"}

VIDEO_ENCODER=${VIDEO_ENCODER:-auto}
ENCODER="libx264"
PRESET="veryfast"
TUNE=()
PIX_FMT="yuv420p"
VIDEO_RATE_MODE=${VIDEO_RATE_MODE:-vbr}
VIDEO_CRF=${VIDEO_CRF:-20}
VIDEO_BITRATE_KBPS=${VIDEO_BITRATE_KBPS:-2000}
VIDEO_MAXRATE_KBPS=${VIDEO_MAXRATE_KBPS:-}
VIDEO_BUFSIZE_KBPS=${VIDEO_BUFSIZE_KBPS:-}
VIDEO_FPS=${VIDEO_FPS:-10}
RECORD_SEGMENT_TIME=${RECORD_SEGMENT_TIME:-60}

ffmpeg_supports_encoder() {
  local encoder=${1:?"encoder required"}
  ffmpeg -hide_banner -encoders 2>/dev/null | grep -Eq "[[:space:]]${encoder}([[:space:]]|$)"
}

supports_nvenc() {
  ffmpeg_supports_encoder "h264_nvenc" || return 1
  ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc=size=128x72:rate=1 -t 0.1 \
    -c:v h264_nvenc -f null - >/dev/null 2>&1
}

NVENC_RETRY_COUNT=${NVENC_RETRY_COUNT:-6}
NVENC_RETRY_DELAY=${NVENC_RETRY_DELAY:-5}

select_encoder() {
  case "${VIDEO_ENCODER}" in
    nvidia|nvenc|gpu|h264_nvenc)
      if supports_nvenc; then
        ENCODER="h264_nvenc"
        PRESET="p4"
        TUNE=()
        echo "[record_segments] ${CAMERA_ID}: using NVIDIA encoder h264_nvenc." >&2
        return 0
      fi
      echo "[record_segments] ${CAMERA_ID}: VIDEO_ENCODER=${VIDEO_ENCODER} requested, but h264_nvenc is unavailable." >&2
      exit 1
      ;;
    cpu|x264|libx264)
      ENCODER="libx264"
      PRESET="veryfast"
      TUNE=(-tune zerolatency)
      echo "[record_segments] ${CAMERA_ID}: using CPU encoder libx264." >&2
      return 0
      ;;
    auto|"")
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
      if supports_nvenc; then
        ENCODER="h264_nvenc"
        PRESET="p4"
        TUNE=()
        echo "[record_segments] ${CAMERA_ID}: using NVIDIA encoder h264_nvenc (auto)." >&2
        return 0
      fi
      ENCODER="libx264"
      PRESET="veryfast"
      TUNE=(-tune zerolatency)
      echo "[record_segments] ${CAMERA_ID}: h264_nvenc unavailable, falling back to libx264." >&2
      return 0
      ;;
    *)
      echo "[record_segments] ${CAMERA_ID}: unknown VIDEO_ENCODER=${VIDEO_ENCODER}. Expected auto, nvidia, or cpu." >&2
      exit 1
      ;;
  esac
}

select_encoder

VIDEO_RATE_ARGS=()
if [[ "${VIDEO_RATE_MODE}" == "vbr" ]]; then
  if [[ "${ENCODER}" == "h264_nvenc" ]]; then
    VIDEO_RATE_ARGS=(-rc:v vbr -cq:v "${VIDEO_CRF}" -b:v 0)
  else
    VIDEO_RATE_ARGS=(-crf "${VIDEO_CRF}")
  fi
  if [[ -n "${VIDEO_MAXRATE_KBPS}" ]]; then
    VIDEO_RATE_ARGS+=(-maxrate "${VIDEO_MAXRATE_KBPS}k")
  fi
  if [[ -n "${VIDEO_BUFSIZE_KBPS}" ]]; then
    VIDEO_RATE_ARGS+=(-bufsize "${VIDEO_BUFSIZE_KBPS}k")
  fi
else
  TARGET_MAXRATE=${VIDEO_MAXRATE_KBPS:-${VIDEO_BITRATE_KBPS}}
  TARGET_BUFSIZE=${VIDEO_BUFSIZE_KBPS:-$((TARGET_MAXRATE * 2))}
  if [[ "${ENCODER}" == "h264_nvenc" ]]; then
    VIDEO_RATE_ARGS=(-rc:v cbr -b:v "${VIDEO_BITRATE_KBPS}k" -maxrate "${TARGET_MAXRATE}k" -bufsize "${TARGET_BUFSIZE}k")
  else
    VIDEO_RATE_ARGS=(-b:v "${VIDEO_BITRATE_KBPS}k" -maxrate "${TARGET_MAXRATE}k" -bufsize "${TARGET_BUFSIZE}k")
  fi
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
  -c:v "${ENCODER}" -preset "${PRESET}" "${TUNE[@]}" -pix_fmt "${PIX_FMT}" "${VIDEO_RATE_ARGS[@]}" -r "${VIDEO_FPS}" -g "${VIDEO_FPS}" -keyint_min "${VIDEO_FPS}" -sc_threshold 0 -force_key_frames "expr:gte(t,n_forced*1)" \
  -c:a aac -b:a 96k -ac 2 \
  -f segment \
  -segment_time "${RECORD_SEGMENT_TIME}" \
  -reset_timestamps 1 \
  -strftime 1 \
  "${OUTPUT_DIR}/${CAMERA_ID}/%s.mp4"
