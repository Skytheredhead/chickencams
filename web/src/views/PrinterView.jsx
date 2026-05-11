import { useState } from "react";
import { Thermometer, Play, Pause, Square, Home, AlertTriangle, Maximize2, Minimize2 } from "lucide-react";
import { useLiveStore } from "../store.js";
import { usePrinterInfo, usePrinterGcode, usePrinterEmergencyStop } from "../api/queries.js";

const PRESETS = [
  { label: "PLA", hotend: 200, bed: 60 },
  { label: "PETG", hotend: 230, bed: 80 },
  { label: "ABS", hotend: 240, bed: 100 },
];

function TempGauge({ label, current, target, max }) {
  const pct = Math.min((current ?? 0) / max * 100, 100);
  const heating = target > 0 && current < target - 2;
  return (
    <div className="flex-1 min-w-[140px]">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-zinc-500 uppercase tracking-wider">{label}</span>
        <span className="text-sm font-mono">
          <span className={heating ? "text-orange-400" : "text-zinc-100"}>
            {current != null ? `${current.toFixed(1)}°` : "--"}
          </span>
          {target > 0 && (
            <span className="text-zinc-500"> / {target.toFixed(0)}°</span>
          )}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-0 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${heating ? "bg-orange-500" : target > 0 ? "bg-emerald-500" : "bg-zinc-600"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function StateBadge({ state }) {
  const styles = {
    standby: "pill-online",
    printing: "border-blue-700/50 bg-blue-950/40 text-blue-300",
    paused: "border-amber-700/50 bg-amber-950/40 text-amber-300",
    error: "border-rose-700/50 bg-rose-950/40 text-rose-300",
    complete: "pill-online",
    cancelled: "pill-offline",
    shutdown: "border-rose-700/50 bg-rose-950/40 text-rose-300",
  };
  return (
    <span className={`pill ${styles[state] || "pill-offline"}`}>
      {state || "disconnected"}
    </span>
  );
}

export default function PrinterView() {
  const printer = useLiveStore((s) => s.printer);
  const { data: info, isError: infoError } = usePrinterInfo();
  const gcode = usePrinterGcode();
  const estop = usePrinterEmergencyStop();
  const [fluiddExpanded, setFluiddExpanded] = useState(false);

  const state = printer?.state || info?.result?.state || null;
  const progress = printer?.progress ?? 0;
  const filename = printer?.filename || "";
  const printDuration = printer?.printDuration ?? 0;
  const hotend = printer?.hotend;
  const hotendTarget = printer?.hotendTarget ?? 0;
  const bed = printer?.bed;
  const bedTarget = printer?.bedTarget ?? 0;

  const isPrinting = state === "printing";
  const isPaused = state === "paused";

  function sendGcode(cmd) { gcode.mutate(cmd); }

  const eta = progress > 0.01 && isPrinting
    ? (printDuration / progress) - printDuration
    : null;

  if (infoError && !printer) {
    return (
      <div className="p-6">
        <header className="mb-6">
          <h2 className="text-xl font-semibold tracking-tight">Printer</h2>
        </header>
        <div className="card p-12 text-center">
          <AlertTriangle className="mx-auto mb-3 text-zinc-500" size={32} />
          <p className="text-zinc-400">Printer is not connected or not enabled.</p>
          <p className="text-xs text-zinc-600 mt-2">Enable it in config and ensure Moonraker is running on the edge server.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold tracking-tight">Printer</h2>
          <StateBadge state={state} />
        </div>
      </header>

      {/* Temperature Cards */}
      <div className="card p-4 mb-4">
        <div className="flex flex-wrap gap-6">
          <TempGauge label="Hotend" current={hotend} target={hotendTarget} max={265} />
          <TempGauge label="Bed" current={bed} target={bedTarget} max={130} />
        </div>
      </div>

      {/* Print Progress */}
      {(isPrinting || isPaused || filename) && (
        <div className="card p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium truncate mr-4">{filename || "No file"}</span>
            <span className="text-sm font-mono text-zinc-400">
              {(progress * 100).toFixed(1)}%
            </span>
          </div>
          <div className="h-2 rounded-full bg-surface-0 overflow-hidden mb-2">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-1000"
              style={{ width: `${Math.min(progress * 100, 100)}%` }}
            />
          </div>
          <div className="flex items-center gap-4 text-xs text-zinc-500">
            <span>Elapsed: {formatDuration(printDuration)}</span>
            {eta != null && <span>ETA: {formatDuration(eta)}</span>}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="card p-4 mb-4">
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => sendGcode("G28")} disabled={isPrinting}>
            <Home size={14} /> Home
          </button>
          {isPrinting && (
            <button className="btn" onClick={() => sendGcode("PAUSE")}>
              <Pause size={14} /> Pause
            </button>
          )}
          {isPaused && (
            <button className="btn btn-primary" onClick={() => sendGcode("RESUME")}>
              <Play size={14} /> Resume
            </button>
          )}
          {(isPrinting || isPaused) && (
            <button className="btn border-rose-700/50 text-rose-300 hover:bg-rose-950/30" onClick={() => sendGcode("CANCEL_PRINT")}>
              <Square size={14} /> Cancel
            </button>
          )}

          <div className="border-l border-border mx-1" />

          {PRESETS.map((p) => (
            <button
              key={p.label}
              className="btn text-xs"
              onClick={() => sendGcode(`M104 S${p.hotend}\nM140 S${p.bed}`)}
              title={`Hotend ${p.hotend}° / Bed ${p.bed}°`}
            >
              <Thermometer size={12} /> {p.label}
            </button>
          ))}

          <button className="btn text-xs" onClick={() => sendGcode("M104 S0\nM140 S0")}>
            Cooldown
          </button>

          <div className="border-l border-border mx-1" />

          <button
            className="btn border-rose-700/50 bg-rose-950/20 text-rose-300 hover:bg-rose-700/30"
            onClick={() => { if (confirm("Emergency stop the printer?")) estop.mutate(); }}
          >
            <AlertTriangle size={14} /> E-Stop
          </button>
        </div>
      </div>

      {/* Embedded Fluidd */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <span className="text-sm font-medium">Fluidd Control Panel</span>
          <button className="btn text-xs" onClick={() => setFluiddExpanded(!fluiddExpanded)}>
            {fluiddExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            {fluiddExpanded ? "Collapse" : "Expand"}
          </button>
        </div>
        <iframe
          src="https://printer.skylarenns.com/"
          className={`w-full border-0 transition-all duration-300 ${fluiddExpanded ? "h-[85vh]" : "h-[500px]"}`}
          title="Fluidd"
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </div>
  );
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}
