# Chickencams

A LAN-first multi-camera viewer with live feeds, activity playback, rewind (DVR), and clip downloads.

## About

Chickencams is a single-node server + web UI meant for local networks. It exposes a simple web UI for live camera feeds, a rewind timeline backed by HLS DVR playlists, and on-demand downloads built from recorded segments. The design assumes you already have per-camera encoders running (USB or RTSP capture) and focuses on presenting the feeds, activity clips, and downloads in one place.

## Quick start

1. Install dependencies and start the server:

```bash
npm install
npm run start
```

2. Open the UI in a browser:

- User UI: `http://chickens.local:3000/`
- Config UI: `http://chickens.local:3000/config`

If you are not using `chickens.local`, swap in the host IP or hostname where the server is running.

## One-click launchers (Linux file managers)

If you prefer to start Chickencams without typing commands, use the clickable launcher files in the repo root:

1. Double-click `Chickencams.desktop`.
2. If your desktop asks to mark it as trusted/executable, confirm once.

The launcher runs `launch-chickencams.sh`, opens `http://localhost:3000/`, and starts the server in a terminal.

## Requirements

- Node.js 18+ (uses native ES modules).
- ffmpeg available on the host running the encoder scripts.
- A shared storage location for HLS streams, recordings, and activity clips.

## Configuration

- The server loads defaults from `server/config.default.json` and applies overrides from `server/config.json` if present.
- Camera definitions live in `server/camera-registry.json` (edit this file to add/remove cameras).
- The config and download endpoints are available without authentication on a trusted LAN.
- Use `/config` to set the aggregator host once and enter camera ports instead of full ingest URLs.

## Project layout

- `server/` — Express server, API endpoints, and ffmpeg scripts.
- `public/` — Static front-end assets served by the server.
- `streams/` — HLS output directory (created by encoders).
- `recordings/` — 60-second MP4 segments for downloads (created by the recorder).
- `activity/` — Motion-triggered clips (copied in externally).

## Scripts

- `npm run start` — Start the server (production-style).
- `npm run dev` — Start the server (same as start, handy for local work).

## Live feeds

Live playback uses HLS with low-latency settings. The server is ready to accept USB or RTSP inputs, then transcode with NVENC and burn timestamps into the video frames.

By default the server auto-starts the per-camera encoder and recorder jobs for enabled cameras at boot (requires `ffmpeg` on the server host). You can disable this by setting `autoStartEncoders` to `false` in `server/config.json` or `server/config.default.json`.

Manual run (one per camera):

```bash
./server/ffmpeg/encode_hls.sh cam1 "srt://0.0.0.0:9001?mode=listener" ./streams
```

## Recording (1-minute segments)

The recording job stores the 2 Mbps tier in 60-second MP4 segments for seamless concat.

```bash
./server/ffmpeg/record_segments.sh cam1 "srt://0.0.0.0:9001?mode=listener" ./recordings
```

Segments are saved as epoch timestamps for stitching during downloads.

## Activity clips

Put motion-triggered clips in `./activity/<cameraId>/` as MP4 files. The Activity tab loads the newest clips first.

## Download workflow

The download API zips one MP4 per camera by concatenating the relevant 60-second segments without re-encoding.

## Rewind (DVR)

Point the rewind player at an HLS DVR playlist (for example, `./streams/<cameraId>/dvr/playlist.m3u8`). Ensure the playlist keeps a longer window with `#EXT-X-PROGRAM-DATE-TIME` so the player can seek by timestamp.

## Aggregator PC

See [`Aggregator PC/README.md`](Aggregator%20PC/README.md) for the ThinkPad-side capture instructions.

## Deployment (systemd)

Use the sample unit file below to enable automatic restarts:

```bash
sudo cp server/chickencams.service /etc/systemd/system/chickencams.service
sudo systemctl daemon-reload
sudo systemctl enable --now chickencams
```
