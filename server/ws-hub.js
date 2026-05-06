import { WebSocketServer } from "ws";

export function createWsHub({ httpServer, onEdgeMessage }) {
  const edges = new Map();   // id -> { ws, hostname, ip, addresses, lastSeenMs, telemetry }
  const clients = new Set(); // browser ws set

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/ws/edge") {
      wss.handleUpgrade(req, socket, head, (ws) => handleEdge(ws));
    } else if (url.pathname === "/ws/client") {
      wss.handleUpgrade(req, socket, head, (ws) => handleClient(ws));
    } else {
      socket.destroy();
    }
  });

  function send(ws, type, data = {}) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, ...data }));
  }

  function broadcastToClients(type, data = {}) {
    const payload = JSON.stringify({ type, ...data });
    for (const c of clients) {
      if (c.readyState === c.OPEN) c.send(payload);
    }
  }

  function handleEdge(ws) {
    let edgeId = null;
    let aliveTimer = null;

    const ping = () => {
      if (ws.readyState !== ws.OPEN) return;
      try { ws.ping(); } catch {}
    };
    aliveTimer = setInterval(ping, 10000);
    ws.on("pong", () => {
      if (edgeId && edges.has(edgeId)) edges.get(edgeId).lastSeenMs = Date.now();
    });

    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === "hello") {
        edgeId = msg.id || msg.hostname || `edge-${Date.now()}`;
        edges.set(edgeId, {
          ws,
          id: edgeId,
          hostname: msg.hostname || edgeId,
          ip: msg.ip || "",
          addresses: Array.isArray(msg.addresses) ? msg.addresses : [],
          cameras: Array.isArray(msg.cameras) ? msg.cameras : [],
          lastSeenMs: Date.now(),
          telemetry: null
        });
        broadcastToClients("edge-online", { edge: publicEdge(edges.get(edgeId)) });
      } else if (edgeId && edges.has(edgeId)) {
        const edge = edges.get(edgeId);
        edge.lastSeenMs = Date.now();
        if (msg.type === "telemetry") {
          edge.telemetry = msg.payload ?? null;
          broadcastToClients("telemetry", { edgeId, payload: edge.telemetry });
        } else if (msg.type === "log") {
          broadcastToClients("edge-log", { edgeId, level: msg.level, msg: msg.msg });
        } else if (msg.type === "event") {
          broadcastToClients("edge-event", { edgeId, event: msg.event });
        }
        onEdgeMessage?.(edge, msg);
      }
    });

    ws.on("close", () => {
      clearInterval(aliveTimer);
      if (edgeId) {
        edges.delete(edgeId);
        broadcastToClients("edge-offline", { edgeId });
      }
    });
  }

  function handleClient(ws) {
    clients.add(ws);
    ws.send(JSON.stringify({
      type: "snapshot",
      edges: Array.from(edges.values()).map(publicEdge)
    }));
    ws.on("close", () => clients.delete(ws));
    ws.on("message", () => {}); // clients are read-only for now
  }

  function publicEdge(edge) {
    return {
      id: edge.id,
      hostname: edge.hostname,
      ip: edge.ip,
      addresses: edge.addresses,
      cameras: edge.cameras,
      lastSeenMs: edge.lastSeenMs,
      telemetry: edge.telemetry
    };
  }

  function listEdges() {
    return Array.from(edges.values()).map(publicEdge);
  }

  function sendCommand(edgeId, type, data = {}) {
    const edge = edges.get(edgeId);
    if (!edge) return false;
    send(edge.ws, type, data);
    return true;
  }

  setInterval(() => {
    const stale = Date.now() - 25000;
    for (const [id, edge] of edges) {
      if (edge.lastSeenMs < stale) {
        try { edge.ws.terminate(); } catch {}
        edges.delete(id);
        broadcastToClients("edge-offline", { edgeId: id });
      }
    }
  }, 5000).unref?.();

  return { listEdges, sendCommand, broadcastToClients };
}
