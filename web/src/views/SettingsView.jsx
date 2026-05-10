import { useState, useEffect } from "react";
import { useConfig, useEdges, useSaveConfig } from "../api/queries.js";
import { useLiveStore } from "../store.js";
import { apiUrl } from "../api/base.js";

export default function SettingsView() {
  const { data: config, isLoading } = useConfig();
  const { data: edgeData } = useEdges();
  const save = useSaveConfig();
  const wsEdges = useLiveStore((s) => s.edges);
  const edges = edgeData?.edges ?? wsEdges;
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    if (config && !draft) setDraft(structuredClone(config));
  }, [config, draft]);

  if (isLoading || !draft) {
    return <div className="p-6 text-sm text-zinc-500">Loading…</div>;
  }

  function updateCamera(idx, patch) {
    const cameras = draft.cameras.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    setDraft({ ...draft, cameras });
  }

  function updateField(path, value) {
    setDraft((prev) => {
      const next = structuredClone(prev);
      let target = next;
      for (let i = 0; i < path.length - 1; i++) target = target[path[i]];
      target[path[path.length - 1]] = value;
      return next;
    });
  }

  async function onSave() {
    await save.mutateAsync(draft);
  }

  return (
    <div className="p-6 max-w-3xl space-y-5">
      <header>
        <h2 className="text-xl font-semibold tracking-tight">Settings</h2>
      </header>

      <section className="card p-5">
        <h3 className="font-medium mb-3">Cameras</h3>
        <div className="space-y-2">
          {draft.cameras.map((cam, i) => (
            <div key={cam.id} className="grid grid-cols-12 gap-3 items-center">
              <span className="col-span-2 text-xs text-zinc-500">{cam.id}</span>
              <input
                className="input col-span-5"
                value={cam.name}
                onChange={(e) => updateCamera(i, { name: e.target.value })}
              />
              <input
                type="number"
                className="input col-span-3"
                value={cam.srtPort}
                onChange={(e) => updateCamera(i, { srtPort: Number(e.target.value) })}
              />
              <label className="col-span-2 flex items-center gap-2 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={cam.enabled}
                  onChange={(e) => updateCamera(i, { enabled: e.target.checked })}
                />
                Enabled
              </label>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <h3 className="font-medium mb-3">Edges</h3>
        {edges.length === 0 ? (
          <p className="text-sm text-zinc-500">No edges connected.</p>
        ) : (
          <ul className="space-y-2">
            {edges.map((e) => (
              <li key={e.id} className="flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium">{e.hostname}</p>
                  <p className="text-xs text-zinc-500">{e.ip || (e.addresses ?? []).join(", ")}</p>
                </div>
                <button
                  className="btn"
                  onClick={() => fetch(apiUrl(`/api/edges/${encodeURIComponent(e.id)}/command`), {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ type: "restart-supervisor" })
                  })}
                >
                  Restart
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5">
        <h3 className="font-medium mb-3">Motion detection</h3>
        <div className="grid grid-cols-2 gap-4">
          <label>
            <span className="label">Sensitivity (0–1)</span>
            <input
              type="number" step="0.01" min="0" max="1"
              className="input"
              value={draft.motion?.sensitivity ?? 0.04}
              onChange={(e) => updateField(["motion", "sensitivity"], Number(e.target.value))}
            />
          </label>
          <label>
            <span className="label">Minimum duration (ms)</span>
            <input
              type="number"
              className="input"
              value={draft.motion?.minDurationMs ?? 1500}
              onChange={(e) => updateField(["motion", "minDurationMs"], Number(e.target.value))}
            />
          </label>
        </div>
        <label className="flex items-center gap-2 mt-4 text-sm">
          <input
            type="checkbox"
            checked={draft.motion?.enabled ?? true}
            onChange={(e) => updateField(["motion", "enabled"], e.target.checked)}
          />
          Motion detection enabled
        </label>
      </section>

      <section className="card p-5">
        <h3 className="font-medium mb-3">Storage</h3>
        <label className="block max-w-xs">
          <span className="label">Recording cap (GB)</span>
          <input
            type="number"
            className="input"
            value={draft.storage?.maxBackupGb ?? 50}
            onChange={(e) => updateField(["storage", "maxBackupGb"], Number(e.target.value))}
          />
        </label>
      </section>

      <div className="flex justify-end">
        <button className="btn btn-primary" onClick={onSave} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save settings"}
        </button>
      </div>
    </div>
  );
}
