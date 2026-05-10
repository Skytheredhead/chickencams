import { WebSocket } from "ws";

export function startPrinterMonitor({ config, hub }) {
  if (!config.printer?.enabled || !config.printer?.moonrakerUrl) return () => {};

  const moonrakerUrl = config.printer.moonrakerUrl.replace(/^http/, "ws");
  let ws = null;
  let backoff = 2000;
  let stopped = false;
  let rpcId = 1;
  let lastState = null;

  function connect() {
    if (stopped) return;
    try {
      ws = new WebSocket(`${moonrakerUrl}/websocket`);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.on("open", () => {
      backoff = 2000;
      console.log("[printer-monitor] connected to Moonraker");
      const id = rpcId++;
      ws.send(JSON.stringify({
        jsonrpc: "2.0",
        method: "printer.objects.subscribe",
        params: {
          objects: {
            extruder: ["temperature", "target", "power"],
            heater_bed: ["temperature", "target", "power"],
            print_stats: ["state", "filename", "total_duration", "print_duration", "filament_used", "message"],
            display_status: ["progress", "message"],
            toolhead: ["homed_axes", "position"],
            virtual_sdcard: ["progress", "file_position", "file_size"]
          }
        },
        id
      }));
    });

    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.method === "notify_status_update") {
        const status = msg.params?.[0];
        if (status) {
          lastState = { ...lastState, ...flattenStatus(status), updatedMs: Date.now() };
          hub.broadcastToClients("printer-status", lastState);
        }
      } else if (msg.result?.status) {
        lastState = { ...flattenStatus(msg.result.status), updatedMs: Date.now() };
        hub.broadcastToClients("printer-status", lastState);
      }
    });

    ws.on("close", () => {
      if (!stopped) scheduleReconnect();
    });

    ws.on("error", () => {
      try { ws.close(); } catch {}
    });
  }

  function scheduleReconnect() {
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 1.5, 30000);
  }

  function flattenStatus(status) {
    const out = {};
    if (status.extruder) {
      out.hotend = status.extruder.temperature;
      out.hotendTarget = status.extruder.target;
    }
    if (status.heater_bed) {
      out.bed = status.heater_bed.temperature;
      out.bedTarget = status.heater_bed.target;
    }
    if (status.print_stats) {
      out.state = status.print_stats.state;
      out.filename = status.print_stats.filename;
      out.totalDuration = status.print_stats.total_duration;
      out.printDuration = status.print_stats.print_duration;
    }
    if (status.display_status) {
      out.progress = status.display_status.progress;
      out.message = status.display_status.message;
    }
    if (status.virtual_sdcard) {
      out.progress = status.virtual_sdcard.progress;
    }
    return out;
  }

  connect();

  return () => {
    stopped = true;
    try { ws?.close(); } catch {}
  };
}

export async function proxyMoonrakerRequest(config, reqPath, method, body) {
  const url = `${config.printer.moonrakerUrl}${reqPath}`;
  const opts = { method, headers: {} };
  if (body && method !== "GET") {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const resp = await fetch(url, opts);
  const contentType = resp.headers.get("content-type") || "";
  if (contentType.includes("json")) return { status: resp.status, json: await resp.json() };
  return { status: resp.status, text: await resp.text() };
}
