import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Download } from "lucide-react";
import HlsPlayer from "../components/HlsPlayer.jsx";
import { useCameras, useCoverage } from "../api/queries.js";
import { apiUrl } from "../api/base.js";

const HOUR = 3600 * 1000;

export default function RewindView() {
  const { cameraId } = useParams();
  const navigate = useNavigate();
  const { data: camData, isLoading } = useCameras();
  const cameras = useMemo(
    () => (camData?.cameras ?? []).filter((c) => c.enabled && c.health?.status !== "OFFLINE"),
    [camData]
  );
  const activeCamera = cameras.find((c) => c.id === cameraId) ?? cameras[0] ?? null;
  const activeCameraId = activeCamera?.id ?? "";

  const [windowHours, setWindowHours] = useState(2);
  const [anchor, setAnchor] = useState(() => Date.now());
  const [seekMs, setSeekMs] = useState(null);
  const from = anchor - windowHours * HOUR;
  const to = anchor;
  const { data: coverage } = useCoverage(activeCameraId, from, to);

  useEffect(() => {
    if (!cameraId && activeCameraId) navigate(`/rewind/${activeCameraId}`, { replace: true });
  }, [activeCameraId, cameraId, navigate]);

  useEffect(() => {
    setSeekMs(null);
  }, [activeCameraId, windowHours, anchor]);

  const playbackUrl = useMemo(() => {
    if (!activeCamera || seekMs == null) return null;
    const duration = Math.min(1800, Math.max(60, Math.round((to - seekMs) / 1000)));
    return apiUrl(`/api/playback/${encodeURIComponent(activeCamera.id)}?start=${seekMs}&duration=${duration}`);
  }, [activeCamera, seekMs, to]);

  function handleScrubClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setSeekMs(Math.round(from + ratio * (to - from)));
  }

  if (isLoading) return <div className="p-6 text-sm text-zinc-500">Loading...</div>;

  if (!activeCamera) {
    return (
      <div className="p-6">
        <h2 className="text-xl font-semibold tracking-tight">Rewind</h2>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold tracking-tight">Rewind</h2>
          <select
            className="input w-auto min-w-36"
            value={activeCamera.id}
            onChange={(e) => navigate(`/rewind/${e.target.value}`)}
          >
            {cameras.map((cam) => (
              <option key={cam.id} value={cam.id}>{cam.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn" onClick={() => setAnchor(Date.now())}>Now</button>
          <select
            className="input w-auto"
            value={windowHours}
            onChange={(e) => setWindowHours(Number(e.target.value))}
          >
            <option value={1}>1 hour</option>
            <option value={2}>2 hours</option>
            <option value={6}>6 hours</option>
            <option value={24}>24 hours</option>
          </select>
        </div>
      </header>

      <div className="card overflow-hidden">
        <div className="aspect-video bg-black">
          {playbackUrl ? (
            <video
              key={playbackUrl}
              src={playbackUrl}
              className="w-full h-full bg-black"
              controls
              autoPlay
              playsInline
            />
          ) : (
            <HlsPlayer src={activeCamera.hlsUrl} className="w-full h-full" controls autoPlay />
          )}
        </div>
        <div className="p-4 border-t border-border">
          <div
            className="relative h-7 rounded bg-surface-1 overflow-hidden cursor-pointer"
            onClick={handleScrubClick}
          >
            <div className="absolute inset-0 flex">
              {(coverage?.coverage ?? []).map((on, i) => (
                <div
                  key={i}
                  style={{ width: `${100 / (coverage?.coverage.length || 1)}%` }}
                  className={on ? "bg-emerald-700/60" : "bg-transparent"}
                />
              ))}
            </div>
            {seekMs != null && (
              <div
                className="absolute top-0 bottom-0 w-px bg-rose-400"
                style={{ left: `${((seekMs - from) / (to - from)) * 100}%` }}
              />
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Link
          to={`/export?camera=${activeCamera.id}&from=${from}&to=${to}`}
          className="btn btn-primary"
        >
          <Download size={15} /> Export
        </Link>
      </div>
    </div>
  );
}
