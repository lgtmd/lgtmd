import { test as base, expect } from "@playwright/test";
import { withDocs } from "lgtmd/playwright";
import { captureWebp, webpProfile } from "../capture.mjs";
const test = withDocs(base);
test("Save a project", async ({ page, doc }) => {
  const version = process.env.REVIEW_VERSION === "A" ? "A" : "B";
  const playground = process.env.REVIEW_PLAYGROUND === "1";
  doc.page({
    id: "project",
    title: playground ? "Image comparison playground" : "Save a project",
  });
  await page.goto(
    `${process.env.REVIEW_APP_URL}?version=${version}${playground ? "&playground" : ""}`,
  );
  await page.getByRole("button", { name: "Save project" }).click();
  await expect(
    page.getByRole("button", { name: "Saved", exact: true }),
  ).toBeVisible();
  const status = version === "A" ? "In progress" : "Ready for review";
  await expect(page.getByText(status, { exact: true })).toBeVisible();
  if (playground) {
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      version === "A" ? "Website refresh" : "Ready to launch",
    );
    doc.md`This local playground intentionally changes the card background, heading, status and button color. Turn on **View diff**, then try **Slider**, **Side by side** and **Annotations** on the image comparison widget. These captures are demonstration fixtures, not product evidence.`;
  }
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
