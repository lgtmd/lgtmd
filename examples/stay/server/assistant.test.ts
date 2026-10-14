import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { assistantStreamGate } from "../fixtures/assistant-stream.ts";
import { listings } from "../fixtures/scenario.ts";
import type { AssistantConversation } from "../src/assistant-domain.ts";
import type { DemoSession, Sessions } from "../src/domain.ts";
import { defaultFilters } from "../src/filters.ts";
import {
  AssistantError,
  StayAssistant,
  updatePreferences,
} from "./assistant.ts";
import { startServer } from "./index.ts";

type StreamResult = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
type StreamPart =
  StreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;

function generated(text: string): StreamResult {
  return {
    stream: new ReadableStream<StreamPart>({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "reply" });
        controller.enqueue({ type: "text-delta", id: "reply", delta: text });
        controller.enqueue({ type: "text-end", id: "reply" });
        controller.enqueue({
          type: "finish",
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: {
              total: 0,
              noCache: 0,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 0, text: 0, reasoning: undefined },
          },
        });
        controller.close();
      },
    }),
  };
}

function recommendations(conversation: AssistantConversation): string[] {
  return conversation.messages.at(-1)?.listingIds ?? [];
}

const prompts = [
  "A quiet stay for 3 guests under $200 with a kitchen",
  "Actually 2 guests and under $150",
  "Ocean view under $150",
  "Raise my budget to $220",
] as const;

test("scripted stay finder refines grounded matches without external calls", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    assert.fail("The stay finder must not call an external service.");
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const assistant = new StayAssistant(listings);
  assert.deepEqual(assistant.read(), {
    messages: [],
    preferences: defaultFilters(),
  });
  const expected = [["cedar-house"], ["courtyard-loft"], [], ["coast-cabin"]];
  for (const [index, prompt] of prompts.entries()) {
    const result = await assistant.send(prompt);
    assert.deepEqual(recommendations(result), expected[index]);
    assert.equal(result.messages.length, (index + 1) * 2);
    assert.equal(result.messages.at(-2)?.text, prompt);
    assert.equal(result.messages.at(-2)?.role, "user");
    assert.equal(result.messages.at(-1)?.role, "assistant");
    assert.equal(
      result.messages.at(-1)?.id,
      `assistant-message-${String((index + 1) * 2).padStart(3, "0")}`,
    );
  }
  const final = assistant.read();
  assert.deepEqual(final.preferences, {
    ...defaultFilters(),
    guests: 2,
    maxPrice: 220,
    amenities: ["Full kitchen", "Ocean view"],
  });
  assert.match(
    final.messages[5].text,
    /^No stays in this demo collection match/,
  );
  assert.match(
    final.messages[7].text,
    /Coast Cabin is \$210 per night and sleeps 3/,
  );
  assert.doesNotMatch(final.messages[1].text, /quiet|available|booked/i);
  assert.deepEqual(assistant.reset(), {
    messages: [],
    preferences: defaultFilters(),
  });
});

test("recognized locations and amenity aliases can be amended or removed", () => {
  assert.deepEqual(
    updatePreferences(
      defaultFilters(),
      "Somewhere by the ocean for 2 guests",
      listings,
    ),
    { ...defaultFilters(), guests: 2, amenities: ["Ocean view"] },
  );
  let filters = updatePreferences(
    defaultFilters(),
    "Portland with wifi and a kitchen, up to $142",
    listings,
  );
  assert.deepEqual(filters, {
    ...defaultFilters(),
    query: "Portland",
    maxPrice: 142,
    amenities: ["Full kitchen", "Wi-Fi"],
  });
  filters = updatePreferences(
    filters,
    "Anywhere, no wifi, no budget limit, and without a kitchen",
    listings,
  );
  assert.deepEqual(filters, defaultFilters());
  filters = updatePreferences(
    filters,
    "In Boston for 2 guests with an ocean view",
    listings,
  );
  assert.equal(filters.query, "Boston");
  assert.equal(filters.guests, 2);
  assert.deepEqual(filters.amenities, ["Ocean view"]);
  filters = updatePreferences(
    filters,
    "Reset my search. Mendocino under $220 with a deck",
    listings,
  );
  assert.deepEqual(filters, {
    ...defaultFilters(),
    query: "Mendocino",
    maxPrice: 220,
    amenities: ["Private deck"],
  });
  for (const negative of [
    "I don't want a kitchen",
    "not with a kitchen",
    "a kitchen is not required",
  ]) {
    const removed = updatePreferences(
      { ...defaultFilters(), amenities: ["Full kitchen"] },
      negative,
      listings,
    );
    assert.deepEqual(removed.amenities, [], negative);
  }
});

test("minimum prices require price context and do not consume guest or night counts", async () => {
  for (const guests of [3, 300]) {
    const assistant = new StayAssistant(listings);
    const result = await assistant.send(
      `At least ${guests} guests under $200 with a kitchen`,
    );
    assert.deepEqual(result.preferences, {
      ...defaultFilters(),
      guests,
      maxPrice: 200,
      amenities: ["Full kitchen"],
    });
    assert.deepEqual(
      recommendations(result),
      guests === 3 ? ["cedar-house"] : [],
    );
  }
  for (const count of [
    "At least 3 nights",
    "Minimum 3 nights",
    "Minimum 3 guests",
    "Minimum price 3 nights",
  ]) {
    const preferences = updatePreferences(
      defaultFilters(),
      `${count} under $200`,
      listings,
    );
    assert.equal(preferences.minPrice, null, count);
    assert.equal(preferences.maxPrice, 200, count);
  }
  for (const price of [
    "At least $180",
    "Minimum price 180",
    "Minimum budget $180",
    "Minimum nightly rate $180",
  ]) {
    const assistant = new StayAssistant(listings);
    const result = await assistant.send(
      `${price} per night, under $200, for 3 guests`,
    );
    assert.equal(result.preferences.minPrice, 180, price);
    assert.deepEqual(recommendations(result), ["cedar-house"], price);
  }
});

test("upper budget limits preserve price wording and exclude guest or night counts", () => {
  for (const wording of [
    "under 200",
    "up to $200",
    "at most $200",
    "budget of $200",
    "raise my budget to $200",
  ]) {
    const preferences = updatePreferences(
      defaultFilters(),
      `For 3 guests, ${wording} per night`,
      listings,
    );
    assert.equal(preferences.maxPrice, 200, wording);
    assert.equal(preferences.guests, 3, wording);
  }
  for (const count of [
    "up to 3 guests",
    "at most 3 guests",
    "up to 3 nights",
    "at most 3 days",
  ]) {
    const preferences = updatePreferences(
      { ...defaultFilters(), maxPrice: 200 },
      `Actually ${count}`,
      listings,
    );
    assert.equal(preferences.maxPrice, 200, count);
  }
});

test("unsupported-only preferences ask for supported criteria without presenting matches", async () => {
  const assistant = new StayAssistant(listings);
  const clarification = await assistant.send(
    "A quiet romantic retreat that welcomes pets",
  );
  assert.deepEqual(recommendations(clarification), []);
  assert.deepEqual(clarification.preferences, defaultFilters());
  assert.equal(clarification.messages.at(-1)?.listingIds, undefined);
  assert.match(
    clarification.messages.at(-1)!.text,
    /Other preferences are not interpreted/,
  );
  const applied = await assistant.send(prompts[0]);
  const followup = await assistant.send("Does it have accessible bathrooms?");
  assert.deepEqual(recommendations(followup), []);
  assert.deepEqual(followup.preferences, applied.preferences);
});

test("registered listing data and returned conversations cannot mutate evidence", async () => {
  const source = structuredClone(listings);
  const assistant = new StayAssistant(source);
  source[0].nightlyRate = 900;
  source[0].amenities.length = 0;
  const result = await assistant.send(prompts[0]);
  assert.deepEqual(recommendations(result), ["cedar-house"]);
  result.messages[1].listingIds!.push("invented-listing");
  result.messages.length = 0;
  result.preferences.amenities.length = 0;
  const retained = assistant.read();
  assert.equal(retained.messages.length, 2);
  assert.deepEqual(recommendations(retained), ["cedar-house"]);
  assert.deepEqual(retained.preferences.amenities, ["Full kitchen"]);
});

test("invalid input and inconsistent preferences leave conversation unchanged", async () => {
  const assistant = new StayAssistant(listings);
  const retained = await assistant.send(prompts[0]);
  for (const invalid of [
    undefined,
    {},
    [],
    42,
    " ",
    "a".repeat(1001),
    "for 0 guests",
    "for -3 guests",
    "for 1.5 guests",
    "at least $300 and under $200",
    "under $150.999",
    "at least $150.999",
    "under -$150",
    "under Infinity",
    "under $1e309",
    `under $${"9".repeat(310)}`,
  ]) {
    await assert.rejects(
      assistant.send(invalid),
      (error: unknown) =>
        error instanceof AssistantError && error.status === 400,
    );
    assert.deepEqual(assistant.read(), retained);
  }
});

test("failed or inconsistent mock output does not append messages or preferences", async () => {
  let outcome: "success" | "error" | "wrong-text" = "success";
  const promptsSeen: unknown[] = [];
  const assistant = new StayAssistant(
    listings,
    (response) =>
      new MockLanguageModelV4({
        doStream: async (options) => {
          promptsSeen.push(structuredClone(options.prompt));
          if (outcome === "error") throw new Error("Declared provider failure");
          return generated(
            outcome === "wrong-text"
              ? "An invented hotel is available."
              : response,
          );
        },
      }),
  );
  const retained = await assistant.send(prompts[0]);
  for (const failure of ["error", "wrong-text"] as const) {
    outcome = failure;
    await assert.rejects(
      assistant.send(prompts[1]),
      (error: unknown) =>
        error instanceof AssistantError && error.status === 503,
    );
    assert.deepEqual(assistant.read(), retained);
  }
  outcome = "success";
  assert.deepEqual(recommendations(await assistant.send(prompts[1])), [
    "courtyard-loft",
  ]);
  assert.equal(promptsSeen.length, 4);
  const recorded = JSON.stringify(promptsSeen.at(-1));
  assert.match(recorded, /Recognized preferences/);
  assert.match(recorded, /Matching listings/);
  assert.match(recorded, /Courtyard Loft/);
  assert.match(recorded, /Previous conversation/);
});

test("concurrent sends and reset cannot overwrite a pending turn", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const assistant = new StayAssistant(
    listings,
    (response) =>
      new MockLanguageModelV4({
        doStream: async () => {
          await gate;
          return generated(response);
        },
      }),
  );
  const pending = assistant.send(prompts[0]);
  try {
    await assert.rejects(
      assistant.send(prompts[1]),
      (error: unknown) =>
        error instanceof AssistantError && error.status === 409,
    );
    assert.throws(
      () => assistant.reset(),
      (error: unknown) =>
        error instanceof AssistantError && error.status === 409,
    );
    assert.deepEqual(assistant.read(), {
      messages: [],
      preferences: defaultFilters(),
    });
  } finally {
    release();
  }
  assert.deepEqual(recommendations(await pending), ["cedar-house"]);
});

async function api(
  url: string,
  token: string | undefined,
  path = "/api/assistant",
  method = "GET",
  value?: unknown,
): Promise<Response> {
  return fetch(url + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(value !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
}

const fixtureKey = "stay-assistant-test-key";
async function fixture(
  url: string,
  path: string,
  method: string,
  value?: unknown,
): Promise<Response> {
  return fetch(url + "/__fixtures/workspaces" + path, {
    method,
    headers: {
      "x-stay-fixture-key": fixtureKey,
      "content-type": "application/json",
    },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
}

async function provision(
  url: string,
): Promise<{ id: string; sessions: Sessions }> {
  const response = await fixture(url, "", "POST", {});
  assert.equal(response.status, 201);
  return response.json() as Promise<{ id: string; sessions: Sessions }>;
}

test("assistant HTTP API persists refinements and reset without host reply calls or bookings", async (t) => {
  const server = await startServer({ port: 0, fixtureKey });
  t.after(() => server.close());
  const workspace = await provision(server.url);
  const token = workspace.sessions.guest.token;
  const expected = [["cedar-house"], ["courtyard-loft"], [], ["coast-cabin"]];
  for (const [index, message] of prompts.entries()) {
    const response = await api(
      server.url,
      token,
      "/api/assistant/messages",
      "POST",
      { message },
    );
    assert.equal(response.status, 200);
    const conversation = (await response.json()) as AssistantConversation;
    assert.deepEqual(recommendations(conversation), expected[index]);
    assert.deepEqual(await (await api(server.url, token)).json(), conversation);
  }
  assert.deepEqual(
    await (await api(server.url, token, "/api/requests")).json(),
    [],
  );
  const audit = (await (
    await fixture(server.url, `/${workspace.id}`, "GET")
  ).json()) as { provider: { calls: unknown[] } };
  assert.deepEqual(audit.provider.calls, []);
  const reset = await api(
    server.url,
    token,
    "/api/assistant/reset",
    "POST",
    {},
  );
  assert.equal(reset.status, 200);
  assert.deepEqual(await reset.json(), {
    messages: [],
    preferences: defaultFilters(),
  });
});

test("guest-count chat follow-ups retain the existing budget and grounded Cedar match", async (t) => {
  const server = await startServer({ port: 0, fixtureKey });
  t.after(() => server.close());
  for (const quantifier of ["up to", "at most"]) {
    const workspace = await provision(server.url);
    const token = workspace.sessions.guest.token;
    const first = await api(
      server.url,
      token,
      "/api/assistant/messages",
      "POST",
      { message: "A stay under $200 with a kitchen" },
    );
    assert.equal(first.status, 200);
    const before = (await first.json()) as AssistantConversation;
    const response = await api(
      server.url,
      token,
      "/api/assistant/messages",
      "POST",
      { message: `Actually ${quantifier} 3 guests` },
    );
    assert.equal(response.status, 200);
    const updated = (await response.json()) as AssistantConversation;
    assert.deepEqual(updated.preferences, {
      ...defaultFilters(),
      maxPrice: 200,
      guests: 3,
      amenities: ["Full kitchen"],
    });
    assert.deepEqual(recommendations(updated), ["cedar-house"]);
    assert.deepEqual(updated.messages.slice(0, 2), before.messages);
    assert.deepEqual(await (await api(server.url, token)).json(), updated);
  }
});

test("assistant API enforces role, guest ownership, workspace and credential lifetime", async (t) => {
  const server = await startServer({ port: 0, fixtureKey });
  t.after(() => server.close());
  const first = await provision(server.url);
  const second = await provision(server.url);
  const token = first.sessions.guest.token;
  assert.equal((await api(server.url, undefined)).status, 401);
  const retained = await (
    await api(server.url, token, "/api/assistant/messages", "POST", {
      message: prompts[0],
    })
  ).json();
  for (const [path, method, value] of [
    ["/api/assistant", "GET", undefined],
    ["/api/assistant/messages", "POST", { message: prompts[0] }],
    ["/api/assistant/reset", "POST", {}],
  ] as const) {
    assert.equal(
      (await api(server.url, first.sessions.host.token, path, method, value))
        .status,
      403,
    );
  }
  assert.deepEqual(
    await (await api(server.url, second.sessions.guest.token)).json(),
    { messages: [], preferences: defaultFilters() },
  );
  await api(
    server.url,
    second.sessions.guest.token,
    "/api/assistant/reset",
    "POST",
    {},
  );
  const other = (await (
    await fixture(server.url, `/${first.id}/sessions`, "POST", {
      role: "guest",
    })
  ).json()) as DemoSession;
  assert.deepEqual(await (await api(server.url, other.token)).json(), {
    messages: [],
    preferences: defaultFilters(),
  });
  await api(server.url, other.token, "/api/assistant/messages", "POST", {
    message: prompts[1],
  });
  assert.deepEqual(await (await api(server.url, token)).json(), retained);
  assert.equal(
    (await fixture(server.url, `/${first.id}`, "DELETE")).status,
    204,
  );
  for (const expired of [token, other.token])
    assert.equal((await api(server.url, expired)).status, 401);
});

test("assistant rejects malformed input and client-selected history without mutations", async (t) => {
  const server = await startServer({ port: 0, fixtureKey });
  t.after(() => server.close());
  const workspace = await provision(server.url);
  const token = workspace.sessions.guest.token;
  const retained = await (
    await api(server.url, token, "/api/assistant/messages", "POST", {
      message: prompts[0],
    })
  ).json();
  for (const value of [
    null,
    [],
    {},
    { message: " " },
    { message: 42 },
    { message: "a".repeat(1001) },
    { message: "hello", workspaceId: "other" },
    { message: "hello", messages: [] },
  ]) {
    assert.equal(
      (await api(server.url, token, "/api/assistant/messages", "POST", value))
        .status,
      400,
    );
    assert.deepEqual(await (await api(server.url, token)).json(), retained);
  }
  assert.equal(
    (
      await api(server.url, token, "/api/assistant/reset", "POST", {
        workspaceId: "other",
      })
    ).status,
    400,
  );
  const malformed = await fetch(server.url + "/api/assistant/messages", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: "{invalid",
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await (await api(server.url, token)).json(), retained);
});

test("partial streams do not commit; errors, truncation and cancellation preserve history", async () => {
  for (const outcome of ["success", "error", "truncated", "abort"] as const) {
    const gate = assistantStreamGate();
    const assistant = new StayAssistant(listings, gate.model);
    const controller = new AbortController();
    const stream = assistant.stream(prompts[0], controller.signal);
    try {
      const first = await stream.next();
      assert.equal(first.value?.type, "text");
      assert.deepEqual(assistant.read().messages, []);
      assert.throws(() => assistant.reset(), { status: 409 });
      if (outcome === "abort") controller.abort();
      else gate.finish(outcome);
      const events = [];
      if (outcome === "error" || outcome === "truncated") {
        await assert.rejects(
          async () => {
            for await (const event of stream) events.push(event);
          },
          { status: 503 },
        );
      } else {
        for await (const event of stream) events.push(event);
      }
      if (outcome === "success") {
        assert.equal(events.at(-1)?.type, "done");
        assert.deepEqual(recommendations(assistant.read()), ["cedar-house"]);
      } else {
        assert.deepEqual(assistant.read(), {
          messages: [],
          preferences: defaultFilters(),
        });
        assert(!events.some((event) => event.type === "done"));
      }
      assistant.reset();
    } finally {
      controller.abort();
      gate.finish("truncated");
      await stream.return(undefined);
    }
  }
});

test("assistant HTTP streams text before completion and shutdown cancels pending work", async () => {
  const gate = assistantStreamGate();
  const server = await startServer({
    port: 0,
    fixtureKey,
    assistantModelFactory: gate.model,
  });
  try {
    const workspace = await provision(server.url);
    const token = workspace.sessions.guest.token;
    const response = await fetch(server.url + "/api/assistant/messages", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/x-ndjson",
      },
      body: JSON.stringify({ message: prompts[0] }),
    });
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-type")!,
      /application\/x-ndjson/,
    );
    const reader = response.body!.getReader();
    const first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /"type":"text"/);
    assert.deepEqual(
      (await (await api(server.url, token)).json()).messages,
      [],
    );
    await server.close();
    await gate.cancelled;
    await reader.cancel().catch(() => {});
  } finally {
    gate.finish("truncated");
    await server.close();
  }
});
