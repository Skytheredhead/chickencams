# Edge

Edge-side scripts for capturing USB webcams and publishing them to the central server over SRT.

## Architecture

The edge auto-discovers the central server via mDNS (`_chickencams-central._tcp`) and opens a persistent WebSocket to it for telemetry, command channel, and health. Streams are published over SRT directly to the central server's MediaMTX listener.

## One-time setup

1. Install ffmpeg, Node.js, and `v4l2-utils` on the edge machine.
2. Plug in your USB webcams.
3. From the repo root, `npm install`.

## Configure cameras

Open the Edge UI in a browser and assign each `cam{N}` slot to a stable `/dev/v4l/by-id/...` device:

```bash
node Edge/edge-ui.js
# then open http://<edge-ip>:3010/
```

The UI saves to `Edge/registry.json`. The supervisor reads this file every poll tick.

## Run the supervisor

```bash
node Edge/supervisor.js
```

Or install as a systemd service:

```bash
npm run install:systemd:edge
sudo systemctl status edge --no-pager
```

The supervisor:
- Auto-discovers the central server via mDNS (override with `CHICKENCAMS_HOST`).
- Holds a WebSocket to the central; sends 1 Hz telemetry, accepts `start-camera` / `stop-camera` / `restart-supervisor` commands.
- Spawns one `capture.sh` per enabled camera, restarts on freeze (8s no frame) or crash (5 in 120s budget before DEAD).
- Stops streams on device unplug and resumes automatically on replug.
- Mirrors telemetry to `Edge/telemetry.json` for offline debugging.

## Capture command (manual)

```bash
./capture.sh cam1 /dev/v4l/by-id/usb-camera-cam1 192.168.1.50 9001
```

This pushes H.264/MPEG-TS over SRT with `streamid=publish:cam1` so MediaMTX accepts it. Tunables:
`MAX_FPS`, `VIDEO_RATE_MODE` (`vbr`/`cbr`), `VIDEO_CRF`, `VIDEO_BITRATE_KBPS`, `VIDEO_MAXRATE_KBPS`, `SRT_LATENCY_MS`.

## Notes

- Use `/dev/v4l/by-id/...` symlinks; raw `/dev/videoN` is rejected.
- The edge does not transcode beyond what `capture.sh` already encodes (H.264 libx264). MediaMTX on central handles all repackaging.
