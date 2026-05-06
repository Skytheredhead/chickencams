import { useEffect, useRef } from "react";
import Hls from "hls.js";

export default function HlsPlayer({ src, className, controls = true, autoPlay = true }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    let hls;
    if (Hls.isSupported()) {
      hls = new Hls({ lowLatencyMode: true, backBufferLength: 60 });
      hls.loadSource(src);
      hls.attachMedia(video);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
    }

    if (autoPlay) video.play().catch(() => {});

    return () => {
      try { hls?.destroy(); } catch {}
    };
  }, [src, autoPlay]);

  return <video ref={videoRef} controls={controls} playsInline className={className} />;
}
