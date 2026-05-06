function normalizeBaseUrl(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export function apiUrl(path) {
  const base = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
  if (!base) return path; // rely on same-origin or Vercel rewrites
  if (!path.startsWith("/")) return `${base}/${path}`;
  return `${base}${path}`;
}

export function wsUrl(path) {
  const base = normalizeBaseUrl(import.meta.env.VITE_WS_BASE_URL);
  if (base) {
    if (!path.startsWith("/")) return `${base}/${path}`;
    return `${base}${path}`;
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}${path.startsWith("/") ? path : `/${path}`}`;
}

