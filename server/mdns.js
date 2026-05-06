import Bonjour from "bonjour-service";

const SERVICE_TYPE = "chickencams-central";

export function advertiseCentral({ port, version = "2" }) {
  const bonjour = new Bonjour();
  const service = bonjour.publish({
    name: "Chickencams Central",
    type: SERVICE_TYPE,
    port,
    txt: { version }
  });
  service.on?.("error", (err) => console.warn("[mdns] publish error:", err.message));
  console.log(`[mdns] advertising _${SERVICE_TYPE}._tcp on :${port}`);
  return () => {
    try { service.stop(); } catch {}
    try { bonjour.destroy(); } catch {}
  };
}

export function discoverCentral({ timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    const bonjour = new Bonjour();
    const browser = bonjour.find({ type: SERVICE_TYPE });
    let resolved = false;

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      try { browser.stop(); } catch {}
      try { bonjour.destroy(); } catch {}
      resolve(result);
    };

    browser.on("up", (service) => {
      const address = (service.addresses || []).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) || service.host;
      finish({ host: address, port: service.port, txt: service.txt || {} });
    });

    setTimeout(() => finish(null), timeoutMs);
  });
}
