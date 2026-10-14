import { chromium } from "@playwright/test";
import sharp from "sharp";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { storeSite } from "lgtmd";
import { capturePage } from "./capture-page.mjs";
import { authorShowcase } from "./author.mjs";
const command = process.argv[2];
if (!["--record", "--check"].includes(command))
  throw new Error(
    "Use --check for exact fresh verification or --record to explicitly record reviewed fixtures.",
  );
const browser = await chromium.launch({ headless: true });
try {
  const images = {},
    pixels = {};
  for (const [name, options, width] of [
    ["workspace-original", {}, 1280],
    ["workspace-revised", { revised: true }, 1280],
    ["pixels-revised", { revised: true, subtle: true }, 1280],
    ["narrow", {}, 1100],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height: 800 },
      deviceScaleFactor: 1,
      locale: "en-US",
      timezoneId: "UTC",
      reducedMotion: "reduce",
      colorScheme: "light",
    });
    await page.setContent(capturePage(options));
    const capture = () => page.screenshot({ fullPage: true, type: "png" });
    const first = await capture(),
      second = await capture();
    assert.deepEqual(first, second, `${name}: repeated full-page capture`);
    images[name] = await sharp(first)
      .webp({ lossless: true, effort: 6 })
      .toBuffer();
    const original = await sharp(first)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const retained = await sharp(images[name])
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(original.info.width, width);
    assert.ok(original.info.height >= 800);
    console.log(name, original.info.width, original.info.height);
    assert.deepEqual(
      retained.data,
      original.data,
      `${name}: lossless pixel preservation`,
    );
    pixels[name] = original.data;
    await page.close();
  }
  let changed = 0;
  for (let i = 0; i < pixels["workspace-original"].length; i += 4)
    if (
      !pixels["workspace-original"]
        .subarray(i, i + 4)
        .equals(pixels["pixels-revised"].subarray(i, i + 4))
    )
      changed++;
  assert.equal(changed, 4, "Subtle fixture must change exactly four pixels");
  for (const version of ["original", "revised"]) {
    const compiled = await authorShowcase(version, images);
    for (const audience of ["reader", "contributor"]) {
      await storeSite(
        command === "--record" ? "update" : "check",
        fileURLToPath(
          new URL(`./snapshots/${version}/${audience}`, import.meta.url),
        ),
        compiled[audience].files,
      );
    }
  }
  console.log(
    `Showcase ${command}: two audiences, full-page captures, lossless pixels, repeatability, and exactly ${changed} changed pixels verified.`,
  );
} finally {
  await browser.close();
}
