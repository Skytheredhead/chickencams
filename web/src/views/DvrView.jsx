import { useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import HlsPlayer from "../components/HlsPlayer.jsx";
import { useCameras, useCoverage } from "../api/queries.js";

export default function DvrView() {
  const { cameraId } = useParams();
  const { data: camData } = useCameras();
  const camera = camData?.cameras?.find((c) => c.id === cameraId);

  const [windowHours, setWindowHours] = useState(2);
  const [anchor, setAnchor] = useState(() => Date.now());
  const from = anchor - windowHours * 3600 * 1000;
  const to = anchor;

  const { data: coverage } = useCoverage(cameraId, from, to);
  const [seekMs, setSeekMs] = useState(null);

  const hlsUrl = useMemo(() => {
    if (!camera?.hlsUrl) return null;
    if (seekMs == null) return camera.hlsUrl;
    return `${camera.hlsUrl}?start=${new Date(seekMs).toISOString()}`;
  }, [camera, seekMs]);

  function handleScrubClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    setSeekMs(Math.round(from + ratio * (to - from)));
  }

  if (!camera) {
    return (
      <div className="p-6">
        <Link to="/" className="text-sm text-zinc-400 inline-flex items-center gap-1">
          <ArrowLeft size={14} /> Back
        </Link>
        <p className="mt-4 text-zinc-500">Camera not found.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-zinc-400 hover:text-zinc-100"><ArrowLeft size={18} /></Link>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{camera.name} · DVR</h2>
            <p className="text-xs text-zinc-500">
              {new Date(from).toLocaleString()} → {new Date(to).toLocaleString()}
            </p>
          </div>
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
          {hlsUrl && <HlsPlayer src={hlsUrl} className="w-full h-full" controls autoPlay />}
        </div>
        <div className="p-4 border-t border-border">
          <div className="text-xs text-zinc-500 mb-2 flex justify-between">
            <span>Coverage timeline (click to seek)</span>
            {seekMs && <span>Seeking to {new Date(seekMs).toLocaleTimeString()}</span>}
          </div>
          <div
            className="relative h-6 rounded bg-surface-1 overflow-hidden cursor-pointer"
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
          to={`/export?camera=${cameraId}&from=${from}&to=${to}`}
          className="btn btn-primary"
        >
          Export this range
        </Link>
      </div>
    </div>
  );
}
