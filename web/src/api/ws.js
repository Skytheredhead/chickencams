import { useLiveStore } from "../store.js";
import { wsUrl } from "./base.js";

export function connectClientWs() {
  let ws = null;
  let backoff = 1000;
  let stopped = false;

  function open() {
    if (stopped) return;
    ws = new WebSocket(wsUrl("/ws/client"));
    ws.addEventListener("open", () => { backoff = 1000; });
    ws.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      const store = useLiveStore.getState();
      if (msg.type === "snapshot") store.setEdges(msg.edges || []);
      else if (msg.type === "edge-online") store.upsertEdge(msg.edge);
      else if (msg.type === "edge-offline") store.removeEdge(msg.edgeId);
      else if (msg.type === "telemetry") {
        store.upsertEdge({ id: msg.edgeId, telemetry: msg.payload });
      } else if (msg.type === "edge-event" && msg.event?.kind === "motion") {
        store.flagMotion(msg.event.cameraId);
      }
    });
    ws.addEventListener("close", () => {
      if (stopped) return;
      setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, 15000);
    });
    ws.addEventListener("error", () => { try { ws.close(); } catch {} });
  }

  open();
  return () => { stopped = true; try { ws?.close(); } catch {} };
}
