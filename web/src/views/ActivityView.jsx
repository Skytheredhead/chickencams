import { Link } from "react-router-dom";
import { useActivity, useCameras } from "../api/queries.js";
import { apiUrl } from "../api/base.js";

export default function ActivityView() {
  const { data, isLoading } = useActivity();
  const { data: camData } = useCameras();
  const camNames = new Map((camData?.cameras ?? []).map((c) => [c.id, c.name]));

  const items = data?.items ?? [];

  return (
    <div className="p-6">
      <header className="mb-6">
        <h2 className="text-xl font-semibold tracking-tight">Activity</h2>
        <p className="text-sm text-zinc-500 mt-0.5">Motion-triggered clips, newest first.</p>
      </header>

      {isLoading && <p className="text-sm text-zinc-500">Loading…</p>}
      {!isLoading && items.length === 0 && (
        <div className="card p-12 text-center text-zinc-500">No motion events recorded yet.</div>
      )}

      <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {items.map((it) => {
          const dur = Math.max(1, Math.round((it.endedAt - it.startedAt) / 1000));
          return (
            <li key={it.id} className="card overflow-hidden">
              <div className="aspect-video bg-black relative">
                <img
                  src={apiUrl(`/api/activity/${it.id}/thumbnail`)}
                  alt=""
                  className="w-full h-full object-cover opacity-90"
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                />
                <span className="absolute bottom-2 right-2 pill pill-offline">{dur}s</span>
              </div>
              <div className="px-4 py-2.5 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{camNames.get(it.cameraId) ?? it.cameraId}</p>
                  <p className="text-xs text-zinc-500">{new Date(it.startedAt).toLocaleString()}</p>
                </div>
                <Link
                  to={`/dvr/${it.cameraId}`}
                  className="text-xs text-zinc-400 hover:text-zinc-100"
                >
                  View →
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
