import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { collectPlaywright } from "lgtmd/playwright";
import type { FrozenDocument } from "lgtmd";
import { startServer } from "./server/index.ts";
import { provision, dispose, type Workspace } from "./browser/fixture-api.ts";

export const root = fileURLToPath(new URL(".", import.meta.url));
export const guideTitles = [
  "Find a stay with filters",
  "Find a stay with AI",
  "Request a stay",
  "Respond to a stay request",
] as const;
export const siteOptions = {
  title: "Stay guides",
  navigation: [
    "find-a-stay",
    "find-with-ai",
    "request-a-stay",
    "respond-to-a-request",
  ],
};

export async function buildApp() {
  const child = spawn(
    process.execPath,
    [resolve(root, "../../node_modules/vite/bin/vite.js"), "build"],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
  const code = await new Promise<number | null>((done, reject) => {
    child.once("error", reject);
    child.once("close", done);
  });
  if (code !== 0) throw new Error(`Stay app build failed: ${code}`);
}

export interface CollectionOptions {
  mode?: "test" | "supplied";
  script?: "A" | "B";
  /** Deliberate integrity probes used by verify.ts, never successful evidence. */
  fault?: "assertion" | "cleanup" | "setup";
  /** Optional local audit after deletion and expired-session assertions pass. */
  onWorkspaceDisposed?: (id: string) => void;
}

/** Project-owned lifecycle. Neither the compiler nor the docs fixture starts the app. */
export async function collectStay({
  mode = process.env.STAY_MODE === "supplied" ? "supplied" : "test",
  script = process.env.STAY_SCRIPT === "B" ? "B" : "A",
  fault = process.env.STAY_FAULT as CollectionOptions["fault"],
  onWorkspaceDisposed,
}: CollectionOptions = {}): Promise<readonly FrozenDocument[]> {
  const fixtureKey = randomUUID();
  const server = await startServer({
    port: 0,
    fixtureKey,
    staticRoot: resolve(root, "dist"),
  });
  const acquired: Workspace[] = [];
  const environment = {
    STAY_APP_URL: server.url,
    STAY_FIXTURE_KEY: fixtureKey,
    STAY_MODE: mode,
    STAY_SCRIPT: script,
    STAY_FAULT: fault ?? "",
    STAY_SUPPLIED: "{}",
  };
  const previous = Object.fromEntries(
    Object.keys(environment).map((key) => [key, process.env[key]]),
  );
  let documents: readonly FrozenDocument[] | undefined;
  const errors: unknown[] = [];
  try {
    if (mode === "supplied") {
      const supplied: Record<string, Workspace> = {};
      for (const title of guideTitles) {
        const workspace = await provision(server.url, fixtureKey, script);
        acquired.push(workspace);
        if (fault === "setup")
          throw new Error("Deliberate Stay partial setup failure");
        supplied[title] = workspace;
      }
      environment.STAY_SUPPLIED = JSON.stringify(supplied);
    }
    Object.assign(process.env, environment);
    documents = await collectPlaywright({
      config: new URL("./playwright.config.ts", import.meta.url),
      cwd: root,
    });
  } catch (error) {
    errors.push(error);
  } finally {
    for (const workspace of acquired) {
      try {
        await dispose(server.url, fixtureKey, workspace);
        onWorkspaceDisposed?.(workspace.id);
      } catch (error) {
        errors.push(error);
      }
    }
    if (mode === "supplied" && fault === "cleanup")
      errors.push(new Error("Deliberate Stay outer cleanup failure"));
    try {
      await server.close();
    } catch (error) {
      errors.push(error);
    }
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1)
    throw new AggregateError(errors, "Stay collection and cleanup failed");
  if (!documents) throw new Error("Stay collection produced no documents");
  return documents;
}
