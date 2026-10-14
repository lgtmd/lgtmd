import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { Doc, compileSite, compareSite } from "lgtmd";

export async function verifyTextReview(browser, url, audience) {
  async function compile(current) {
    const doc = new Doc("text", "Text review");
    if (current) doc.md`An inserted opening paragraph.`;
    doc.md`A stable introduction.

A **${current ? "sunny" : "quiet"}** cabin with [details](https://example.com/details).

## Small correction

Confirm the ${current ? "reservation" : "resrevation"}.

## Exact lines

\`\`\`js
const state = "${current ? "ready" : "draft"}";
keep();
\`\`\`

## Coarse fallback

[Same label](https://example.com/${current ? "new" : "old"})

## Private notes`;
    doc.note`PrivateTextReviewEvidence${current ? "NEW" : "OLD"}`;
    const long = new Doc("long", "Long page");
    for (let i = 0; i < 180; i++) {
      long.md`Section ${i} is ${current && i === 90 ? "updated" : "unchanged"}.`;
    }
    const large = new Doc("large", "Oversized page");
    large.md`${"a".repeat(200_001)}${current ? "new" : "old"}`;
    return (await compileSite([doc.finish(), long.finish(), large.finish()]))[
      audience
    ];
  }
  const previous = await compile(false),
    current = await compile(true);
  const state = {
    mode: "dev",
    title: "Text review",
    audience,
    run: { status: "succeeded", retained: false, stale: false },
    current: current.bundle,
    currentResourceBase: url,
    baseline: {
      status: "available",
      ref: "HEAD",
      bundle: previous.bundle,
      resourceBase: url,
    },
    comparison: await compareSite(previous.files, current.files),
    canRun: false,
  };
  const page = await browser.newPage({
    viewport: { width: 1200, height: 900 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.workerInputs = [];
    window.Worker = class extends NativeWorker {
      postMessage(message, ...args) {
        if (message && "before" in message)
          window.workerInputs.push(JSON.stringify(message));
        return super.postMessage(message, ...args);
      }
    };
  });
  await page.route("**/*", async (route) => {
    const requested = route.request().url();
    if (requested === url) {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: (await response.text()).replace(
          /"mode"\s*:\s*"static"/,
          '"mode":"dev"',
        ),
      });
    } else if (requested === new URL("site.json", url).href)
      await route.fulfill({ json: state });
    else if (requested.endsWith("/__lgtmd/events"))
      await route.fulfill({ status: 204 });
    else await route.continue();
  });
  try {
    await page.goto(`${url}#/text`);
    const toggle = page.getByRole("checkbox", { name: "View diff" });
    await toggle.uncheck();
    const prose = page.locator("#document-version .prose");
    const geometry = () =>
      prose.evaluate((element) => ({
        scroll: scrollY,
        text: element.textContent,
        boxes: [...element.querySelectorAll("h1,h2,p,pre")].map((node) => {
          const { x, y, width, height } = node.getBoundingClientRect();
          return { x, y, width, height };
        }),
      }));
    for (const theme of ["Light", "Dark"]) {
      await page.getByLabel("Color theme").selectOption(theme.toLowerCase());
      for (const width of [1200, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await toggle.uncheck();
        await page.evaluate(() => scrollTo(0, 140));
        const plain = await geometry();
        await toggle.check();
        await expect(prose.locator("ins")).toHaveCount(3);
        assert.deepEqual(
          await geometry(),
          plain,
          "Highlighting must preserve same-side text, geometry and scroll",
        );
        assert.deepEqual(await prose.locator("ins").allTextContents(), [
          "sunny",
          "r",
          'const state = "ready";\n',
        ]);
        await expect(prose.locator("strong ins")).toHaveText("sunny");
        await expect(
          prose.getByRole("link", { name: "details" }),
        ).toHaveAttribute("href", "https://example.com/details");
        await expect(prose.locator('[data-change="modified"]')).toContainText(
          "Same label",
        );
        const selection = await prose.evaluate((element) => {
          const r = document.createRange();
          r.selectNodeContents(element);
          const s = getSelection();
          s.removeAllRanges();
          s.addRange(r);
          const value = s.toString();
          s.removeAllRanges();
          return value;
        });
        await toggle.uncheck();
        const originalSelection = await prose.evaluate((element) => {
          const r = document.createRange();
          r.selectNodeContents(element);
          const s = getSelection();
          s.removeAllRanges();
          s.addRange(r);
          const value = s.toString();
          s.removeAllRanges();
          return value;
        });
        assert.equal(
          selection,
          originalSelection,
          "Copy selection must contain only original authored text",
        );
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
      }
    }
    await toggle.focus();
    await toggle.press("Space");
    await page.getByRole("tab", { name: "Previous", exact: true }).click();
    await expect(prose.locator("del")).toHaveCount(3);
    assert.deepEqual(await prose.locator("del").allTextContents(), [
      "quiet",
      "r",
      'const state = "draft";\n',
    ]);
    await expect(prose.getByText("An inserted opening paragraph.")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("text-review-status")).toContainText(
      "Deletions in previous",
    );
    await page.getByRole("tab", { name: "Current", exact: true }).click();
    await expect(
      prose
        .locator('[data-change="added"]')
        .filter({ hasText: "An inserted opening paragraph." }),
    ).toHaveCount(1);
    const inputs = await page.evaluate(() => window.workerInputs);
    assert.ok(inputs.length > 0);
    assert.equal(
      inputs.some((input) => input.includes("PrivateTextReviewEvidence")),
      audience === "contributor",
      "Reader analysis must never receive contributor-only content",
    );
    await page.setViewportSize({ width: 1200, height: 900 });
    const started = performance.now();
    await page.goto(`${url}#/long`);
    await expect(page.getByTestId("text-review-status")).toContainText(
      "Text highlights ready",
    );
    await expect(prose.locator("ins")).toHaveText("updated");
    console.log(
      `Text review (${audience}): 180-block navigation + worker + render ${Math.round(performance.now() - started)} ms`,
    );
    await page.goto(`${url}#/large`);
    await expect(page.getByTestId("text-review-status")).toContainText(
      "whole-block or page-level review",
    );
    await expect(prose.locator("ins,del")).toHaveCount(0);
    // Rapid page changes must never paint the prior page's ranges on this page.
    await page.evaluate(() => {
      location.hash = "#/long";
      location.hash = "#/text";
    });
    await expect(prose.locator("strong ins")).toHaveText("sunny");
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}
