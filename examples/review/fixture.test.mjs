import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exampleGit, exampleEnvironment } from "./fixture.mjs";
import { chromium } from "@playwright/test";
import { captureWebp } from "./capture.mjs";

test("demo Git ignores caller repository/index/config redirects and owns version B", async () => {
  const root = await mkdtemp(join(tmpdir(), "lgtmd-demo-isolation-"));
  const outside = join(root, "unrelated"),
    fixture = join(root, "fixture");
  const overrides = {
    GIT_DIR: join(outside, ".git"),
    GIT_WORK_TREE: outside,
    GIT_INDEX_FILE: join(outside, ".git/index"),
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.bare",
    GIT_CONFIG_VALUE_0: "true",
    REVIEW_VERSION: "A",
  };
  const before = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]]),
  );
  try {
    await mkdir(outside);
    await mkdir(fixture);
    await exampleGit(outside)(
      "init",
      "--initial-branch=main",
      "--object-format=sha1",
    );
    await writeFile(
      join(outside, "sentinel"),
      "Do not change this repository.\n",
    );
    await exampleGit(outside)("add", "sentinel");
    await exampleGit(outside)("commit", "-m", "External history");
    const originalHead = (await exampleGit(outside)("rev-parse", "HEAD"))
      .stdout;
    const originalIndex = await readFile(join(outside, ".git/index"));
    Object.assign(process.env, overrides);
    await exampleGit(fixture)(
      "init",
      "--initial-branch=main",
      "--object-format=sha1",
    );
    await writeFile(join(fixture, "example"), "Controlled content.\n");
    await exampleGit(fixture)("add", "example");
    await exampleGit(fixture)("commit", "-m", "Fixture history");
    assert.equal(
      (await exampleGit(outside)("rev-parse", "HEAD")).stdout,
      originalHead,
    );
    assert.deepEqual(
      await readFile(join(outside, ".git/index")),
      originalIndex,
    );
    assert.equal(
      (await exampleGit(outside)("status", "--porcelain")).stdout,
      "",
    );
    assert.match(
      (await exampleGit(fixture)("show", "HEAD:example")).stdout,
      /Controlled content/,
    );
    assert.equal(exampleEnvironment().REVIEW_VERSION, "B");
    assert.equal(
      process.env.GIT_DIR,
      overrides.GIT_DIR,
      "Preparing a child environment does not mutate the caller",
    );
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("lossless WebP captures preserve PNG pixels exactly and repeatably", async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-gpu-rasterization", "--disable-partial-raster"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 320, height: 200 },
      deviceScaleFactor: 1,
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    await page.setContent(`
      <style>
        body { margin: 0; }
        main {
          width: 240px; height: 120px; box-sizing: border-box;
          padding: 16px; background: #f3f5fa; color: #172436;
          font: 18px/24px sans-serif; border: 1px solid #789abc;
        }
        .swatch {
          width: 80px; height: 30px; border-radius: 7px;
          background: rgba(19, 87, 231, 0.43);
        }
      </style>
      <main>Ready for review<div class="swatch"></div></main>
    `);
    await page.evaluate(() => document.fonts.ready);
    const target = page.getByRole("main");
    const png = await target.screenshot({ type: "png" });
    const first = await captureWebp(target);
    const second = await captureWebp(target);
    assert.equal(first.toString("ascii", 0, 4), "RIFF");
    assert.equal(first.toString("ascii", 8, 12), "WEBP");
    assert.deepEqual(
      second,
      first,
      "Repeated captures must produce identical evidence bytes",
    );
    const decoded = await page.evaluate(
      async ({ png, webp }) => {
        async function pixels(bytes, type) {
          const bitmap = await createImageBitmap(
            new Blob([new Uint8Array(bytes)], { type }),
          );
          try {
            const canvas = document.createElement("canvas");
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const context = canvas.getContext("2d");
            context.drawImage(bitmap, 0, 0);
            return {
              width: bitmap.width,
              height: bitmap.height,
              pixels: Array.from(
                context.getImageData(0, 0, bitmap.width, bitmap.height).data,
              ),
            };
          } finally {
            bitmap.close();
          }
        }
        return {
          png: await pixels(png, "image/png"),
          webp: await pixels(webp, "image/webp"),
        };
      },
      { png: Array.from(png), webp: Array.from(first) },
    );
    assert.equal(decoded.webp.width, 240);
    assert.equal(decoded.webp.height, 120);
    assert.deepEqual(
      decoded.webp,
      decoded.png,
      "Lossless WebP must preserve every decoded PNG RGBA byte without diff noise",
    );
  } finally {
    await browser.close();
  }
});
