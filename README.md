# Chickencams

A LAN-first multi-camera viewer with live feeds, activity playback, rewind (DVR), and clip downloads.

## Quick start

```bash
npm install
npm run start
```

- User UI: `http://chickens.local:3000/`
- Config UI: `http://chickens.local:3000/config`

## Live feeds

Live playback uses HLS with low-latency settings. The server is ready to accept USB or RTSP inputs, then transcode with NVENC and burn timestamps into the video frames.

Run the per-camera encoders (one per camera):

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
