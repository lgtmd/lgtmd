import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxy = {
  "/api": process.env.RECORDS_API_URL ?? "http://127.0.0.1:4174",
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    // Playwright traces contain HTML snapshots. Writing review artifacts must
    // not reload the developer's open application.
    watch: { ignored: ["**/.cache/**"] },
    proxy: apiProxy,
  },
  preview: {
    host: "127.0.0.1",
    port: 4175,
    strictPort: true,
    proxy: apiProxy,
  },
});
