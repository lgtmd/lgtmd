import type { Page } from "@playwright/test";

/** Prepare the project's declared visual state without changing application defaults. */
export async function readyForCapture(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode()));
  });
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    const dialog = document.querySelector<HTMLDialogElement>("dialog[open]");
    if (dialog) {
      const heading = dialog.querySelector<HTMLElement>("h2");
      const body = dialog.querySelector<HTMLElement>(".stay-filter-body");
      if (!heading || !body)
        throw new Error(
          "The open filter panel needs its heading and scrolling body for capture.",
        );
      // The background main is inert while a modal is open. Focus the panel's
      // neutral heading and declare both scroll positions, including its backdrop.
      heading.focus({ preventScroll: true });
      body.scrollTo({ top: 0, left: 0, behavior: "instant" });
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      return;
    }
    const main = document.querySelector<HTMLElement>("main");
    if (!main)
      throw new Error("The application main is missing before capture.");
    main.setAttribute("tabindex", "-1");
    main.focus({ preventScroll: true });
  });
}
