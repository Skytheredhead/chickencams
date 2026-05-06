import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function postJson(url, body) {
  const r = await fetch(url, {
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
