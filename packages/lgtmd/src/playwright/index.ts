import type {
  Fixtures,
  ReporterDescription,
  TestInfo,
  TestType,
} from "@playwright/test";
import { Doc } from "../authoring.js";
import {
  ATTACHMENT_NAME,
  ATTACHMENT_TYPE,
  REPORTER_PATH,
  type ReporterOptions,
} from "./reporter.js";

export { collectPlaywright, runPlaywright } from "./runner.js";
export type {
  CollectPlaywrightOptions,
  RunPlaywrightOptions,
} from "./runner.js";

/** Preserve an application's existing fixtures, assertions, and cleanup. */
export function withDocs<T extends object, W extends object>(
  test: TestType<T, W>,
): TestType<T & { doc: Doc }, W> {
  return test.extend<{ doc: Doc }>({
    doc: async ({}, use: (value: Doc) => Promise<void>, testInfo: TestInfo) => {
      const document = new Doc();
      await use(document);
      if (
        testInfo.status === "passed" &&
        testInfo.expectedStatus === "passed"
      ) {
        await testInfo.attach(ATTACHMENT_NAME, {
          body: Buffer.from(JSON.stringify(document.finish()), "utf8"),
          contentType: ATTACHMENT_TYPE,
        });
      }
    },
    // Playwright's mapped fixture type cannot resolve a new key for generic T/W.
    // The adapter contributes only this documented `doc` fixture.
  } as unknown as Fixtures<{ doc: Doc }, {}, T, W>);
}

/** Guard every optional custom reporter, including its final onExit callback. */
export function docsReporter(
  options: ReporterOptions = {},
): ReporterDescription[] {
  return [[REPORTER_PATH, options]];
}
