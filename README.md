# Chickencams

A LAN-first multi-camera viewer with live feeds, downloads, rewinds, and activity detection (coming soon on the last two)

## About

Chickencams is a beautiful easy to use linux app that allows you to turn a couple of cheap webcams (or stripped laptop webcams) and turn them into a feature-rich home security system. The usb webcams run into a linux aggregate device (I'm using an old Thinkpad-W530) and having that re-encode the raw camera outputs and push them over your home internet to get to your main linux server. Said linux server takes the streams and puts em on 192.168.1.whatever:3000 where a user can stream, download, view activity, and rewind to see if you missed anything. Pretty flipping easy to use too.

## How it works (TLDR)
$4 webcams -> old linux machine -> [my home LAN] -> linux server (maybe -> cloudflare tunnel in the future)

## Quick start

1. Install dependencies (and ffmpeg) and start the program on the main server:

figure out how to install ffmpeg. you got this

open the file **launch-chickencams.sh** (run as program)

2. Open the main UI in a browser:

- User UI: `http://your_pc's_ip:3000/`
- Config UI: `http://your_pc's_ip:3000/config` (ignore that one setting in there right now, it doesn't do anything)

3. Aggregator PC setup:

Install ffmpeg. Ask chatgpt im too lazy to type this all out right now.

Run this command in
```
cd ~/Downloads/chickencams-main
```
^ or whatever you had the folder/whatever you named it

Then, run this command:
```bash
node "Aggregator PC/aggregator-ui.js"
```

Go on a browser and go to the aggregator pc's ip. Ask chatgpt how to find that.
- Aggregator UI: `http://aggregator_pc's_ip:3010`
Select the video device for each camera. If you see two, its cause linux is goofy, just select the -index0 one. Leave the ports alone on their default settings (9001-9005)


uh like and subscribe if you need help. This ___might___ be maintained. probably not. who knows. I made this so I can spy on my chickens from halfway across the country.
