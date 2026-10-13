import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(import.meta.dirname, "../lgtmd/viewer"),
    emptyOutDir: true,
    manifest: "manifest.json",
    sourcemap: false,
  },
});
