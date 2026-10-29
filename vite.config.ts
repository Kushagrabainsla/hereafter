import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  base: mode === "pages" ? "/hereafter/" : "/",
  // Keep Rapier's WASM glue in one module graph during local development.
  optimizeDeps: { exclude: ["@dimforge/rapier3d"] },
}));
