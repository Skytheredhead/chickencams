import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiUrl } from "./base.js";

async function getJson(url) {
  const r = await fetch(apiUrl(url));
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function postJson(url, body) {
  const r = await fetch(apiUrl(url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

export function useCameras() {
  return useQuery({
    queryKey: ["cameras"],
    queryFn: () => getJson("/api/cameras"),
    refetchInterval: 5000
  });
}

export function useEdges() {
  return useQuery({
    queryKey: ["edges"],
    queryFn: () => getJson("/api/edges"),
    refetchInterval: 5000
  });
}

export function useConfig() {
  return useQuery({ queryKey: ["config"], queryFn: () => getJson("/api/config") });
}

export function useSaveConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config) => postJson("/api/config", config),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["config"] })
  });
}

export function useActivity() {
  return useQuery({
    queryKey: ["activity"],
    queryFn: () => getJson("/api/activity?limit=50"),
    refetchInterval: 10000
  });
}

export function usePrinterStatus() {
  return useQuery({
    queryKey: ["printer-status"],
    queryFn: () => getJson("/api/printer/status"),
    refetchInterval: 3000,
    retry: false
  });
}

export function usePrinterInfo() {
  return useQuery({
    queryKey: ["printer-info"],
    queryFn: () => getJson("/api/printer/info"),
    refetchInterval: 10000,
    retry: false
  });
}

export function usePrinterGcode() {
  return useMutation({
    mutationFn: (script) => postJson("/api/printer/gcode", { script })
  });
}

export function usePrinterEmergencyStop() {
  return useMutation({
    mutationFn: () => postJson("/api/printer/emergency-stop", {})
  });
}

export function useRecordings(cameraId, from, to) {
  return useQuery({
    queryKey: ["recordings", cameraId, from, to],
    queryFn: () => getJson(`/api/recordings/${cameraId}?from=${from}&to=${to}`),
    enabled: !!cameraId && Number.isFinite(from) && Number.isFinite(to)
  });
}

export function useCoverage(cameraId, from, to) {
  return useQuery({
    queryKey: ["coverage", cameraId, from, to],
    queryFn: () => getJson(`/api/recordings/${cameraId}/coverage?from=${from}&to=${to}&buckets=240`),
    enabled: !!cameraId && Number.isFinite(from) && Number.isFinite(to)
  });
}
