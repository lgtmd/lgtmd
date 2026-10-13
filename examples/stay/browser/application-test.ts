import { test as base, expect, type BrowserContext } from "@playwright/test";
import { provision, dispose, type Workspace } from "./fixture-api.ts";
import { ROLE_KEY, SESSION_KEY, type Role } from "../src/domain.ts";

interface Application {
  workspace: Workspace;
  guest: BrowserContext;
  host: BrowserContext;
  conditions: string;
}

export const test = base.extend<{ application: Application }>({
  application: async ({ browser, baseURL }, use, testInfo) => {
    const key = process.env.STAY_FIXTURE_KEY!;
    const mode = process.env.STAY_MODE ?? "test";
    const supplied = JSON.parse(process.env.STAY_SUPPLIED ?? "{}") as Record<
      string,
      Workspace
    >;
    const workspace =
      mode === "supplied"
        ? supplied[testInfo.title]
        : await provision(
            baseURL!,
            key,
            process.env.STAY_SCRIPT === "B" ? "B" : "A",
          );
    if (!workspace)
      throw new Error(`No supplied workspace for ${testInfo.title}`);
    const contexts: BrowserContext[] = [];
    const errors: unknown[] = [];
    try {
      for (const role of ["guest", "host"] as Role[]) {
        const context = await browser.newContext({
          baseURL,
          viewport: { width: 1280, height: 900 },
          locale: "en-US",
          timezoneId: "UTC",
          colorScheme: "light",
          reducedMotion: "reduce",
        });
        contexts.push(context);
        await context.addInitScript(
          ({ sessions, role, sessionKey, roleKey }) => {
            if (location.origin === "null") return;
            sessionStorage.setItem(sessionKey, JSON.stringify(sessions));
            sessionStorage.setItem(roleKey, role);
          },
          {
            sessions: workspace.sessions,
            role,
            sessionKey: SESSION_KEY,
            roleKey: ROLE_KEY,
          },
        );
      }
      await use({
        workspace,
        guest: contexts[0],
        host: contexts[1],
        conditions:
          mode === "supplied"
            ? "A supplied sandbox belongs to the outer application runner. It cleans up after the complete browser collection."
            : "An ordinary Playwright fixture provisions this isolated workspace and asserts deletion during teardown.",
      });
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
      if (mode !== "supplied") {
        try {
          await dispose(baseURL!, key, workspace);
        } catch (error) {
          errors.push(error);
        }
        if (process.env.STAY_FAULT === "cleanup")
          errors.push(new Error("Deliberate Stay fixture cleanup failure"));
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1)
      throw new AggregateError(errors, "Stay fixture and cleanup failed");
  },
});

export { expect };
