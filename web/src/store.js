import { create } from "zustand";

export const useLiveStore = create((set) => ({
  title: "Chickencams",
  edges: [],
  recentMotion: {},
  printer: null,
  setTitle: (title) => set({ title }),
  setPrinter: (printer) => set({ printer }),
  setEdges: (edges) => set({ edges }),
  upsertEdge: (edge) => set((s) => {
    const idx = s.edges.findIndex((e) => e.id === edge.id);
    const next = idx === -1 ? [...s.edges, edge] : s.edges.map((e, i) => (i === idx ? { ...e, ...edge } : e));
    return { edges: next };
  }),
  removeEdge: (edgeId) => set((s) => ({ edges: s.edges.filter((e) => e.id !== edgeId) })),
  flagMotion: (cameraId) => set((s) => ({ recentMotion: { ...s.recentMotion, [cameraId]: Date.now() } }))
}));
