import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useCameras } from "../api/queries.js";

function toLocalInput(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(str) {
  return new Date(str).getTime();
}

export default function ExportView() {
  const { data } = useCameras();
  const [params] = useSearchParams();
  const allCameras = data?.cameras ?? [];

  const initialCam = params.get("camera");
  const initialFrom = Number(params.get("from")) || Date.now() - 60 * 60 * 1000;
  const initialTo = Number(params.get("to")) || Date.now();

  const [selected, setSelected] = useState(() => new Set(initialCam ? [initialCam] : []));
  const [fromMs, setFromMs] = useState(initialFrom);
  const [toMs, setToMs] = useState(initialTo);
  const [quality, setQuality] = useState("high");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (selected.size === 0 && allCameras.length) {
      setSelected(new Set(allCameras.filter((c) => c.enabled).map((c) => c.id)));
    }
  }, [allCameras]);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cameras: Array.from(selected),
          from: fromMs,
          to: toMs,
          quality
        })
      });
      if (!r.ok) {
        const msg = await r.json().catch(() => ({}));
        throw new Error(msg.error || `Export failed (${r.status})`);
      }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "chickencams-export.zip";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <header className="mb-6">
        <h2 className="text-xl font-semibold tracking-tight">Export clips</h2>
        <p className="text-sm text-zinc-500 mt-0.5">Stitch recorded segments into MP4 for any time range.</p>
      </header>

      <form className="card p-6 space-y-5" onSubmit={submit}>
        <div>
          <span className="label">Cameras</span>
          <div className="grid grid-cols-2 gap-2">
            {allCameras.map((cam) => (
              <label key={cam.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(cam.id)}
                  onChange={() => toggle(cam.id)}
                />
                {cam.name}
              </label>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="label">From</span>
            <input
              type="datetime-local"
              className="input"
              value={toLocalInput(fromMs)}
              onChange={(e) => setFromMs(fromLocalInput(e.target.value))}
            />
          </label>
          <label className="block">
            <span className="label">To</span>
            <input
              type="datetime-local"
              className="input"
              value={toLocalInput(toMs)}
              onChange={(e) => setToMs(fromLocalInput(e.target.value))}
            />
          </label>
        </div>
        <label className="block max-w-xs">
          <span className="label">Quality</span>
          <select className="input" value={quality} onChange={(e) => setQuality(e.target.value)}>
            <option value="high">Source (no re-encode)</option>
            <option value="med">Medium (CRF 23)</option>
            <option value="low">Low (480p, CRF 30)</option>
          </select>
        </label>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <div className="flex justify-end">
          <button type="submit" className="btn btn-primary" disabled={busy || selected.size === 0}>
            {busy ? "Exporting…" : "Download ZIP"}
          </button>
        </div>
      </form>
    </div>
  );
}
