import { test as base, expect } from "@playwright/test";
import { withDocs } from "lgtmd/playwright";
import { captureWebp, webpProfile } from "../capture.mjs";
const test = withDocs(base);
test("Save a project", async ({ page, doc }) => {
  const version = process.env.REVIEW_VERSION === "A" ? "A" : "B";
  doc.page({ id: "project", title: "Save a project" });
  await page.goto(`${process.env.REVIEW_APP_URL}?version=${version}`);
  await page.getByRole("button", { name: "Save project" }).click();
  await expect(
    page.getByRole("button", { name: "Saved", exact: true }),
  ).toBeVisible();
  const status = version === "A" ? "In progress" : "Ready for review";
  await expect(page.getByText(status, { exact: true })).toBeVisible();
  const image = doc.assets.image(
    "project-card",
    await captureWebp(page.getByRole("main")),
    {
      mediaType: "image/webp",
      producer: "playwright/chromium+sharp",
      profile: `playwright-1.64.0-${process.platform}-${process.arch}-600x360-cpu-full-raster-${webpProfile}`,
    },
  );
  const passage = doc.md`Choose **Save project** to retain your changes. The project is now **${status}**.

${image.embed("The saved project and its current review status")}`;
  doc.noteOn(
    passage,
  )`Public example note: the application fixture owns its state. The browser assertions verify saving and the displayed status.`;
});
