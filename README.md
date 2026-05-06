# Chickencams

LAN-only home camera system. Cheap USB webcams plug into one or more **edge** machines (e.g. an old ThinkPad). The edge encodes H.264 and pushes SRT streams to a **central** server which republishes them as WebRTC live, LL-HLS DVR, and recorded fMP4 segments.

```
USB cams ─▶ Edge (encode + SRT push) ─[LAN]─▶ Central (MediaMTX + index + UI)
                                                 │
                                                 ├─ WebRTC (sub-second live)
                                                 ├─ HLS    (DVR / rewind)
                                                 └─ fMP4   (recordings)
```

## Stack

- **Central**: Node.js (Express + ws + better-sqlite3 + bonjour-service + chokidar) + MediaMTX (SRT/HLS/WebRTC server) + ffmpeg (export, motion clipping)
- **Edge**: Node.js supervisor + WebSocket control channel + ffmpeg/libx264 + SRT publisher
- **Web**: React + Vite + Tailwind, WebRTC live + hls.js for DVR
- **Discovery**: mDNS (`_chickencams-central._tcp`) — no static IPs needed
- **Auth**: none, LAN only

## Prerequisites

- Linux for both edge and central (works on macOS for development)
- Node.js 20+, ffmpeg, [MediaMTX](https://github.com/bluenviron/mediamtx) (`apt install` or unpack the binary into `vendor/mediamtx/`)
- Edge needs `v4l2-utils`

## First run

```bash
git clone <this repo>
cd chickencams
npm install
npm run build:web
node server/index.js
```

Open `http://<central-ip>:7979/`. The web UI shows live WebRTC for every connected camera; DVR / Activity / Export / Settings live in the sidebar.

## Edge setup

On the edge machine:

```bash
npm install
node Edge/edge-ui.js   # http://<edge-ip>:3010 — pick devices and SRT ports
node Edge/supervisor.js
```

The supervisor auto-discovers central via mDNS and pushes SRT to the configured ports (default 9001+). Set `CHICKENCAMS_HOST=192.168.1.50` to override discovery.

## systemd

```bash
# on the central machine
npm run install:systemd:central

# on each edge machine
npm run install:systemd:edge
```

## Development

```bash
npm run dev              # central API + WS on :7979
npm run dev:web          # Vite dev server on :5173 with /api proxy
```

## Layout

- `server/` — central server (Express API, WS hub, MediaMTX runner, SQLite index, motion worker, mDNS)
- `Edge/` — edge supervisor + capture.sh + edge-ui
- `web/` — React UI (Vite, builds to `web/dist` which Express serves)
- `recordings/` — fMP4 segments written by MediaMTX (per-camera dirs)
- `activity/` — motion-triggered clips + thumbnails

## Configuration

Defaults live in `server/config.default.json`. Anything overridden through the Settings UI is persisted to `server/config.json` (cameras go to `server/camera-registry.json`).

### Cloudflare Tunnel / reverse proxy

If you're accessing the dashboard through a reverse proxy or Cloudflare Tunnel, you'll typically expose the dashboard on one hostname and MediaMTX HLS/WebRTC on others.
Set these in `server/config.json` (or via the Settings UI if you surface them):

- `ui.hlsBaseUrl`: e.g. `https://hls.skylarenns.com`
- `ui.webrtcBaseUrl`: e.g. `https://webrtc.skylarenns.com`

This makes `/api/cameras` return `hlsUrl` / `webrtcUrl` that point at the tunneled hostnames instead of `:<port>` on the dashboard hostname.
