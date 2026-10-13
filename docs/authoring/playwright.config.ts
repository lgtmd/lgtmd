import { defineConfig } from "@playwright/test";
import { docsReporter } from "lgtmd/playwright";
export default defineConfig({
  testDir: "./browser",
  outputDir: "./.cache/playwright",
  workers: 1,
  retries: 0,
  timeout: 60000,
  reporter: docsReporter(),
  use: {
    browserName: "chromium",
    viewport: { width: 1200, height: 1000 },
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    reducedMotion: "reduce",
    launchOptions: {
      args: ["--disable-gpu-rasterization", "--disable-partial-raster"],
    },
  },
  projects: [{ name: "chromium" }],
});
