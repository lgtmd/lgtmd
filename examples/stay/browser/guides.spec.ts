import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { withDocs } from "lgtmd/playwright";
import type { Doc } from "lgtmd";
import type { Page } from "@playwright/test";
import { test as applicationTest, expect } from "./application-test.ts";
import { fixtureRequest } from "./fixture-api.ts";
import { captureWebp, webpProfile } from "../../review/capture.mjs";
import {
  listings,
  stayInput,
  replyScripts,
  hostEdit,
} from "../fixtures/scenario.ts";
import type { StayRequest } from "../src/domain.ts";

const test = withDocs(applicationTest);
const listing = listings[0];
const manualDraft =
  "Thanks for getting in touch. Let me check the trail details.";
const script = process.env.STAY_SCRIPT === "B" ? "B" : "A";
const suggestion = replyScripts[script].join("");
const sentReply = suggestion + hostEdit;

async function ready(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode()));
  });
  await page.mouse.move(0, 0);
  // A neutral focus target avoids screenshots depending on the last control clicked.
  await page.locator("main").evaluate((element) => {
    element.setAttribute("tabindex", "-1");
    (element as HTMLElement).focus({ preventScroll: true });
  });
}

async function image(doc: Doc, page: Page, id: string, surface = "main") {
  await ready(page);
  return doc.assets.image(id, await captureWebp(page.locator(surface)), {
    mediaType: "image/webp",
    producer: "playwright/chromium+sharp",
    profile: `stay-playwright-1.64.0-${process.platform}-${process.arch}-1280x900-cpu-full-raster-${webpProfile}`,
  });
}

async function saveReview(page: Page, name: string) {
  if (process.env.STAY_SAVE_REVIEW !== "1") return;
  const directory = resolve(".cache/review");
  await mkdir(directory, { recursive: true });
  await ready(page);
  await page.screenshot({
    path: resolve(directory, `${name}-desktop.png`),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: resolve(directory, `${name}-mobile.png`),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("Find a stay with filters", async ({ application, doc }) => {
  doc.page({ id: "find-a-stay", title: "Find a stay with filters" });
  const page = await application.guest.newPage();
  await page.goto("/#/");
  const cards = page.locator(".listing-grid .listing-card");
  const search = page.getByRole("searchbox", {
    name: "Search stays",
    exact: true,
  });
  const filters = page.getByRole("button", { name: /^Filters(?:,|$)/ });
  const dialog = page.getByRole("dialog", { name: "Filters", exact: true });
  await expect(cards).toHaveCount(3);

  await search.fill(" portLAND ");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Courtyard Loft");
  await expect(cards.first()).toContainText("In the neighborhood");
  await expect(cards.first()).not.toContainText("Among the trees");
  await cards.first().click();
  await expect(
    page.getByRole("heading", { name: "Courtyard Loft", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(cards).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get("q")).toBe("portLAND");
  await search.fill("");
  await expect(cards).toHaveCount(3);

  const introduction = doc.md`Search by city, region or stay name to narrow the collection. **Portland** finds Courtyard Loft; the search also recognizes names such as **Cedar House**. Opening a stay and returning keeps your filters.

## Set your budget and group size

Open **Filters** to choose a nightly price range, the number of guests and amenities. Prices include the endpoints you enter. A stay must fit your group and include **every** selected amenity.

The result count previews your choices while the panel is open. Choose **Show stays** to apply them. **Cancel**, the close button or Escape leaves the current results unchanged.`;
  const receipt = doc.assets.text(
    "fixture-receipt",
    `stay-private-fixture-receipt\n${application.conditions}`,
  );
  doc.noteOn(
    introduction,
  )`${application.conditions} ${receipt.link("Fixture ownership")}
This example filters three supplied listings in the browser. It does not query real availability or calculate a booking total. No provider call is needed for filtering.`;

  await filters.click();
  await expect(
    dialog.getByRole("heading", { name: "Filters", exact: true }),
  ).toBeFocused();
  const minimum = dialog.getByRole("spinbutton", {
    name: "Minimum price per night",
    exact: true,
  });
  const maximum = dialog.getByRole("spinbutton", {
    name: "Maximum price per night",
    exact: true,
  });
  const guests = dialog.getByRole("combobox", { name: "Guests", exact: true });
  const kitchen = dialog.getByRole("checkbox", {
    name: "Full kitchen",
    exact: true,
  });
  await maximum.fill("185");
  await guests.selectOption("3");
  await kitchen.check();
  await expect(
    dialog.getByRole("button", { name: "Show 1 stay", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(filters).toBeFocused();
  await expect(cards).toHaveCount(3);
  expect(new URL(page.url()).search).toBe("");

  await filters.click();
  await expect(maximum).toHaveValue("");
  await expect(guests).toHaveValue("1");
  await expect(kitchen).not.toBeChecked();
  await maximum.fill("185");
  await guests.selectOption("3");
  await kitchen.check();
  await expect(
    dialog.getByRole("button", { name: "Show 1 stay", exact: true }),
  ).toBeEnabled();
  const controls = await image(doc, page, "filter-controls", "dialog[open]");
  doc.md`Here, a maximum of **$185 per night**, room for **three guests**, and a **Full kitchen** leave one matching stay: Cedar House.

${controls.embed("Filters preview one stay for the selected budget, guests and kitchen")}`;
  await dialog
    .getByRole("button", { name: "Show 1 stay", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Cedar House");
  const applied = new URL(page.url()).search;
  expect(new URL(page.url()).searchParams.get("max")).toBe("185");
  expect(new URL(page.url()).searchParams.get("guests")).toBe("3");
  expect(new URL(page.url()).searchParams.getAll("amenity")).toEqual([
    "Full kitchen",
  ]);
  await page.reload();
  await expect(cards).toHaveCount(1);
  expect(new URL(page.url()).search).toBe(applied);
  await cards.first().click();
  await expect(
    page.getByRole("heading", { name: "Cedar House", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(cards).toHaveCount(1);
  const result = await image(doc, page, "filtered-stays");
  doc.md`## Adjust one choice at a time

Applied filters appear above the results. Remove a chip to relax just that choice, or use **Clear all** to start over. Your choices remain in the URL, so reloading the page or returning from a listing preserves them.

${result.embed("Cedar House is the one match, with its applied filters shown above")}

Inside the panel, **Reset** clears the draft choices. Apply the draft to update the results; cancelling after Reset keeps the existing filters.`;
  await saveReview(page, "filters-applied");

  await filters.click();
  await dialog.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Show 3 stays", exact: true }),
  ).toBeEnabled();
  expect(new URL(page.url()).search).toBe(applied);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(filters).toBeFocused();
  await expect(cards).toHaveCount(1);
  await filters.click();
  await minimum.fill("200");
  await maximum.fill("100");
  await expect(dialog.getByRole("alert")).toContainText(/minimum price/i);
  await expect(
    dialog.getByRole("button", { name: /^Show \d+ stays?$/ }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(cards).toHaveCount(1);
  expect(new URL(page.url()).search).toBe(applied);

  await page
    .getByRole("button", { name: "Remove guests filter", exact: true })
    .click();
  await expect(cards).toHaveCount(2);
  expect(new URL(page.url()).searchParams.has("guests")).toBe(false);
  expect(new URL(page.url()).searchParams.get("max")).toBe("185");
  await filters.click();
  await dialog
    .getByRole("checkbox", { name: "Ocean view", exact: true })
    .check();
  await expect(
    dialog.getByRole("button", { name: "Show 0 stays", exact: true }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "Show 0 stays", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(cards).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /^No stays match these filters/ }),
  ).toBeVisible();
  const empty = await image(doc, page, "no-matches");
  doc.md`## When nothing matches

An ocean view together with the $185 maximum leaves no match in this collection. Widen the budget, remove an amenity, or choose **Clear all filters**. No matches means the selected conditions do not fit these sample listings; it is not a live availability check.

${empty.embed("A clear empty state explains how to relax the selected filters")}

Filters use the displayed nightly rate. They do not include taxes or fees, or confirm that dates are available. Open a matching stay to review its details before sending a request.`;
  await saveReview(page, "filters-empty");
  await page
    .getByRole("button", { name: "Clear all filters", exact: true })
    .click();
  await expect(cards).toHaveCount(3);
  await expect(search).toHaveValue("");
  expect(new URL(page.url()).search).toBe("");
});

for (const perspective of ["guest", "host"] as const) {
  test(
    perspective === "guest" ? "Request a stay" : "Respond to a stay request",
    async ({ application, baseURL, doc }) => {
      doc.page(
        perspective === "guest"
          ? { id: "request-a-stay", title: "Request a stay" }
          : { id: "respond-to-a-request", title: "Respond to a stay request" },
      );
      const { workspace } = application;
      const guest = await application.guest.newPage();
      const host = await application.host.newPage();
      const fixturePath = `/workspaces/${workspace.id}`;
      const key = process.env.STAY_FIXTURE_KEY!;
      const readRequest = async () => {
        const response = await guest.request.get(
          new URL("/api/requests/request-001", baseURL).href,
          {
            headers: {
              authorization: `Bearer ${workspace.sessions.guest.token}`,
            },
          },
        );
        expect(response.status()).toBe(200);
        return (await response.json()) as StayRequest;
      };

      await guest.goto("/#/stays/cedar-house");
      await expect(
        guest.getByRole("heading", { name: listing.title, exact: true }),
      ).toBeVisible();
      await expect(
        guest.getByText(listing.location, { exact: true }),
      ).toBeVisible();
      if (perspective === "guest") {
        const property = await image(doc, guest, "cedar-house");
        const introduction = doc.md`Open a stay to see its location, sleeping arrangements, amenities and nightly rate. **Cedar House** is a two-bedroom retreat for up to four guests.

${property.embed("Cedar House and its request form")}

## Send your request

Choose **Check-in**, **Check-out** and **Guests**, then introduce your plans in **Message to host**. In this example, Alex asks Maya about a walking trail for a three-night stay, November 6–9, 2026.

Choose **Request to stay**. The conversation opens with your dates, guest count and message. This is a request awaiting the host's response; no payment is taken.`;
        const privateReceipt = doc.assets.text(
          "fixture-receipt",
          `stay-private-fixture-receipt\n${application.conditions}`,
        );
        doc.noteOn(
          introduction,
        )`${application.conditions} ${privateReceipt.link("Fixture ownership")}
The application fixes its sample dates, clock and visible IDs. This demo does not implement availability or a payment flow.`;
        await saveReview(guest, "property");
      }

      await guest
        .getByLabel("Check-in", { exact: true })
        .fill(stayInput.checkIn);
      await guest
        .getByLabel("Check-out", { exact: true })
        .fill(stayInput.checkOut);
      await guest
        .getByRole("spinbutton", { name: /^Guests/ })
        .fill(String(stayInput.guests));
      await guest
        .getByLabel("Message to host", { exact: true })
        .fill(stayInput.message);
      await guest
        .getByRole("button", { name: "Request to stay", exact: true })
        .click();
      await expect(guest).toHaveURL(/#\/trips\/request-001$/);
      await expect(
        guest.getByText(stayInput.message, { exact: true }),
      ).toBeVisible();
      expect((await readRequest()).status).toBe("pending");
      if (process.env.STAY_FAULT === "assertion")
        expect(
          (await readRequest()).status,
          "Deliberate Stay scenario assertion failure",
        ).toBe("accepted");

      await host.goto("/#/inbox/request-001");
      await expect(
        host
          .getByTestId("conversation")
          .getByText(stayInput.message, { exact: true }),
      ).toBeVisible();
      const initial = await readRequest();
      expect(initial).toMatchObject({
        checkIn: stayInput.checkIn,
        checkOut: stayInput.checkOut,
        guests: stayInput.guests,
      });
      await host
        .getByRole("textbox", { name: "Reply to guest", exact: true })
        .fill(manualDraft);
      await host
        .getByRole("button", { name: "Suggest a reply", exact: true })
        .click();
      await expect(host.getByRole("alert")).toContainText("Please try again");
      await expect(
        host.getByRole("textbox", { name: "Reply to guest", exact: true }),
      ).toHaveValue(manualDraft);
      expect((await readRequest()).messages).toEqual(initial.messages);
      if (perspective === "host") {
        const failure = await image(
          doc,
          host,
          "reply-recovery",
          "[data-testid='conversation']",
        );
        const passage = doc.md`Open **Host inbox**, then select a request. Read the guest's dates, guest count and message before replying. Sending a message and accepting the request are separate actions.

## Draft a helpful reply

Write in **Reply to guest**, or choose **Suggest a reply** for a starting point. A suggestion is a draft: it is never sent automatically. If generation fails, your existing draft and the conversation remain intact. Choose **Try again** to request another suggestion.

${failure.embed("The reply service error leaves the host's manual draft intact")}`;
        const privateReceipt = doc.assets.text(
          "fixture-receipt",
          `stay-private-fixture-receipt\n${application.conditions}`,
        );
        doc.noteOn(
          passage,
        )`${application.conditions} ${privateReceipt.link("Fixture ownership")}
The server uses AI SDK's mock model, not a live model. The first response deliberately fails. Exact fixture text verifies the wiring, not AI quality. Reader and Contributor audiences are separate from host and guest roles.`;
        await saveReview(host, "reply-error");
      }

      await host
        .getByRole("button", { name: "Try again", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await (await fixtureRequest(baseURL!, key, fixturePath)).json())
              .provider.paused,
        )
        .toBe(true);
      await expect(
        host.getByRole("status", { name: "Suggested reply", exact: true }),
      ).toContainText(replyScripts[script][0]);
      await expect(
        host.getByRole("button", { name: "Send reply", exact: true }),
      ).toBeDisabled();
      await expect(
        host.getByRole("textbox", { name: "Reply to guest", exact: true }),
      ).toHaveValue(manualDraft);
      if (perspective === "host") {
        const streaming = await image(
          doc,
          host,
          "reply-streaming",
          "[data-testid='conversation']",
        );
        doc.md`Wait until the suggestion finishes. The preview shows the incoming text while your draft stays available below. You cannot send a partial suggestion.

${streaming.embed("An unfinished suggestion above the preserved manual draft")}`;
        await saveReview(host, "reply-streaming");
      }
      expect(
        (await fixtureRequest(baseURL!, key, `${fixturePath}/release`, "POST"))
          .status,
      ).toBe(200);
      const draft = host.getByRole("textbox", {
        name: "Reply to guest",
        exact: true,
      });
      await expect(draft).toHaveValue(suggestion);
      await draft.fill(sentReply);
      await host
        .getByRole("button", { name: "Send reply", exact: true })
        .click();
      await expect(
        host.getByTestId("conversation").getByText(sentReply, { exact: true }),
      ).toBeVisible();
      await expect(draft).toHaveValue("");
      await expect(draft).toBeEnabled();
      await expect(
        host.getByRole("button", { name: "Send reply", exact: true }),
      ).toBeDisabled();
      await expect(
        host.getByRole("button", { name: "Suggest a reply", exact: true }),
      ).toBeEnabled();
      const replied = await readRequest();
      expect(replied.status).toBe("pending");
      expect(replied.messages.map((message) => message.body)).toEqual([
        stayInput.message,
        sentReply,
      ]);

      await host
        .getByRole("button", { name: "Accept request", exact: true })
        .click();
      await expect
        .poll(async () => (await readRequest()).status)
        .toBe("accepted");
      await expect(
        host.getByTestId("conversation").getByText("Accepted", { exact: true }),
      ).toBeVisible();
      await expect(
        host.getByRole("button", { name: "Accept request", exact: true }),
      ).toHaveCount(0);
      await expect(
        host.getByRole("button", { name: "Suggest a reply", exact: true }),
      ).toBeEnabled();
      const accepted = await readRequest();
      expect(accepted.messages).toEqual(replied.messages);
      const provider = (
        await (await fixtureRequest(baseURL!, key, fixturePath)).json()
      ).provider;
      expect(provider.calls).toHaveLength(2);
      for (const call of provider.calls) {
        expect(JSON.stringify(call.prompt)).toContain(listing.title);
        expect(JSON.stringify(call.prompt)).toContain(stayInput.message);
      }
      if (perspective === "host") {
        const completed = await image(
          doc,
          host,
          "accepted-request",
          "[data-testid='conversation']",
        );
        doc.md`## Send, then accept

Review and edit the completed suggestion. Here, Maya keeps its trail advice and adds a check-in time. Choose **Send reply** to add the edited message to the conversation. The request still awaits acceptance.

When you are ready to host, choose **Accept request**. The status becomes **Accepted** and the messages stay in the conversation. Alex can return to **Your trips** to read the reply and see the accepted stay.

${completed.embed("The host's edited reply and accepted request")}

Stay is a fictional local demo. Its suggestions are scripted, and it does not charge guests or check a real availability calendar.`;
        await saveReview(host, "host-accepted");
      }
      await guest.reload();
      await expect(guest.getByText(sentReply, { exact: true })).toBeVisible();
      await expect(guest.getByText("Accepted", { exact: true })).toBeVisible();
      if (perspective === "guest") {
        const outcome = await image(
          doc,
          guest,
          "accepted-stay",
          "[data-testid='conversation']",
        );
        const savedReply = (await readRequest()).messages[1].body;
        doc.md`## Read the response

Return to **Your trips** and open the request. Maya's reply appears in the same conversation. Once she accepts, its status reads **Accepted**. Reloading the page keeps the saved reply and status while this local service is running.

Maya's saved reply in this example:

> ${savedReply}

${outcome.embed("The guest sees Maya's saved reply and accepted stay")}

Stay is a fictional demo. Requests live in memory and disappear when its server restarts. It does not confirm a real reservation or charge you.`;
        await saveReview(guest, "guest-accepted");
      }
    },
  );
}
