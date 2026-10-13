import { withDocs } from "lgtmd/playwright";
import { test as applicationTest, expect } from "./application-test.ts";

const test = withDocs(applicationTest);

test("Find records by name", async ({ page, workspace, doc }, testInfo) => {
  doc.page({ id: "filter-records", title: "Find a record" });
  doc.md`
    Search when you know part of a record's name. This example starts with
    three sample records.
  `;

  await page.goto(workspace.url);
  const search = page.getByRole("searchbox", { name: "Search records" });
  const results = page.getByRole("list", { name: "Records" });
  await expect(results.getByRole("listitem")).toHaveText([
    "Alpha contract",
    "Alpha renewal",
    "Beta proposal",
  ]);

  await search.fill("Alpha");
  await expect(results.getByRole("listitem")).toHaveText([
    "Alpha contract",
    "Alpha renewal",
  ]);

  const screenshot = doc.assets.image(
    "matching-records",
    await results.screenshot({
      path: testInfo.outputPath("matching-records.png"),
    }),
    {
      producer: "playwright/chromium",
      profile: `playwright-1.64.0-${process.platform}-${process.arch}-800x600-cpu-full-raster`,
    },
  );
  const explanation = doc.md`
    Enter **Alpha** in **Search records**. The list now contains only the two
    records whose names include that text.

    ${screenshot.embed("Alpha contract and Alpha renewal in the filtered list")}

    Clear the search field to see the other records again.
  `;

  await search.fill("");
  await expect(results.getByRole("listitem")).toHaveText([
    "Alpha contract",
    "Alpha renewal",
    "Beta proposal",
  ]);

  doc.noteOn(explanation)`
    ${workspace.conditions}
    The existing project fixture owns preparation and cleanup. These native
    Playwright assertions verify filtering and clearing the displayed results;
    they do not verify a production backend. They remain host test outcomes,
    without manufactured named SDK checks.
  `;
});
