import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { startShowcase } from "./demo.mjs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
const browser = await chromium.launch({ headless: true });
try {
  for (const [audience, basePath] of [
    ["contributor", "/"],
    ["reader", "/showcase/"],
  ]) {
    const oldPath = process.env.PATH;
    let demo;
    try {
      process.env.PATH = "";
      demo = await startShowcase({
        audience,
        basePath,
        environment: { ...process.env },
      });
    } finally {
      process.env.PATH = oldPath;
    }
    const page = await browser.newPage({
      viewport: { width: 1280, height: 1000 },
      reducedMotion: "reduce",
    });
    const requests = [],
      errors = [];
    page.on("request", (request) => requests.push(request.url()));
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      const state = demo.state;
      assert.equal(
        state.comparison.pages.find((p) => p.id === "unchanged").status,
        "unchanged",
      );
      assert.equal(
        state.comparison.resources.find((p) => p.id === "tiny-change").status,
        "changed",
      );
      const notes = JSON.stringify(state).includes("Public sample note:");
      assert.equal(notes, audience === "contributor");
      const site = JSON.parse(
        await readFile(join(demo.root, "site/site.json"), "utf8"),
      );
      assert.deepEqual(site, state);
      await page.goto(demo.url);
      await expect(
        page.getByRole("heading", { name: "Start here", exact: true }),
      ).toBeVisible();
      const navigation = page.getByRole("navigation", {
        name: "Documentation pages",
      });
      await expect(navigation.getByRole("link")).toHaveCount(10);
      const go = async (name) => {
        await navigation
          .getByRole("link", { name: new RegExp(`^${name}`) })
          .click();
      };
      await expect(
        page.getByRole("checkbox", { name: "View diff" }),
      ).toBeChecked();
      await expect(page.getByRole("button", { name: "Run again" })).toHaveCount(
        0,
      );
      await page
        .getByRole("button", { name: "Version history", exact: true })
        .click();
      const versions = page.getByRole("region", { name: "Review revisions" });
      await expect(versions).toContainText(
        "Two retained demonstration versions",
      );
      await expect(page.getByLabel("Branch, tag, or commit")).toHaveCount(0);
      await page.getByRole("checkbox", { name: "Changed pages" }).check();
      await expect(
        navigation.getByRole("link", { name: "Nothing changed", exact: true }),
      ).toHaveCount(0);
      await page.getByRole("checkbox", { name: "Changed pages" }).uncheck();
      await page.getByRole("button", { name: "Close version history" }).click();
      await go("Text and code");
      await expect(
        page.locator(".prose ins").filter({ hasText: "final" }),
      ).toHaveCount(1);
      await page.getByRole("tab", { name: "Original", exact: true }).click();
      await expect(
        page.locator(".prose del").filter({ hasText: "draft" }),
      ).toHaveCount(2);
      await page.getByRole("tab", { name: "Revised", exact: true }).click();
      await go("Four pixels");
      const comparison = page.getByTestId("image-comparison");
      await expect(comparison.getByRole("slider")).toBeVisible();
      await comparison
        .getByRole("button", { name: "Image comparison controls" })
        .click();
      await comparison
        .getByRole("checkbox", { name: "Annotations", exact: true })
        .check();
      await expect(comparison.getByTestId("regions-result")).toContainText(
        "4 changed pixels",
      );
      await comparison
        .getByRole("button", { name: "Side by side", exact: true })
        .click();
      await expect(
        comparison.getByRole("region", { name: /Side by side images/ }),
      ).toBeVisible();
      await go("Different dimensions");
      await expect(page.getByRole("slider")).toHaveCount(0);
      await expect(
        page.getByRole("region", { name: /Side by side images/ }),
      ).toBeVisible();
      await comparison
        .getByRole("button", { name: "Image comparison controls" })
        .click();
      await comparison
        .getByRole("checkbox", { name: "Annotations", exact: true })
        .check();
      await expect(comparison).toContainText(/profiles|dimensions|align/i);
      await go("Structured content");
      await expect(page.getByTestId("text-review-status")).toContainText(
        "whole-block",
      );
      assert.ok(
        (await page.locator('[data-lgtmd-part="block-change"]').count()) >= 4,
      );
      await go("Contributor notes");
      const comments = page.getByRole("button", {
        name: /Contributor notes \(/,
      });
      await expect(comments).toHaveCount(audience === "contributor" ? 1 : 0);
      if (audience === "contributor") {
        await comments.click();
        await expect(page.getByText(/Public sample note:/)).toBeVisible();
      }
      await go("A new page");
      await page.getByRole("tab", { name: "Original", exact: true }).click();
      await expect(page.getByTestId("review-panel")).toContainText(
        "does not exist",
      );
      await go("A retired page");
      await expect(page.getByTestId("review-panel")).toContainText(
        "This page existed in Original",
      );
      await page.getByRole("tab", { name: "Revised", exact: true }).click();
      await expect(page.getByTestId("review-panel")).toContainText(
        "does not exist",
      );
      await go("Nothing changed");
      await expect(
        page.getByRole("heading", { name: "Nothing changed", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("img", {
          name: "Unchanged full desktop workspace",
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByTestId("text-review-status")).toContainText(
        "Text highlights ready",
      );
      await expect(page.locator(".prose ins,.prose del")).toHaveCount(0);
      await expect(page.getByRole("slider")).toHaveCount(0);
      await expect(
        page.locator('[data-lgtmd-part="image-comparison"]'),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Image comparison controls" }),
      ).toHaveCount(0);
      await page.getByLabel("Color theme").selectOption("dark");
      await page.setViewportSize({ width: 320, height: 800 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page
        .getByRole("button", { name: "Version history", exact: true })
        .click();
      const bounds = await page.locator("#version-sheet").boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 320);
      assert.equal(
        requests.some((url) => url.includes("__lgtmd/")),
        false,
        "Retained review must make no Git/live API or event-stream requests",
      );
      assert.equal(
        requests.some((url) => !url.startsWith(demo.url)),
        false,
        "Showcase must use only local retained assets",
      );
      assert.deepEqual(errors, []);
      console.log(
        `Verified canonical showcase: ${audience}, ${basePath}, no Git on PATH, full-page image review and four exact changed pixels.`,
      );
    } finally {
      await page.close();
      await demo.close();
    }
  }
} finally {
  await browser.close();
}
