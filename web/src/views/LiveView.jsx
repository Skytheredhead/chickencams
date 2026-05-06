import { Link } from "react-router-dom";
import clsx from "clsx";
import { Rewind } from "lucide-react";
import WebRTCPlayer from "../components/WebRTCPlayer.jsx";
import StatusPill from "../components/StatusPill.jsx";
import { useCameras } from "../api/queries.js";
import { useLiveStore } from "../store.js";

export default function LiveView() {
  const { data, isLoading, isError } = useCameras();
  const recentMotion = useLiveStore((s) => s.recentMotion);
  const cameras = (data?.cameras ?? []).filter((c) => c.enabled);

  return (
    <div className="p-6">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Live</h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            {cameras.length} camera{cameras.length === 1 ? "" : "s"} streaming over WebRTC
          </p>
        </div>
      </header>

      {isLoading && <p className="text-sm text-zinc-500">Loading…</p>}
      {isError && <p className="text-sm text-rose-400">Failed to load cameras.</p>}

      {!isLoading && cameras.length === 0 && (
        <div className="card p-12 text-center">
          <p className="text-zinc-400">No cameras enabled.</p>
          <Link to="/settings" className="btn mt-4">Open settings</Link>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
        {cameras.map((cam) => {
          const motionAge = recentMotion[cam.id] ? Date.now() - recentMotion[cam.id] : Infinity;
          const recentlyMoved = motionAge < 10000;
          return (
            <div
              key={cam.id}
              className={clsx("card overflow-hidden", recentlyMoved && "motion-pulse")}
            >
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-sm truncate">{cam.name}</span>
                  <StatusPill status={cam.health?.status} />
                </div>
                <Link
                  to={`/dvr/${cam.id}`}
                  className="text-xs text-zinc-400 hover:text-zinc-100 inline-flex items-center gap-1"
                  title="DVR"
                >
                  <Rewind size={14} /> DVR
                </Link>
              </div>
              <div className="aspect-video bg-black">
                {cam.health?.status !== "OFFLINE" ? (
                  <WebRTCPlayer whepUrl={cam.webrtcUrl} className="w-full h-full" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-zinc-600">
                    Offline
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
