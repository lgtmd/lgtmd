import { test as base, expect } from "@playwright/test";
import { exampleRecords } from "../src/records.ts";

interface Workspace {
  url: string;
  conditions: string;
}

/** A normal project fixture: lgtmd knows nothing about this API or its state. */
export const test = base.extend<{ workspace: Workspace }>({
  workspace: async ({ request, baseURL }, use) => {
    const created = await request.post("/api/workspaces", {
      data: exampleRecords,
    });
    expect(created.status()).toBe(201);
    const { id, path } = await created.json();
    try {
      await use({
        url: new URL(path, baseURL).href,
        conditions:
          "An isolated project fixture supplies exactly three sample records.",
      });
    } finally {
      const deleted = await request.delete(`/api/workspaces/${id}`);
      expect(deleted.status()).toBe(204);
    }
  },
});

export { expect };
