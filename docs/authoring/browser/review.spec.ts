import { test as base, expect } from "@playwright/test";
import sharp from "sharp";
import { withDocs } from "lgtmd/playwright";
import { captureWebp, webpProfile } from "../../../examples/review/capture.mjs";
const test = withDocs(base);
test("Review the text and screenshot from a real Git revision", async ({
  page,
  doc,
}) => {
  doc.page({ id: "review-changes", title: "Review text and image changes" });
  await page.goto(process.env.LGTMD_DEMO_URL!);
  const stateUrl = await page.evaluate(
    () =>
      (window as unknown as { __LGTMD__: { dataUrl: string } }).__LGTMD__
        .dataUrl,
  );
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(new URL(stateUrl, page.url()).href)
          ).json()
        ).run.status,
    )
    .toBe("succeeded");
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(new URL(stateUrl, page.url()).href)
          ).json()
        ).baseline?.status,
    )
    .toBe("available");
  await expect
    .poll(async () =>
      Boolean(
        (
          await (
            await page.request.get(new URL(stateUrl, page.url()).href)
          ).json()
        ).comparison,
      ),
    )
    .toBe(true);
  const state = await (
    await page.request.get(new URL(stateUrl, page.url()).href)
  ).json();
  expect(state.baseline.revision).toBe(process.env.LGTMD_DEMO_BEFORE);
  expect(
    state.comparison.pages.find((item: { id: string }) => item.id === "project")
      .status,
  ).toBe("changed");
  expect(
    state.comparison.resources.find(
      (item: { id: string }) => item.id === "project-card",
    ).status,
  ).toBe("changed");
  const diffToggle = page.getByRole("checkbox", { name: "View diff" });
  // Review chrome and async image inspection must not move the reading surface.
  for (const viewport of [
    { width: 1200, height: 600 },
    { width: 390, height: 700 },
  ]) {
    await page.setViewportSize(viewport);
    const image = page.locator(".image-review-base");
    await image.evaluate((element) => (element as HTMLImageElement).decode());
    await image.scrollIntoViewIfNeeded();
    const geometry = () =>
      page.evaluate(() => ({
        scroll: scrollY,
        nodes: [
          ...document.querySelectorAll(
            ".prose > h1, .prose > p, .image-review-base",
          ),
        ].map((element) => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return { x, y, width, height };
        }),
      }));
    const before = await geometry();
    for (let toggle = 0; toggle < 2; toggle++) {
      await diffToggle.check();
      expect(await geometry()).toEqual(before);
      await expect(
        page.getByRole("slider", { name: "Image reveal: project-card" }),
      ).toBeVisible();
      expect(await geometry()).toEqual(before);
      await diffToggle.uncheck();
      expect(await geometry()).toEqual(before);
    }
  }
  await page.setViewportSize({ width: 1200, height: 1000 });
  await diffToggle.check();
  const tools = page.getByRole("button", {
    name: "Development tools",
    exact: true,
  });
  await expect(page.getByRole("main").getByRole("tablist")).toHaveCount(0);
  await tools.click();
  await expect(
    page.getByRole("region", { name: "Review revisions" }),
  ).toBeVisible();
  await expect(page.getByLabel("Compare against Git revision")).toHaveValue(
    "before",
  );
  await expect(
    page.getByRole("checkbox", { name: "Changed pages" }),
  ).toBeVisible();
  await page.getByLabel("Compare against Git revision").press("Escape");
  await expect(tools).toBeFocused();
  await expect(tools).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("checkbox", { name: "View diff" })).toBeChecked();
  await page.getByRole("tab", { name: "Previous", exact: true }).click();
  await expect(page.getByTestId("review-panel")).toContainText("In progress");
  await page.getByRole("tab", { name: "Current", exact: true }).click();
  await expect(page.getByTestId("review-panel")).toContainText(
    "Ready for review",
  );
  const comparison = page.getByTestId("image-comparison");
  const reveal = comparison.getByRole("slider", {
    name: "Image reveal: project-card",
  });
  await expect(reveal).toHaveValue("50");
  const sliderSurface = comparison.locator(".image-slider");
  await expect(
    page.getByRole("img", {
      name: "The saved project and its current review status",
    }),
  ).toHaveCount(0);
  await expect(
    page.locator(
      "p [data-testid='image-comparison'], a [data-testid='image-comparison']",
    ),
  ).toHaveCount(0);
  const originals = await Promise.all(
    ["Before", "After"].map(async (label) => {
      const source = await comparison
        .getByRole("img", { name: `${label}: project-card`, exact: true })
        .getAttribute("src");
      const bytes = await (await page.request.get(source!)).body();
      return sharp(bytes)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    }),
  );
  const width = originals[0].info.width;
  const height = originals[0].info.height;
  expect(originals[1].info.width).toBe(width);
  expect(originals[1].info.height).toBe(height);
  for (const original of originals) expect(original.info.channels).toBe(4);
  // Derive the exact count from this host's captures, independently of the worker.
  // Font rasterization can differ between supported capture environments.
  let expectedChangedPixels = 0;
  for (let offset = 0; offset < originals[0].data.length; offset += 4) {
    if (
      originals[0].data.readUInt32LE(offset) !==
      originals[1].data.readUInt32LE(offset)
    )
      expectedChangedPixels++;
  }
  expect(expectedChangedPixels).toBeGreaterThan(0);
  // Select an interior, flat-color patch that genuinely changes between A/B.
  // Text edges can be rasterized again at fractional CSS positions in a screenshot.
  let sample: { x: number; y: number } | undefined;
  for (let y = 8; y < height - 8 && !sample; y += 4) {
    for (let x = 8; x < width - 8 && !sample; x += 4) {
      const offset = (y * width + x) * 4;
      const colors = originals.map(({ data }) =>
        data.subarray(offset, offset + 4),
      );
      if (colors[0].equals(colors[1])) continue;
      const flat = originals.every(({ data }, side) => {
        for (let dy = -4; dy <= 4; dy++)
          for (let dx = -4; dx <= 4; dx++) {
            const at = ((y + dy) * width + x + dx) * 4;
            if (!data.subarray(at, at + 4).equals(colors[side])) return false;
          }
        return true;
      });
      if (flat) sample = { x, y };
    }
  }
  expect(sample, "The fixture must contain a solid changed area").toBeDefined();
  for (const [key, label, value, sourceIndex] of [
    ["Home", "After", "0", 1],
    ["End", "Before", "100", 0],
  ] as const) {
    await reveal.press(key);
    await expect(reveal).toHaveValue(value);
    const rendered = await sharp(await sliderSurface.screenshot())
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(rendered.info.width).toBe(width);
    const at = (sample!.y * width + sample!.x) * 4;
    expect(
      [...rendered.data.subarray(at, at + 4)],
      `${label} endpoint must reveal that capture's changed area`,
    ).toEqual([...originals[sourceIndex].data.subarray(at, at + 4)]);
  }
  const bounds = (await reveal.boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width * 0.25,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.75,
    bounds.y + bounds.height / 2,
    { steps: 8 },
  );
  await expect(comparison.locator(".image-comparison-header")).toBeHidden();
  await expect(comparison.locator(".slider-captions")).toHaveCSS(
    "opacity",
    "1",
  );
  await page.mouse.up();
  expect(Number(await reveal.inputValue())).toBeGreaterThan(65);
  expect(Number(await reveal.inputValue())).toBeLessThan(85);
  const position = await reveal.inputValue();
  const imageFootprint = await comparison.boundingBox();
  const controls = comparison.getByRole("button", {
    name: "Image comparison controls",
    exact: true,
  });
  const popover = comparison.locator(".image-controls-popover");
  await expect(popover).toBeHidden();
  // Tab from the slider reveals the compact trigger, and Escape restores focus.
  await reveal.press("Tab");
  await expect(controls).toBeFocused();
  await expect(controls).toHaveCSS("opacity", "1");
  await controls.press("Enter");
  await expect(popover).toBeVisible();
  await controls.press("Escape");
  await expect(popover).toBeHidden();
  await expect(controls).toBeFocused();
  await controls.click();
  await page
    .getByRole("checkbox", { name: "Annotations", exact: true })
    .check();
  await expect(comparison.getByTestId("regions-result")).toContainText(
    `${expectedChangedPixels.toLocaleString("en-US")} changed pixels`,
  );
  await expect(
    comparison.getByRole("img", { name: "Changed pixel regions" }),
  ).toHaveCount(1);
  await expect(reveal).toHaveValue(position);
  expect(await comparison.boundingBox()).toEqual(imageFootprint);
  await page.getByRole("button", { name: "Side by side", exact: true }).click();
  expect(await comparison.boundingBox()).toEqual(imageFootprint);
  await expect(
    comparison.getByRole("img", { name: "Changed pixel regions" }),
  ).toHaveCount(2);
  await page
    .getByRole("checkbox", { name: "Annotations", exact: true })
    .uncheck();
  await expect(comparison.getByRole("img")).toHaveCount(2);
  await comparison
    .getByRole("img")
    .evaluateAll((images) =>
      Promise.all(images.map((image) => (image as HTMLImageElement).decode())),
    );
  const strip = comparison.getByRole("region", {
    name: /^Side by side images/,
  });
  await expect
    .poll(() => strip.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  const stripSize = await strip.evaluate((element) => ({
    width: element.clientWidth,
    scrollWidth: element.scrollWidth,
    height: element.clientHeight,
  }));
  expect(stripSize.scrollWidth).toBeGreaterThan(stripSize.width * 1.9);
  for (const image of await strip.locator("img").all()) {
    const size = await image.boundingBox();
    expect(size!.height).toBeCloseTo(stripSize.height, 0);
    expect(size!.width).toBeGreaterThan(stripSize.width * 0.95);
  }
  await controls.press("Escape");
  await strip.focus();
  // Native horizontal scrolling remains keyboard accessible.
  await strip.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await strip.press("ArrowRight");
  await expect
    .poll(() => strip.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  await strip.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        let previous = element.scrollLeft;
        let stableFrames = 0;
        const settled = () => {
          stableFrames = element.scrollLeft === previous ? stableFrames + 1 : 0;
          previous = element.scrollLeft;
          if (stableFrames >= 10) resolve();
          else requestAnimationFrame(settled);
        };
        requestAnimationFrame(settled);
      }),
  );
  await strip.evaluate((element) => {
    element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2;
  });
  await page
    .getByRole("heading", { name: "Save a project", exact: true })
    .click();
  await expect(popover).toBeHidden();
  await page.mouse.move(0, 0);
  await expect(controls).toHaveCSS("opacity", "0");
  expect(await comparison.boundingBox()).toEqual(imageFootprint);
  // Scroll the comparison clear of the floating toolbar before retaining its pixels.
  await comparison.evaluate((element) =>
    element.scrollIntoView({ block: "start" }),
  );
  const pair = doc.assets.image("before-after", await captureWebp(comparison), {
    mediaType: "image/webp",
    producer: "playwright/chromium+sharp",
    profile: `playwright-1.64.0-${process.platform}-${process.arch}-1200x1000-cpu-full-raster-${webpProfile}`,
  });
  await controls.click();
  await page
    .getByRole("checkbox", { name: "Annotations", exact: true })
    .check();
  await expect(comparison.getByTestId("regions-result")).toContainText(
    /changed region/i,
  );
  await comparison.evaluate((element) =>
    element.scrollIntoView({ block: "start" }),
  );
  await controls.click();
  await controls.press("Tab");
  await page.mouse.move(0, 0);
  await expect(controls).toHaveCSS("opacity", "0");
  const regions = doc.assets.image(
    "changed-regions",
    await captureWebp(comparison),
    {
      mediaType: "image/webp",
      producer: "playwright/chromium+sharp",
      profile: `playwright-1.64.0-${process.platform}-${process.arch}-1200x1000-cpu-full-raster-${webpProfile}`,
    },
  );
  doc.md`Choose **View diff** to compare your current completed guide with its recorded version in Git. By default the baseline is the exact snapshot at **HEAD**. Select another revision to inspect an earlier result.

The site shows the resolved revision and current candidate. Selecting a version does not check out old code, run your app, or accept a baseline.

## Read both versions

Use **Previous** and **Current** to read the rendered guide. Changed-page navigation identifies additions, removals and changes. This first version compares whole pages; it does not infer paragraph identity or promise inline word highlighting.

## Compare the screenshots

Open the small controls button in the image corner to choose **Slider** or **Side by side**. Slider overlays the aligned captures: drag the divider to reveal Before and After, or focus it and use the arrow keys, Home and End. Side by side preserves the frame height and each capture’s proportions in a horizontal strip. Scroll sideways to inspect either image without shrinking it into a narrow column. This real example changes the project status from **In progress** to **Ready for review** in both its explanation and screenshot.

${pair.embed("Before and after captures of a project's review status")}

Turn **Annotations** on independently to outline groups of changed pixels in either view. Turn it off to inspect the images without the marks. The boxes use compatible static PNG or WebP screenshots. Open **Details** for capture profiles, changed-pixel counts and any alignment limitations. Controls overlay the image so toggling review does not add header or footer rows to the document.

${regions.embed("Changed regions outlined on the current project screenshot")}

Boxes group changed pixels; they do not recognize semantic controls. Different dimensions or capture profiles, animations, unsupported formats and large images use the side-by-side view with an explanation when alignment or annotations are requested. Visual modes never change the exact artifact check result.

## Keep history honest

A revision with no recorded snapshot is reported as unavailable. The site does not recreate historical evidence by running old code. Missing resources and incompatible snapshots remain visible errors; current docs stay readable.

Start with **Reader** for user-facing content. An explicit Contributor session can show attached internal notes, and needs actual Contributor snapshots on both sides to review them.

## Try the demonstration

In a prepared lgtmd checkout, run **just docs-demo**. It starts this real comparison against a disposable, clearly labeled example history. Its sample notes are intentionally public. The example never creates commits in your project.

This page is itself authored with lgtmd. Its browser scenario asserts the real revision and changes, operates the comparison controls, then captures these images. The final guide is not an input to the example it explains.`;
});
