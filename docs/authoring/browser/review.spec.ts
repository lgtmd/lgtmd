import { test as base, expect } from "@playwright/test";
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
  await page.getByRole("checkbox", { name: "View diff" }).check();
  await page.getByRole("tab", { name: "Previous", exact: true }).click();
  await expect(page.getByTestId("review-panel")).toContainText("In progress");
  await page.getByRole("tab", { name: "Current", exact: true }).click();
  await expect(page.getByTestId("review-panel")).toContainText(
    "Ready for review",
  );
  await page
    .getByRole("button", { name: "Before / After", exact: true })
    .click();
  const comparison = page.getByTestId("image-comparison");
  await expect(comparison.getByRole("img")).toHaveCount(2);
  await comparison
    .getByRole("img")
    .evaluateAll((images) =>
      Promise.all(images.map((image) => (image as HTMLImageElement).decode())),
    );
  const pair = doc.assets.image("before-after", await captureWebp(comparison), {
    mediaType: "image/webp",
    producer: "playwright/chromium+sharp",
    profile: `playwright-1.64.0-${process.platform}-${process.arch}-1200x1000-cpu-full-raster-${webpProfile}`,
  });
  await page.getByRole("button", { name: "Regions", exact: true }).click();
  await expect(comparison.getByTestId("regions-result")).toContainText(
    /changed region/i,
  );
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

**Before / After** displays the retained captures side by side. This real example changes the project status from **In progress** to **Ready for review** in both its explanation and screenshot.

${pair.embed("Before and after captures of a project's review status")}

Choose **Regions** to outline groups of changed pixels on compatible static PNG or WebP screenshots.

${regions.embed("Changed regions outlined on the current project screenshot")}

Boxes group changed pixels; they do not recognize semantic controls. Different dimensions or capture profiles, animations, unsupported formats and large images retain the side-by-side view with an explanation. Visual modes never change the exact artifact check result.

## Keep history honest

A revision with no recorded snapshot is reported as unavailable. The site does not recreate historical evidence by running old code. Missing resources and incompatible snapshots remain visible errors; current docs stay readable.

Start with **Reader** for user-facing content. An explicit Contributor session can show attached internal notes, and needs actual Contributor snapshots on both sides to review them.

## Try the demonstration

In a prepared lgtmd checkout, run **just docs-demo**. It starts this real comparison against a disposable, clearly labeled example history. Its sample notes are intentionally public. The example never creates commits in your project.

This page is itself authored with lgtmd. Its browser scenario asserts the real revision and changes, operates the comparison controls, then captures these images. The final guide is not an input to the example it explains.`;
});
