import { defineConfig } from "@playwright/test";
import { docsReporter } from "lgtmd/playwright";

export default defineConfig({
  testDir: "./browser",
  testMatch: ["guides.spec.ts", "assistant.spec.ts"],
  outputDir: "./.cache/playwright",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  reporter: docsReporter(),
  projects: [{ name: "chromium" }],
  use: {
    baseURL: process.env.STAY_APP_URL,
    browserName: "chromium",
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    reducedMotion: "reduce",
    launchOptions: {
      args: ["--disable-gpu-rasterization", "--disable-partial-raster"],
    },
    trace: "retain-on-failure",
  },
});
