import { useEffect, useRef, useState } from "react";

// MediaMTX WHEP-style WebRTC client. Issues a POST with an SDP offer and
// receives the answer in the response body.
export default function WebRTCPlayer({ whepUrl, className }) {
  const videoRef = useRef(null);
  const [status, setStatus] = useState("connecting"); // connecting | playing | offline

  useEffect(() => {
    let pc = null;
    let cancelled = false;
    let retryTimer = null;

    async function start() {
      try {
        pc = new RTCPeerConnection({ iceServers: [] });
        pc.addTransceiver("video", { direction: "recvonly" });
        pc.addTransceiver("audio", { direction: "recvonly" });
        pc.ontrack = (ev) => {
          if (videoRef.current && ev.streams[0]) {
            videoRef.current.srcObject = ev.streams[0];
            videoRef.current.play().catch(() => {});
          }
        };
        pc.onconnectionstatechange = () => {
          if (!pc) return;
          if (pc.connectionState === "connected") setStatus("playing");
          else if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
            setStatus("offline");
            scheduleRetry();
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const resp = await fetch(whepUrl, {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: offer.sdp
        });
        if (!resp.ok) throw new Error(`whep ${resp.status}`);
        const answer = await resp.text();
        if (cancelled) return;
        await pc.setRemoteDescription({ type: "answer", sdp: answer });
      } catch (err) {
        if (cancelled) return;
        setStatus("offline");
        scheduleRetry();
      }
    }

    function scheduleRetry() {
      if (cancelled || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        cleanup();
        start();
      }, 3000);
    }

    function cleanup() {
      try { pc?.close(); } catch {}
      pc = null;
    }

    start();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      cleanup();
    };
  }, [whepUrl]);

  return (
    <div className={`relative ${className ?? ""}`}>
      <video
        ref={videoRef}
        muted
        autoPlay
        playsInline
        className="w-full h-full object-cover bg-black"
      />
      {status !== "playing" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-zinc-400">
          {status === "connecting" ? "Connecting…" : "Stream offline"}
        </div>
      )}
    </div>
  );
}
