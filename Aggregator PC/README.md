# Aggregator PC

This folder contains the ThinkPad-side scripts that capture USB webcams and push them to the main Chickencams server over LAN.

## Expected flow

1. Plug webcams into the aggregator ThinkPad (Linux).
2. Map each `/dev/video*` device to a camera ID (cam1-cam5).
3. Run the capture script for each camera.

## Quick UI (LAN-accessible)

Launch the Aggregator UI to pick from available `/dev/video*` devices and start/stop capture jobs:

```bash
node "Aggregator PC/aggregator-ui.js"
```

The UI listens on port `3010` by default, lists the aggregator's LAN IPs, and prints LAN URLs on startup (override with `AGGREGATOR_UI_PORT`).

## Capture command (SRT recommended)

```bash
./capture.sh cam1 /dev/video0 chickens.local 9001
```

This sends an H.264 stream over SRT to the server listener port defined in `server/config.default.json`.

## Notes

- The script uses `libx264` for compatibility with cheap webcams.
- The server transcodes with NVENC to the ABR ladder and burns timestamps.
- Update `capture.sh` if your webcams require a specific resolution or pixel format.
