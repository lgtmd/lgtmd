import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { license: { fileName: "assets/licenses.txt" } },
  server: {
    host: "127.0.0.1",
    port: 4300,
    strictPort: true,
    watch: { ignored: ["**/.cache/**"] },
    proxy: { "/api": process.env.STAY_API_URL ?? "http://127.0.0.1:4191" },
  },
});
