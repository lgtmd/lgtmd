import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { docsReporter } from "lgtmd/playwright";

export default defineConfig({
  testDir: "./browser",
  outputDir: "./.cache/playwright",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15_000,
  reporter: docsReporter(),
  use: {
    baseURL: "http://127.0.0.1:4183",
    browserName: "chromium",
    viewport: { width: 800, height: 600 },
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium" }],
  webServer: [
    {
      command: "npm run dev:api -- --port 4184",
      cwd: fileURLToPath(new URL(".", import.meta.url)),
      url: "http://127.0.0.1:4184/api/health",
      reuseExistingServer: false,
      timeout: 10_000,
    },
    {
      command: "npm run build && npm run preview -- --port 4183",
      env: { RECORDS_API_URL: "http://127.0.0.1:4184" },
      cwd: fileURLToPath(new URL(".", import.meta.url)),
      url: "http://127.0.0.1:4183",
      reuseExistingServer: false,
      timeout: 10_000,
    },
  ],
});
