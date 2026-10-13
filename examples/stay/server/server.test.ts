import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  DemoSession,
  ReplyEvent,
  Sessions,
  StayRequest,
} from "../src/domain.ts";
import {
  FIXED_TIME,
  listings,
  replyScripts,
  stayInput,
} from "../fixtures/scenario.ts";
import { startServer } from "./index.ts";
import { replyPrompt } from "./provider.ts";

const fixtureKey = "stay-test-fixture-key";

async function api(
  url: string,
  token: string | undefined,
  path: string,
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

async function fixture(
  url: string,
  path: string,
  method = "GET",
  value?: unknown,
): Promise<Response> {
  return fetch(url + "/__fixtures/workspaces" + path, {
    method,
    headers: {
      "x-stay-fixture-key": fixtureKey,
      ...(value !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
}

interface Provisioned {
  id: string;
  sessions: Sessions;
}

async function provision(
  url: string,
  options: object = {},
): Promise<Provisioned> {
  const response = await fixture(url, "", "POST", options);
  assert.equal(response.status, 201);
  return response.json() as Promise<Provisioned>;
}

async function createRequest(url: string, token: string): Promise<StayRequest> {
  const response = await api(url, token, "/api/requests", "POST", stayInput);
  assert.equal(response.status, 201);
  return response.json() as Promise<StayRequest>;
}

function events(source: string): ReplyEvent[] {
  return source
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as ReplyEvent);
}

function generatedText(parts: ReplyEvent[]): string {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

test("demo sessions resolve identities; fixture controls require an enabled key", async (t) => {
  const server = await startServer({ port: 0 });
  t.after(() => server.close());
  assert.equal((await api(server.url, undefined, "/api/listings")).status, 401);
  assert.equal((await fixture(server.url, "", "POST", {})).status, 404);
  const response = await api(server.url, undefined, "/api/demo", "POST");
  assert.equal(response.status, 201);
  const sessions = (await response.json()) as Sessions;
  assert.notEqual(sessions.guest.token, sessions.host.token);
  assert.deepEqual(
    await (await api(server.url, sessions.guest.token, "/api/me")).json(),
    sessions.guest.actor,
  );
  assert.deepEqual(
    await (await api(server.url, sessions.host.token, "/api/me")).json(),
    sessions.host.actor,
  );
  assert.deepEqual(
    await (await api(server.url, sessions.guest.token, "/api/listings")).json(),
    listings,
  );
  assert.equal(
    (await api(server.url, sessions.guest.token, "/api/listings/missing"))
      .status,
    404,
  );
});

test("date, capacity, and message validation fail without creating partial requests", async (t) => {
  const server = await startServer({ port: 0, fixtureKey });
  t.after(() => server.close());
  const workspace = await provision(server.url);
  const token = workspace.sessions.guest.token;
  for (const change of [
    { checkIn: "2026-11-09", checkOut: "2026-11-06" },
    { checkOut: stayInput.checkIn },
    { checkIn: "2026-02-30" },
    { checkIn: "2026-2-01" },
    { guests: 0 },
    { guests: 5 },
    { guests: 1.5 },
    { guests: "2" },
    { message: "  " },
    { message: "a".repeat(2001) },
  ]) {
    const response = await api(server.url, token, "/api/requests", "POST", {
      ...stayInput,
      ...change,
    });
    assert.equal(response.status, 400, JSON.stringify(change));
    assert.equal(
      typeof ((await response.json()) as { error: string }).error,
      "string",
    );
  }
  const malformed = await fetch(server.url + "/api/requests", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: "{invalid",
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(
    await (await api(server.url, token, "/api/requests")).json(),
    [],
  );
  const request = await createRequest(server.url, token);
  assert.equal(request.id, "request-001");
  assert.equal(request.createdAt, FIXED_TIME);
  assert.equal(request.messages[0].createdAt, FIXED_TIME);
  assert.equal(
    (
      await api(
        server.url,
        token,
        `/api/requests/${request.id}/messages`,
        "POST",
        { body: " " },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await api(
        server.url,
        token,
        `/api/requests/${request.id}/messages`,
        "POST",
        { body: 42 },
      )
    ).status,
    400,
  );
});

test("server checks role, ownership, and workspace isolation for reads and mutations", async (t) => {
  const server = await startServer({ port: 0, fixtureKey });
  t.after(() => server.close());
  const first = await provision(server.url);
  const second = await provision(server.url);
  const guest = first.sessions.guest.token;
  const host = first.sessions.host.token;
  const request = await createRequest(server.url, guest);
  const path = `/api/requests/${request.id}`;
  assert.equal(
    (await api(server.url, host, "/api/requests", "POST", stayInput)).status,
    403,
  );
  assert.equal(
    (await api(server.url, guest, path + "/accept", "POST", { role: "host" }))
      .status,
    403,
  );
  assert.equal(
    (await api(server.url, guest, path + "/reply", "POST")).status,
    403,
  );
  for (const token of [
    second.sessions.guest.token,
    second.sessions.host.token,
  ]) {
    assert.equal((await api(server.url, token, path)).status, 404);
    assert.equal(
      (
        await api(server.url, token, path + "/messages", "POST", {
          body: "intrusion",
        })
      ).status,
      404,
    );
    assert.equal(
      (await api(server.url, token, path + "/accept", "POST")).status,
      404,
    );
    assert.equal(
      (await api(server.url, token, path + "/reply", "POST")).status,
      404,
    );
    assert.deepEqual(
      await (await api(server.url, token, "/api/requests")).json(),
      [],
    );
  }
  for (const role of ["guest", "host"]) {
    const response = await fixture(
      server.url,
      `/${first.id}/sessions`,
      "POST",
      { role },
    );
    const other = (await response.json()) as DemoSession;
    assert.equal(response.status, 201);
    assert.equal((await api(server.url, other.token, path)).status, 404);
    assert.equal(
      (
        await api(server.url, other.token, path + "/messages", "POST", {
          body: "intrusion",
        })
      ).status,
      404,
    );
    assert.equal(
      (await api(server.url, other.token, path + "/accept", "POST")).status,
      404,
    );
    assert.deepEqual(
      await (await api(server.url, other.token, "/api/requests")).json(),
      [],
    );
  }
  assert.deepEqual(await (await api(server.url, host, path)).json(), request);
});

test("sending a reply keeps pending; acceptance is idempotent and preserves history", async (t) => {
  const server = await startServer({ port: 0, fixtureKey });
  t.after(() => server.close());
  const workspace = await provision(server.url);
  const request = await createRequest(
    server.url,
    workspace.sessions.guest.token,
  );
  const path = `/api/requests/${request.id}`;
  const sent = await api(
    server.url,
    workspace.sessions.host.token,
    path + "/messages",
    "POST",
    { body: "The trail is lovely in November." },
  );
  const updated = (await sent.json()) as StayRequest;
  assert.equal(updated.status, "pending");
  assert.equal(updated.messages.length, 2);
  assert.deepEqual(updated.messages[0], request.messages[0]);
  assert.equal(updated.messages[1].id, "message-002");
  const accepted = (await (
    await api(
      server.url,
      workspace.sessions.host.token,
      path + "/accept",
      "POST",
    )
  ).json()) as StayRequest;
  assert.equal(accepted.status, "accepted");
  assert.deepEqual(accepted.messages, updated.messages);
  assert.deepEqual(
    await (
      await api(
        server.url,
        workspace.sessions.host.token,
        path + "/accept",
        "POST",
      )
    ).json(),
    accepted,
  );
  assert.deepEqual(
    await (await api(server.url, workspace.sessions.guest.token, path)).json(),
    accepted,
  );
});

test("SDK mock emits partial failure then successful retry, records exact context, and never sends", async (t) => {
  const server = await startServer({ port: 0, fixtureKey });
  t.after(() => server.close());
  const originalFetch = globalThis.fetch;
  const externalCalls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (url.hostname !== "127.0.0.1") {
      externalCalls.push(url.origin);
      throw new Error("External provider calls are forbidden in this example.");
    }
    return originalFetch(input, init);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const workspace = await provision(server.url, {
    failFirst: true,
    pause: false,
    script: "A",
  });
  const request = await createRequest(
    server.url,
    workspace.sessions.guest.token,
  );
  const path = `/api/requests/${request.id}`;
  const first = await api(
    server.url,
    workspace.sessions.host.token,
    path + "/reply",
    "POST",
  );
  assert.match(
    first.headers.get("content-type") ?? "",
    /application\/x-ndjson/,
  );
  const failed = events(await first.text());
  assert.equal(generatedText(failed), replyScripts.A[0]);
  assert.equal(failed.at(-1)?.type, "error");
  assert.equal(
    failed.some((event) => event.type === "done"),
    false,
  );
  assert.deepEqual(
    await (await api(server.url, workspace.sessions.guest.token, path)).json(),
    request,
  );
  const successful = events(
    await (
      await api(
        server.url,
        workspace.sessions.host.token,
        path + "/reply",
        "POST",
      )
    ).text(),
  );
  assert.equal(generatedText(successful), replyScripts.A.join(""));
  assert.deepEqual(successful.at(-1), { type: "done" });
  assert.deepEqual(
    await (await api(server.url, workspace.sessions.guest.token, path)).json(),
    request,
  );
  const recorded = (await (
    await fixture(server.url, `/${workspace.id}`)
  ).json()) as {
    provider: { calls: { attempt: number; prompt: unknown }[] };
  };
  assert.deepEqual(
    recorded.provider.calls.map((call) => call.attempt),
    [1, 2],
  );
  const expectedPrompt = [
    {
      role: "user",
      content: [{ type: "text", text: replyPrompt(listings[0], request) }],
    },
  ];
  assert.deepEqual(recorded.provider.calls[0].prompt, expectedPrompt);
  assert.deepEqual(recorded.provider.calls[1].prompt, expectedPrompt);
  assert.deepEqual(externalCalls, []);
});

test("project-owned stream gate exposes intermediate state and requires explicit release", async (t) => {
  const server = await startServer({ port: 0, fixtureKey });
  t.after(() => server.close());
  const workspace = await provision(server.url, {
    failFirst: false,
    pause: true,
  });
  const request = await createRequest(
    server.url,
    workspace.sessions.guest.token,
  );
  const response = await api(
    server.url,
    workspace.sessions.host.token,
    `/api/requests/${request.id}/reply`,
    "POST",
  );
  const reader = response.body!.getReader();
  const first = await reader.read();
  assert.equal(
    generatedText(events(new TextDecoder().decode(first.value))),
    replyScripts.A[0],
  );
  const paused = (await (
    await fixture(server.url, `/${workspace.id}`)
  ).json()) as { provider: { paused: boolean; released: boolean } };
  assert.equal(paused.provider.paused, true);
  assert.equal(paused.provider.released, false);
  assert.equal(
    (
      await api(
        server.url,
        workspace.sessions.host.token,
        `/api/requests/${request.id}/reply`,
        "POST",
      )
    ).status,
    409,
  );
  assert.equal(
    (await fixture(server.url, `/${workspace.id}/release`, "POST")).status,
    200,
  );
  let source = new TextDecoder().decode(first.value);
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    source += new TextDecoder().decode(next.value);
  }
  const completed = events(source);
  assert.equal(generatedText(completed), replyScripts.A.join(""));
  assert.deepEqual(completed.at(-1), { type: "done" });
});

test("A and B fixtures produce distinct declared text; deletion invalidates every session", async (t) => {
  const server = await startServer({ port: 0, fixtureKey });
  t.after(() => server.close());
  const generated: string[] = [];
  for (const script of ["A", "B"] as const) {
    const workspace = await provision(server.url, { script, failFirst: false });
    const request = await createRequest(
      server.url,
      workspace.sessions.guest.token,
    );
    const result = events(
      await (
        await api(
          server.url,
          workspace.sessions.host.token,
          `/api/requests/${request.id}/reply`,
          "POST",
        )
      ).text(),
    );
    generated.push(generatedText(result));
    assert.equal(generatedText(result), replyScripts[script].join(""));
    assert.equal(
      (await fixture(server.url, `/${workspace.id}`, "DELETE")).status,
      204,
    );
    assert.equal((await fixture(server.url, `/${workspace.id}`)).status, 404);
    for (const session of Object.values(workspace.sessions))
      assert.equal(
        (await api(server.url, session.token, "/api/me")).status,
        401,
      );
  }
  assert.notEqual(generated[0], generated[1]);
});

test("cleanup cancels a paused stream without successful completion", async (t) => {
  const server = await startServer({ port: 0, fixtureKey });
  t.after(() => server.close());
  const workspace = await provision(server.url, {
    failFirst: false,
    pause: true,
  });
  const request = await createRequest(
    server.url,
    workspace.sessions.guest.token,
  );
  const response = await api(
    server.url,
    workspace.sessions.host.token,
    `/api/requests/${request.id}/reply`,
    "POST",
  );
  const reader = response.body!.getReader();
  const first = await reader.read();
  assert.equal(events(new TextDecoder().decode(first.value))[0].type, "text");
  assert.equal(
    (await fixture(server.url, `/${workspace.id}`, "DELETE")).status,
    204,
  );
  let remainder = "";
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    remainder += new TextDecoder().decode(next.value);
  }
  assert.equal(remainder.includes('"done"'), false);
  assert.equal((await fixture(server.url, `/${workspace.id}`)).status, 404);
  assert.equal(
    (await api(server.url, workspace.sessions.host.token, "/api/me")).status,
    401,
  );
});

test("a listener collision fails instead of attaching to an existing service", async (t) => {
  const server = await startServer({ port: 0 });
  t.after(() => server.close());
  await assert.rejects(
    startServer({ port: Number(new URL(server.url).port) }),
    { code: "EADDRINUSE" },
  );
  assert.deepEqual(await (await fetch(server.url + "/api/health")).json(), {
    ready: true,
  });
});

test(
  "shutdown cancels a paused stream without waiting for the browser to drain it",
  { timeout: 2000 },
  async (t) => {
    const server = await startServer({ port: 0, fixtureKey });
    t.after(() => server.close());
    const workspace = await provision(server.url, {
      failFirst: false,
      pause: true,
    });
    const request = await createRequest(
      server.url,
      workspace.sessions.guest.token,
    );
    const response = await api(
      server.url,
      workspace.sessions.host.token,
      `/api/requests/${request.id}/reply`,
      "POST",
    );
    const reader = response.body!.getReader();
    await reader.read();
    await server.close();
    await assert.rejects(reader.read());
    await server.close();
  },
);

test(
  "shutdown completes after a browser disconnects during a paused stream",
  { timeout: 2000 },
  async (t) => {
    const server = await startServer({ port: 0, fixtureKey });
    t.after(() => server.close());
    const workspace = await provision(server.url, {
      failFirst: false,
      pause: true,
    });
    const request = await createRequest(
      server.url,
      workspace.sessions.guest.token,
    );
    const response = await api(
      server.url,
      workspace.sessions.host.token,
      `/api/requests/${request.id}/reply`,
      "POST",
    );
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await server.close();
  },
);

test("production files share the API listener with correct MIME and path confinement", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "stay-static-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, "dist");
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(join(root, "index.html"), "<main>Stay</main>");
  await writeFile(
    join(root, "assets", "main.js"),
    "export const app = 'Stay';",
  );
  await writeFile(join(directory, "private.txt"), "not served");
  await symlink(join(directory, "private.txt"), join(root, "linked.txt"));
  const server = await startServer({ port: 0, staticRoot: root });
  t.after(() => server.close());
  assert.equal(
    await (await fetch(server.url + "/guest/trips")).text(),
    "<main>Stay</main>",
  );
  const script = await fetch(server.url + "/assets/main.js");
  assert.match(script.headers.get("content-type") ?? "", /text\/javascript/);
  assert.equal(await script.text(), "export const app = 'Stay';");
  assert.equal((await fetch(server.url + "/assets/missing.js")).status, 404);
  assert.equal((await fetch(server.url + "/linked.txt")).status, 404);
  assert.equal((await fetch(server.url + "/%2e%2e%2fprivate.txt")).status, 404);
  assert.deepEqual(await (await fetch(server.url + "/api/health")).json(), {
    ready: true,
  });
});
