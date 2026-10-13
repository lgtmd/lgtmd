import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chromium,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { startServer } from "../server/index.ts";
import { actors, listings, stayInput } from "../fixtures/scenario.ts";
import {
  ROLE_KEY,
  SESSION_KEY,
  type Role,
  type StayRequest,
} from "../src/domain.ts";
import { dispose, provision, type Workspace } from "./fixture-api.ts";
import type { AssistantConversation } from "../src/assistant-domain.ts";
import { verifyDialogCaptureReadiness } from "./capture-acceptance.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((done) => {
    release = done;
  });
  return { promise, release };
}

async function bounded<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function paint(page: Page) {
  // Synchronize rendering after a deliberately released response, without sleeps.
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      }),
  );
}

async function noOverflow(page: Page) {
  const width = page.viewportSize()!.width;
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(width);
}

async function saveReview(page: Page, name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode()));
  });
  await noOverflow(page);
  const directory = resolve(root, ".cache/review");
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: resolve(directory, `${name}.png`),
    fullPage: (await page.locator("dialog[open]").count()) === 0,
  });
}

async function contextFor(
  browser: Browser,
  url: string,
  workspace: Workspace,
  role: Role,
) {
  const context = await browser.newContext({
    baseURL: url,
    viewport: { width: 390, height: 844 },
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  await context.addInitScript(
    ({ sessions, role, sessionKey, roleKey, origin }) => {
      if (location.origin !== origin) return;
      sessionStorage.setItem(sessionKey, JSON.stringify(sessions));
      sessionStorage.setItem(roleKey, role);
    },
    {
      sessions: workspace.sessions,
      role,
      sessionKey: SESSION_KEY,
      roleKey: ROLE_KEY,
      origin: new URL(url).origin,
    },
  );
  return context;
}

async function request(
  url: string,
  workspace: Workspace,
  id: string,
): Promise<StayRequest> {
  const response = await fetch(`${url}/api/requests/${id}`, {
    headers: { authorization: `Bearer ${workspace.sessions.guest.token}` },
  });
  assert.equal(response.status, 200);
  return response.json() as Promise<StayRequest>;
}

async function mobileFilterDetails(page: Page) {
  const trigger = page.getByRole("button", { name: "Filters", exact: true });
  const dialog = page.getByRole("dialog", { name: "Filters", exact: true });
  await expect(page.getByRole("status")).toHaveText(
    "3 stays, thoughtfully chosen",
  );
  await expect(page.getByRole("status")).toBeVisible();
  await trigger.click();
  await expect(
    dialog.getByRole("heading", { name: "Filters", exact: true }),
  ).toBeFocused();
  expect(
    await dialog.evaluate((element) => (element as HTMLDialogElement).open),
  ).toBe(true);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe(
    "hidden",
  );

  const apply = dialog.getByRole("button", {
    name: "Show 3 stays",
    exact: true,
  });
  const close = dialog.getByRole("button", {
    name: "Close filters",
    exact: true,
  });
  // Chromium may include its own chrome between the last and first control.
  // Background document controls must never receive keyboard focus.
  await apply.focus();
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let index = 0; index < 24; index++) {
      await page.keyboard.press(key);
      expect(
        await dialog.evaluate(
          (element) =>
            document.activeElement === document.body ||
            element.contains(document.activeElement),
        ),
      ).toBe(true);
    }
  }
  await close.focus();

  const footerBefore = await dialog.locator("footer").boundingBox();
  const headerBefore = await dialog.locator("header").boundingBox();
  await dialog
    .getByRole("checkbox", { name: "Woodland trails", exact: true })
    .scrollIntoViewIfNeeded();
  const footerAfter = await dialog.locator("footer").boundingBox();
  const headerAfter = await dialog.locator("header").boundingBox();
  expect(footerAfter!.y).toBe(footerBefore!.y);
  expect(headerAfter!.y).toBe(headerBefore!.y);
  expect(footerAfter!.y + footerAfter!.height).toBeLessThanOrEqual(844);
  await noOverflow(page);
  await saveReview(page, "acceptance-filters-mobile");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");

  // Reset concerns only panel choices; a query entered outside it still applies.
  const search = page.getByRole("searchbox", {
    name: "Search stays",
    exact: true,
  });
  await search.fill("Portland");
  await trigger.click();
  const minimum = dialog.getByRole("spinbutton", {
    name: "Minimum price per night",
    exact: true,
  });
  const maximum = dialog.getByRole("spinbutton", {
    name: "Maximum price per night",
    exact: true,
  });
  await minimum.fill("200");
  await maximum.fill("100");
  await expect(dialog.getByRole("alert")).toContainText(/minimum price/i);
  await expect(minimum).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByRole("button", { name: /^Show / })).toBeDisabled();
  await saveReview(page, "acceptance-filters-invalid-mobile");
  await dialog.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Show 1 stay", exact: true })
    .click();
  await expect(search).toHaveValue("Portland");
  await expect(page.getByRole("status")).toHaveText(
    "1 stay matches your search",
  );
  await expect(page.locator(".listing-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  await expect(page.locator(".listing-card")).toHaveCount(3);

  await trigger.click();
  for (const partial of ["-", "e"]) {
    await minimum.pressSequentially(partial);
    expect(
      await minimum.evaluate(
        (element) => (element as HTMLInputElement).validity.badInput,
      ),
    ).toBe(true);
    await expect(dialog.getByRole("alert")).toContainText(
      "Enter a valid price",
    );
    await expect(dialog.getByRole("button", { name: /^Show / })).toBeDisabled();
    await dialog.getByRole("button", { name: "Reset", exact: true }).click();
    expect(
      await minimum.evaluate(
        (element) => (element as HTMLInputElement).validity.badInput,
      ),
    ).toBe(false);
    await expect(minimum).toHaveValue("");
    await expect(
      dialog.getByRole("button", { name: "Show 3 stays", exact: true }),
    ).toBeEnabled();
  }
  await maximum.pressSequentially("-");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await trigger.click();
  expect(
    await maximum.evaluate(
      (element) => (element as HTMLInputElement).validity.badInput,
    ),
  ).toBe(false);
  await maximum.fill("142.5");
  await dialog
    .getByRole("button", { name: "Show 1 stay", exact: true })
    .click();
  expect(new URL(page.url()).searchParams.get("max")).toBe("142.5");
  await page.reload();
  await expect(page.locator(".listing-card")).toHaveCount(1);
  await page.getByRole("button", { name: /^Filters,/ }).click();
  await expect(maximum).toHaveValue("142.5");
  await dialog
    .getByRole("button", { name: "Show 1 stay", exact: true })
    .click();
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
}

async function assistantRecovery(
  page: Page,
  url: string,
  workspace: Workspace,
) {
  await page.route("**/api/assistant", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "The conversation could not be loaded." }),
    }),
  );
  await page.getByRole("link", { name: "Ask Stay", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Find your kind of stay", exact: true }),
  ).toBeVisible();
  const composer = page.getByRole("textbox", {
    name: "What are you looking for?",
    exact: true,
  });
  const send = page.getByRole("button", { name: "Send message", exact: true });
  await expect(page.getByRole("alert")).toContainText(
    "The conversation could not be loaded",
  );
  await expect(composer).toBeDisabled();
  await page.unroute("**/api/assistant");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(composer).toBeEnabled();
  await expect(send).toBeDisabled();
  const query = "A quiet stay for 3 guests under $200 with a kitchen";
  await composer.fill(query);
  await page.route("**/api/assistant/messages", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "The stay finder is unavailable. Please try again.",
      }),
    }),
  );
  await send.click();
  await expect(page.getByRole("alert")).toContainText(
    "The stay finder is unavailable",
  );
  await expect(composer).toHaveValue(query);
  const read = async () => {
    const response = await fetch(`${url}/api/assistant`, {
      headers: { authorization: `Bearer ${workspace.sessions.guest.token}` },
    });
    expect(response.status).toBe(200);
    return response.json() as Promise<AssistantConversation>;
  };
  expect((await read()).messages).toEqual([]);
  await saveReview(page, "acceptance-assistant-error-mobile");
  await page.unroute("**/api/assistant/messages");

  const held = gate();
  const release = gate();
  const delivered = gate();
  await page.route("**/api/assistant/messages", async (route) => {
    const response = await route.fetch();
    held.release();
    try {
      await release.promise;
      await route.fulfill({ response });
    } finally {
      delivered.release();
    }
  });
  try {
    await send.click();
    await bounded(
      held.promise,
      "The assistant response did not reach its explicit browser gate",
    );
    await expect(send).toBeDisabled();
    // Leaving the chat while its response is pending must not overwrite the new role.
    await page.getByRole("button", { name: "Host view", exact: true }).click();
    await expect(page.locator(".identity-name")).toHaveText(actors.host.name);
    release.release();
    await bounded(
      delivered.promise,
      "The assistant response gate did not finish",
    );
    await paint(page);
    await expect(page.locator(".identity-name")).toHaveText(actors.host.name);
    await expect(
      page.getByRole("textbox", {
        name: "What are you looking for?",
        exact: true,
      }),
    ).toHaveCount(0);
  } finally {
    release.release();
    await page.unroute("**/api/assistant/messages");
  }
  await page.getByRole("button", { name: "Guest view", exact: true }).click();
  await page.getByRole("link", { name: "Ask Stay", exact: true }).click();
  await expect(composer).toBeEnabled();
  expect((await read()).messages.map((message) => message.role)).toEqual([
    "user",
    "assistant",
  ]);
  await expect(
    page.getByRole("main").getByRole("link").filter({ hasText: "Cedar House" }),
  ).toHaveCount(1);
  await composer.fill("Actually 2 guests and under $150");
  // Completion must not leave a delayed focus callback that can override the
  // user's next focus target (or the documentation capture's neutral target).
  await page.evaluate(() => {
    const original = window.requestAnimationFrame.bind(window);
    const pending: FrameRequestCallback[] = [];
    window.requestAnimationFrame = (callback) => pending.push(callback);
    window.addEventListener(
      "stay-test-release-frames",
      () => {
        window.requestAnimationFrame = original;
        for (const callback of pending) original(callback);
      },
      { once: true },
    );
  });
  const main = page.getByRole("main");
  try {
    await composer.press("Enter");
    await expect(
      page
        .getByTestId("assistant-turn")
        .last()
        .getByRole("link", { name: "Courtyard Loft", exact: true }),
    ).toBeVisible();
    await main.evaluate((element) => {
      element.setAttribute("tabindex", "-1");
      (element as HTMLElement).focus({ preventScroll: true });
    });
  } finally {
    await page.evaluate(() =>
      window.dispatchEvent(new Event("stay-test-release-frames")),
    );
  }
  await paint(page);
  await expect(main).toBeFocused();
  await expect(composer).toBeInViewport();
  await expect(send).toBeInViewport();
  await saveReview(page, "acceptance-assistant-mobile");
  await page.setViewportSize({ width: 1280, height: 900 });
  await saveReview(page, "acceptance-assistant-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByTestId("assistant-turn")).toHaveCount(0);
  await expect(send).toBeDisabled();
  expect((await read()).messages).toEqual([]);
}

async function validationAndRequest(
  page: Page,
  url: string,
  workspace: Workspace,
) {
  await page.goto("/#/stays/cedar-house");
  await expect(
    page.getByRole("heading", { name: "Cedar House", exact: true }),
  ).toBeVisible();
  await saveReview(page, "acceptance-property-mobile");

  const checkIn = page.getByLabel("Check-in", { exact: true });
  const checkOut = page.getByLabel("Check-out", { exact: true });
  const guests = page.getByLabel("Guests", { exact: true });
  const message = page.getByLabel("Message to host", { exact: true });
  const submit = page.getByRole("button", {
    name: "Request to stay",
    exact: true,
  });
  await checkIn.focus();
  await page.keyboard.press("Tab");
  // Native date inputs may have several keyboard segments; focus remains visible.
  const focused = await page.evaluate(() => {
    const element = document.activeElement;
    if (!element) return null;
    const style = getComputedStyle(element);
    return {
      tag: element.tagName,
      outline: style.outlineStyle,
      width: parseFloat(style.outlineWidth),
    };
  });
  expect(focused?.tag).toBe("INPUT");
  expect(focused?.outline).not.toBe("none");
  expect(focused?.width).toBeGreaterThan(0);

  await checkIn.fill("2026-11-09");
  await checkOut.fill("2026-11-06");
  await guests.fill("2");
  await message.fill(stayInput.message);
  const rejectedDate = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/requests") &&
      response.request().method() === "POST",
  );
  await submit.click();
  expect((await rejectedDate).status()).toBe(400);
  await expect(page.getByRole("alert")).toContainText(
    "Check-out must be after check-in",
  );
  await saveReview(page, "acceptance-validation-mobile");

  await checkIn.fill(stayInput.checkIn);
  await checkOut.fill(stayInput.checkOut);
  await guests.fill(String(listings[0].capacity + 1));
  await submit.click();
  expect(
    await guests.evaluate(
      (element) => (element as HTMLInputElement).validity.rangeOverflow,
    ),
  ).toBe(true);
  expect(
    await guests.evaluate(
      (element) => (element as HTMLInputElement).validationMessage,
    ),
  ).not.toBe("");
  await expect(guests).toBeFocused();
  const serverRejection = await fetch(`${url}/api/requests`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${workspace.sessions.guest.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ ...stayInput, guests: listings[0].capacity + 1 }),
  });
  assert.equal(serverRejection.status, 400);
  assert.match(
    ((await serverRejection.json()) as { error: string }).error,
    /between 1 and 4 guests/,
  );
  const empty = await fetch(`${url}/api/requests`, {
    headers: { authorization: `Bearer ${workspace.sessions.guest.token}` },
  });
  assert.deepEqual(await empty.json(), []);

  await guests.fill(String(stayInput.guests));
  await submit.click();
  await expect(page).toHaveURL(/#\/trips\/request-001$/);
  await expect(
    page.getByText(stayInput.message, { exact: true }),
  ).toBeVisible();
  const created = await request(url, workspace, "request-001");
  expect(created).toMatchObject({
    checkIn: stayInput.checkIn,
    checkOut: stayInput.checkOut,
    guests: stayInput.guests,
    status: "pending",
  });
  await saveReview(page, "acceptance-guest-mobile");
}

async function mobileInboxAndInterruptedDraft(
  page: Page,
  url: string,
  workspace: Workspace,
) {
  await page.goto("/#/inbox");
  const requests = page.getByRole("complementary", {
    name: "Stay requests",
    exact: true,
  });
  await expect(requests).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Stay conversation", exact: true }),
  ).toHaveCount(0);
  await noOverflow(page);
  await requests.getByRole("link").filter({ hasText: "Cedar House" }).click();
  const conversation = page.getByRole("region", {
    name: "Stay conversation",
    exact: true,
  });
  await expect(conversation).toBeVisible();
  await expect(requests).toBeHidden();
  await expect(
    page.getByRole("link", { name: "All requests", exact: true }),
  ).toBeVisible();
  await saveReview(page, "acceptance-host-mobile");
  await page.getByRole("link", { name: "All requests", exact: true }).click();
  await expect(requests).toBeVisible();
  await expect(conversation).toHaveCount(0);
  await requests.getByRole("link").filter({ hasText: "Cedar House" }).click();

  const draft = page.getByRole("textbox", {
    name: "Reply to guest",
    exact: true,
  });
  const manual = "I will check the trail details before I send this reply.";
  await draft.fill(manual);
  const before = await request(url, workspace, "request-001");
  // Exercise an interrupted transport independently of the provider's declared
  // failure/retry script. A missing completion event must not become a draft.
  await page.route("**/api/requests/*/reply", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson; charset=utf-8",
      body:
        JSON.stringify({ type: "text", text: "An unfinished suggestion" }) +
        "\n",
    });
  });
  try {
    await page
      .getByRole("button", { name: "Suggest a reply", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("ended early");
    await expect(draft).toHaveValue(manual);
    expect((await request(url, workspace, "request-001")).messages).toEqual(
      before.messages,
    );
    await saveReview(page, "acceptance-interrupted-draft-mobile");
  } finally {
    await page.unroute("**/api/requests/*/reply");
  }

  await page.route("**/api/requests/*/reply", (route) =>
    route.abort("connectionreset"),
  );
  try {
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      /fetch|network|connection/i,
    );
    await expect(draft).toHaveValue(manual);
    expect((await request(url, workspace, "request-001")).messages).toEqual(
      before.messages,
    );
  } finally {
    await page.unroute("**/api/requests/*/reply");
  }
}

async function staleRoleRefresh(page: Page, url: string, workspace: Workspace) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/#/trips");
  await expect(page.locator(".identity-name")).toHaveText(actors.guest.name);
  const held = gate();
  const release = gate();
  const delivered = gate();
  let holding = false;
  await page.route("**/api/me", async (route) => {
    if (
      holding ||
      route.request().headers().authorization !==
        `Bearer ${workspace.sessions.guest.token}`
    ) {
      await route.continue();
      return;
    }
    holding = true;
    try {
      const response = await route.fetch();
      held.release();
      await release.promise;
      await route.fulfill({ response });
    } finally {
      delivered.release();
    }
  });
  try {
    const oldRequests = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/requests") &&
        response.request().headers().authorization ===
          `Bearer ${workspace.sessions.guest.token}`,
    );
    await page
      .getByRole("button", { name: "Refresh requests", exact: true })
      .click();
    await bounded(
      Promise.all([held.promise, oldRequests]),
      "The old guest refresh did not reach its explicit response gate",
    );
    // The held refresh has the old one-request list. The host's newer refresh
    // must retain both records even after the old guest response is released.
    const added = await fetch(`${url}/api/requests`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${workspace.sessions.guest.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...stayInput,
        listingId: "courtyard-loft",
        message: "Is the courtyard quiet in the morning?",
      }),
    });
    assert.equal(added.status, 201);
    await page.getByRole("button", { name: "Host view", exact: true }).click();
    await expect(page.locator(".identity-name")).toHaveText(actors.host.name);
    await expect(page.locator(".inbox-item")).toHaveCount(2);
    const received = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/me") &&
        response.request().headers().authorization ===
          `Bearer ${workspace.sessions.guest.token}`,
    );
    release.release();
    await bounded(
      Promise.all([delivered.promise, received]),
      "The released guest response was not delivered",
    );
    await paint(page);
    await expect(page.locator(".identity-name")).toHaveText(actors.host.name);
    await expect(page.locator(".inbox-item")).toHaveCount(2);
    await expect(
      page.getByRole("button", { name: "Host view", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await saveReview(page, "acceptance-role-switch-desktop");
  } finally {
    release.release();
    await page.unroute("**/api/me");
  }
}

/** Additional UI gates, independent of documentation collection and its output. */
export async function runAcceptance() {
  const key = randomUUID();
  const server = await startServer({
    port: 0,
    fixtureKey: key,
    staticRoot: resolve(root, "dist"),
  });
  const contexts: BrowserContext[] = [];
  let browser: Browser | undefined;
  let workspace: Workspace | undefined;
  const errors: unknown[] = [];
  const pageErrors: Error[] = [];
  try {
    workspace = await provision(server.url, key, "A");
    browser = await chromium.launch({
      args: ["--disable-gpu-rasterization", "--disable-partial-raster"],
    });
    const guest = await contextFor(browser, server.url, workspace, "guest");
    contexts.push(guest);
    const host = await contextFor(browser, server.url, workspace, "host");
    contexts.push(host);
    for (const context of contexts)
      context.on("page", (page) =>
        page.on("pageerror", (error) => pageErrors.push(error)),
      );
    const guestPage = await guest.newPage();
    const hostPage = await host.newPage();
    await guestPage.setViewportSize({ width: 1280, height: 900 });
    await guestPage.goto("/#/");
    await expect(guestPage.getByRole("main").getByRole("img")).toHaveCount(3);
    await saveReview(guestPage, "acceptance-explore-desktop");
    await verifyDialogCaptureReadiness(guestPage);
    await guestPage.setViewportSize({ width: 390, height: 844 });
    await saveReview(guestPage, "acceptance-explore-mobile");
    await mobileFilterDetails(guestPage);
    await assistantRecovery(guestPage, server.url, workspace);
    await validationAndRequest(guestPage, server.url, workspace);
    await mobileInboxAndInterruptedDraft(hostPage, server.url, workspace);
    await staleRoleRefresh(guestPage, server.url, workspace);
    // Removing the fixture produces the same expired credentials as restarting
    // this in-memory service. Recovery must be explicit and produce a fresh demo.
    await dispose(server.url, key, workspace);
    workspace = undefined;
    await guestPage.reload();
    await expect(guestPage.getByRole("alert")).toContainText(
      "Select a demo identity",
    );
    const fresh = guestPage.waitForResponse(
      (response) =>
        response.url().endsWith("/api/demo") &&
        response.request().method() === "POST",
    );
    await guestPage
      .getByRole("button", { name: "Start a fresh demo", exact: true })
      .click();
    expect((await fresh).status()).toBe(201);
    await expect(
      guestPage.getByRole("heading", {
        name: "Places to make your own",
        exact: true,
      }),
    ).toBeVisible();
    await guestPage
      .getByRole("link", { name: "Your trips", exact: true })
      .click();
    await expect(
      guestPage.getByRole("heading", { name: "Your trips", exact: true }),
    ).toBeVisible();
    await expect(
      guestPage.getByRole("heading", {
        name: "Your next chapter starts here.",
        exact: true,
      }),
    ).toBeVisible();
    assert.deepEqual(
      pageErrors,
      [],
      "The acceptance journey must not have uncaught browser exceptions",
    );
  } catch (error) {
    errors.push(error);
  } finally {
    for (const context of contexts) {
      try {
        await context.close();
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      await browser?.close();
    } catch (error) {
      errors.push(error);
    }
    if (workspace) {
      try {
        await dispose(server.url, key, workspace);
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      await server.close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1)
    throw new AggregateError(
      errors,
      "Stay browser acceptance and cleanup failed",
    );
  console.log(
    "Stay browser acceptance: assistant recovery, filters, validation, mobile inbox, interrupted drafts, focus, stale role refresh, and expired-session recovery passed.",
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await runAcceptance();
}
