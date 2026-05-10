import { Link } from "react-router-dom";
import { useRef } from "react";
import clsx from "clsx";
import { Maximize2, Rewind } from "lucide-react";
import WebRTCPlayer from "../components/WebRTCPlayer.jsx";
import StatusPill from "../components/StatusPill.jsx";
import { useCameras } from "../api/queries.js";
import { useLiveStore } from "../store.js";

export default function LiveView() {
  const { data, isLoading, isError } = useCameras();
  const recentMotion = useLiveStore((s) => s.recentMotion);
  const cameras = (data?.cameras ?? []).filter((c) => c.enabled && c.health?.status !== "OFFLINE");

  return (
    <div className="p-6">
      <header className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold tracking-tight">Live</h2>
      </header>

      {isLoading && <p className="text-sm text-zinc-500">Loading…</p>}
      {isError && <p className="text-sm text-rose-400">Failed to load cameras.</p>}

      {!isLoading && cameras.length === 0 && (
        <div className="card p-12 text-center">
          <p className="text-zinc-400">No cameras receiving signal.</p>
          <Link to="/settings" className="btn mt-4">Open settings</Link>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
        {cameras.map((cam) => {
          const motionAge = recentMotion[cam.id] ? Date.now() - recentMotion[cam.id] : Infinity;
          const recentlyMoved = motionAge < 10000;
          return (
            <CameraCard key={cam.id} cam={cam} recentlyMoved={recentlyMoved} />
          );
        })}
      </div>
    </div>
  );
}

function CameraCard({ cam, recentlyMoved }) {
  const frameRef = useRef(null);

  async function openFullscreen() {
    try {
      await frameRef.current?.requestFullscreen?.();
    } catch {}
  }

  return (
    <div className={clsx("card overflow-hidden", recentlyMoved && "motion-pulse")}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-sm truncate">{cam.name}</span>
          <StatusPill status={cam.health?.status} />
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`/rewind/${cam.id}`}
            className="text-xs text-zinc-400 hover:text-zinc-100 inline-flex items-center gap-1"
            title="Rewind"
          >
            <Rewind size={14} /> DVR
          </Link>
          <button
            type="button"
            className="text-zinc-400 hover:text-zinc-100"
            onClick={openFullscreen}
            title="Fullscreen"
          >
            <Maximize2 size={15} />
          </button>
        </div>
      </div>
      <div ref={frameRef} className="aspect-video bg-black">
        <WebRTCPlayer whepUrl={cam.webrtcUrl} className="w-full h-full" />
      </div>
    </div>
  );
}
