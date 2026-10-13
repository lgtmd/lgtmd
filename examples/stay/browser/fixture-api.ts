import assert from "node:assert/strict";
import type { Sessions } from "../src/domain.ts";

export interface Workspace {
  id: string;
  sessions: Sessions;
}

export async function fixtureRequest(
  baseURL: string,
  key: string,
  path: string,
  method = "GET",
  data?: unknown,
) {
  return fetch(new URL(`/__fixtures${path}`, baseURL), {
    method,
    headers: {
      "x-stay-fixture-key": key,
      "content-type": "application/json",
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
}

export async function provision(
  baseURL: string,
  key: string,
  script: "A" | "B",
) {
  const response = await fixtureRequest(baseURL, key, "/workspaces", "POST", {
    script,
    failFirst: true,
    pause: true,
  });
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()) as Workspace;
}

export async function dispose(
  baseURL: string,
  key: string,
  workspace: Workspace,
) {
  const response = await fixtureRequest(
    baseURL,
    key,
    `/workspaces/${workspace.id}`,
    "DELETE",
  );
  assert.equal(response.status, 204, await response.clone().text());
  assert.equal(
    (await fixtureRequest(baseURL, key, `/workspaces/${workspace.id}`)).status,
    404,
  );
  const expired = await fetch(new URL("/api/requests", baseURL), {
    headers: { authorization: `Bearer ${workspace.sessions.guest.token}` },
  });
  assert.equal(
    expired.status,
    401,
    "Deleted workspace credentials must expire",
  );
}
