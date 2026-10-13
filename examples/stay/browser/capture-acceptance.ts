import assert from "node:assert/strict";
import { expect, type Page } from "@playwright/test";
import { captureWebp } from "../../review/capture.mjs";
import { readyForCapture } from "./capture-readiness.ts";

/** A modal capture includes its rounded edges and the document backdrop beneath them. */
export async function verifyDialogCaptureReadiness(page: Page) {
  const trigger = page.getByRole("button", { name: "Filters", exact: true });
  const dialog = page.getByRole("dialog", { name: "Filters", exact: true });
  const heading = dialog.getByRole("heading", { name: "Filters", exact: true });
  const body = dialog.locator(".stay-filter-body");
  let first: Buffer | undefined;
  for (const backgroundScroll of [0, 180]) {
    await trigger.click();
    await expect(heading).toBeFocused();
    await dialog
      .getByRole("spinbutton", { name: "Maximum price per night", exact: true })
      .fill("185");
    await dialog
      .getByRole("combobox", { name: "Guests", exact: true })
      .selectOption("3");
    const kitchen = dialog.getByRole("checkbox", {
      name: "Full kitchen",
      exact: true,
    });
    await kitchen.check();
    await expect(
      dialog.getByRole("button", { name: "Show 1 stay", exact: true }),
    ).toBeEnabled();

    // Deliberately vary the page beneath the panel, its internal scroll and the
    // last focused input. Ordinary modal interaction must not be our capture state.
    await page.evaluate(
      (top) => window.scrollTo({ top, behavior: "instant" }),
      backgroundScroll,
    );
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBe(backgroundScroll);
    await body.evaluate((element, offset) => {
      element.scrollTop = offset ? element.scrollHeight : 0;
    }, backgroundScroll);
    if (backgroundScroll) {
      expect(
        await body.evaluate((element) => element.scrollTop),
      ).toBeGreaterThan(0);
      await kitchen.evaluate((element) =>
        (element as HTMLElement).focus({ preventScroll: true }),
      );
    } else {
      await dialog
        .getByRole("spinbutton", {
          name: "Maximum price per night",
          exact: true,
        })
        .evaluate((element) =>
          (element as HTMLElement).focus({ preventScroll: true }),
        );
    }

    await readyForCapture(page);
    await expect(heading).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await body.evaluate((element) => element.scrollTop)).toBe(0);
    const bytes = await captureWebp(dialog);
    if (first)
      assert.deepEqual(
        bytes,
        first,
        "The same declared filter state must capture exactly, regardless of earlier focus and scroll",
      );
    else first = bytes;
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  }
  await expect(page.locator(".listing-grid .listing-card")).toHaveCount(3);
}
