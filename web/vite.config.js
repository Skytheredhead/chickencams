import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:7979",
      "/ws": { target: "ws://localhost:7979", ws: true }
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
