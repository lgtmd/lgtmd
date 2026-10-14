import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Locator, Page } from "@playwright/test";
import type { Doc } from "lgtmd";
import { withDocs } from "lgtmd/playwright";
import { test as applicationTest, expect } from "./application-test.ts";
import { captureWebp, webpProfile } from "../../review/capture.mjs";
import type { AssistantConversation } from "../src/assistant-domain.ts";

const test = withDocs(applicationTest);

async function ready(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode()));
  });
  await page.mouse.move(0, 0);
  await page.locator("main").evaluate((element) => {
    element.setAttribute("tabindex", "-1");
    (element as HTMLElement).focus({ preventScroll: true });
  });
}

async function image(
  doc: Doc,
  page: Page,
  id: string,
  surface: Locator = page.locator("main"),
) {
  await ready(page);
  return doc.assets.image(id, await captureWebp(surface), {
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

test("Find a stay with AI", async ({ application, baseURL, doc }) => {
  doc.page({ id: "find-with-ai", title: "Find a stay with AI" });
  const page = await application.guest.newPage();
  const readConversation = async () => {
    const response = await page.request.get(
      new URL("/api/assistant", baseURL).href,
      {
        headers: {
          authorization: `Bearer ${application.workspace.sessions.guest.token}`,
        },
      },
    );
    expect(response.status()).toBe(200);
    return (await response.json()) as AssistantConversation;
  };
  await page.goto("/#/");
  await page.getByRole("link", { name: "Ask Stay", exact: true }).click();
  await expect(page).toHaveURL(/#\/assistant$/);
  await expect(
    page.getByRole("heading", { name: "Find your kind of stay", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Scripted demo", { exact: true })).toBeVisible();
  const composer = page.getByRole("textbox", {
    name: "What are you looking for?",
    exact: true,
  });
  const send = page.getByRole("button", { name: "Send message", exact: true });
  const turns = page.getByTestId("assistant-turn");
  const prompts: string[] = [];
  const sendMessage = async (message: string, listingIds: string[]) => {
    prompts.push(message);
    await composer.fill(message);
    await send.click();
    await expect(turns).toHaveCount(prompts.length);
    await expect(composer).toHaveValue("");
    await expect(composer).toBeInViewport();
    await expect(send).toBeInViewport();
    const conversation = await readConversation();
    expect(
      conversation.messages
        .filter((entry) => entry.role === "user")
        .map((entry) => entry.text),
    ).toEqual(prompts);
    expect(conversation.messages).toHaveLength(prompts.length * 2);
    expect(conversation.messages.at(-1)).toMatchObject({
      role: "assistant",
      listingIds,
    });
    await expect(turns.last().getByRole("link")).toHaveCount(listingIds.length);
    return conversation;
  };

  expect((await readConversation()).messages).toEqual([]);
  const introduction = doc.md`Open **Ask Stay** to describe the kind of place you want. Mention your nightly budget, the size of your group and amenities that matter to you. The reply appears as it streams in. Stay keeps those preferences after the reply completes, and you can scroll back through earlier replies while the message box stays in place.

This example uses a **scripted demo**, not a live AI service. It matches the three sample stays in this local app; it does not check dates or real availability.

## Start with what matters

Ask for **a quiet stay for 3 guests under $200 with a kitchen**. Cedar House fits the guest count, nightly budget and kitchen requirement. Open its card to inspect the property before sending a request.`;
  const receipt = doc.assets.text(
    "fixture-receipt",
    `stay-private-fixture-receipt\n${application.conditions}`,
  );
  doc.noteOn(
    introduction,
  )`${application.conditions} ${receipt.link("Fixture ownership")}
The server uses a local AI SDK mock with deterministic preference extraction and matches against the supplied collection. These checks verify persisted preferences, grounded listing IDs and the browser workflow, not model quality or the subjective meaning of quiet.`;

  const first = await sendMessage(
    "A quiet stay for 3 guests under $200 with a kitchen",
    ["cedar-house"],
  );
  expect(first.preferences).toMatchObject({
    guests: 3,
    maxPrice: 200,
    amenities: ["Full kitchen"],
  });
  await expect(
    turns.last().getByRole("link", { name: "Cedar House", exact: true }),
  ).toBeVisible();
  const firstMatch = await image(doc, page, "first-recommendation");
  doc.md`${firstMatch.embed("Stay recommends Cedar House for three guests within the nightly budget")}`;
  await saveReview(page, "assistant-first-match");

  await turns
    .last()
    .getByRole("link", { name: "Cedar House", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Cedar House", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(turns).toHaveCount(1);
  expect(await readConversation()).toEqual(first);
  await page.reload();
  await expect(turns).toHaveCount(1);
  expect(await readConversation()).toEqual(first);

  const refined = await sendMessage("Actually 2 guests and under $150", [
    "courtyard-loft",
  ]);
  expect(refined.preferences).toMatchObject({
    guests: 2,
    maxPrice: 150,
    amenities: ["Full kitchen"],
  });
  await expect(
    turns.last().getByRole("link", { name: "Courtyard Loft", exact: true }),
  ).toBeVisible();
  const changedMind = await image(
    doc,
    page,
    "refined-recommendation",
    turns.last(),
  );
  doc.md`## Change your plans

Follow up with **Actually 2 guests and under $150**. Stay updates the group size and budget, while keeping the kitchen preference. Courtyard Loft is the new match. Previous replies stay in the conversation so you can compare the options.

${changedMind.embed("The next reply recommends Courtyard Loft for the revised preferences")}

Opening a listing and returning preserves your chat. Reloading also keeps it while this local service is running.`;

  const empty = await sendMessage("Ocean view under $150", []);
  expect(empty.preferences).toMatchObject({
    guests: 2,
    maxPrice: 150,
    amenities: expect.arrayContaining(["Full kitchen", "Ocean view"]),
  });
  await expect(
    turns
      .last()
      .getByRole("heading", { name: "No matching stays yet", exact: true }),
  ).toBeVisible();
  const noMatches = await image(doc, page, "no-recommendations", turns.last());
  doc.md`## Widen a preference when nothing fits

Adding **Ocean view under $150** leaves no matching stay. The chat shows that outcome rather than inventing a property. Try a different amenity or a higher budget.

${noMatches.embed("Stay explains that no sample property matches the ocean-view request within budget")}`;

  const recovered = await sendMessage("Raise my budget to $220", [
    "coast-cabin",
  ]);
  expect(recovered.preferences).toMatchObject({
    guests: 2,
    maxPrice: 220,
    amenities: expect.arrayContaining(["Full kitchen", "Ocean view"]),
  });
  await expect(
    turns.last().getByRole("link", { name: "Coast Cabin", exact: true }),
  ).toBeVisible();
  const coast = await image(
    doc,
    page,
    "recovered-recommendation",
    turns.last(),
  );
  doc.md`**Raise my budget to $220** keeps the guest count and amenities, and brings Coast Cabin into reach.

${coast.embed("Coast Cabin matches after the nightly budget increases")}

Choose **New chat** to clear the conversation and its saved preferences. This starts a fresh search; it does not change any stay requests you have already sent.

Stay's conversations live in memory and disappear when the local server restarts. Its scripted replies help demonstrate the workflow; review each listing's details before requesting a stay.`;
  await saveReview(page, "assistant-recovery");
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(turns).toHaveCount(0);
  expect(await readConversation()).toEqual({
    messages: [],
    preferences: {
      query: "",
      minPrice: null,
      maxPrice: null,
      guests: 1,
      amenities: [],
    },
  });
});
