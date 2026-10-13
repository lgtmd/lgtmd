import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
  TestResult,
  TestStep,
} from "@playwright/test/reporter";
import type { FrozenDocument } from "../model.js";
import { ReporterGuard } from "./guard.js";

export const ATTACHMENT_NAME = "lgtmd-document-v1";
export const ATTACHMENT_TYPE = "application/vnd.lgtmd.document+json";
export const RECEIPT_ENV = "LGTMD_PLAYWRIGHT_RECEIPT";
export const TOKEN_ENV = "LGTMD_PLAYWRIGHT_TOKEN";
export const REPORTER_PATH = fileURLToPath(
  new URL("./reporter.js", import.meta.url),
);

export interface ReporterOptions {
  readonly reporters?: readonly Reporter[];
}

export interface RunReceipt {
  readonly version: 1;
  readonly token: string;
  readonly status: FullResult["status"];
  readonly errors: readonly string[];
  readonly testCount: number;
  readonly attempts: readonly {
    readonly testId: string;
    readonly project: string;
    readonly retry: number;
    readonly status: TestResult["status"];
  }[];
  readonly documents: readonly FrozenDocument[];
}

/** The sole configured reporter; every optional project reporter is delegated here. */
export default class DocsReporter implements Reporter {
  #guard: ReporterGuard;
  #errors: string[] = [];
  #suite?: Suite;
  #result?: FullResult;
  #documents = new Map<string, FrozenDocument>();
  #attempts: RunReceipt["attempts"][number][] = [];

  constructor(options: ReporterOptions = {}) {
    this.#guard = new ReporterGuard(options.reporters ?? []);
  }

  printsToStdio(): boolean {
    // This reporter prints summaries, preventing Playwright from silently adding
    // a terminal reporter outside the guard.
    return true;
  }

  async preprocess(
    params: Parameters<NonNullable<Reporter["preprocess"]>>[0],
  ): Promise<void> {
    this.#guard.invoke("preprocess", params);
    await this.#guard.settle();
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.#suite = suite;
    const reporters = config.reporter;
    if (reporters.length !== 1 || reporters[0]?.[0] !== REPORTER_PATH) {
      this.#errors.push(
        "Use docsReporter() as the sole reporter; unguarded reporters cannot prove success",
      );
    }
    if (config.projects.length !== 1)
      this.#errors.push(
        "lgtmd currently requires exactly one Playwright project",
      );
    if (config.shard !== null)
      this.#errors.push("lgtmd does not support Playwright sharding yet");
    for (const project of config.projects) {
      if (project.retries !== 0)
        this.#errors.push("lgtmd currently requires retries: 0");
      if (project.repeatEach !== 1)
        this.#errors.push("lgtmd currently requires repeatEach: 1");
      if (project.dependencies.length !== 0 || project.teardown !== undefined) {
        this.#errors.push(
          "lgtmd does not support dependency or teardown projects yet",
        );
      }
    }
    if (suite.allTests().length === 0)
      this.#errors.push("No Playwright tests were discovered");
    this.#guard.invoke("onBegin", config, suite);
  }

  onTestBegin(test: TestCase, result: TestResult): void {
    this.#guard.invoke("onTestBegin", test, result);
  }

  onStepBegin(test: TestCase, result: TestResult, step: TestStep): void {
    this.#guard.invoke("onStepBegin", test, result, step);
  }

  onStepEnd(test: TestCase, result: TestResult, step: TestStep): void {
    this.#guard.invoke("onStepEnd", test, result, step);
  }

  onStdOut(chunk: string | Buffer, test?: TestCase, result?: TestResult): void {
    process.stdout.write(chunk);
    this.#guard.invoke("onStdOut", chunk, test, result);
  }

  onStdErr(chunk: string | Buffer, test?: TestCase, result?: TestResult): void {
    process.stderr.write(chunk);
    this.#guard.invoke("onStdErr", chunk, test, result);
  }

  onError(error: TestError, workerInfo?: unknown): void {
    this.#errors.push(
      error.message ??
        error.value ??
        "Playwright reported a global or worker error",
    );
    this.#guard.invoke("onError", error, workerInfo);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const project = test.parent.project()?.name ?? "";
    this.#attempts.push({
      testId: test.id,
      project,
      retry: result.retry,
      status: result.status,
    });
    process.stdout.write(`${result.status}: ${test.title}\n`);
    if (
      test.expectedStatus !== "passed" ||
      result.status !== "passed" ||
      result.errors.length > 0 ||
      result.retry !== 0
    ) {
      this.#errors.push(
        `Test did not pass cleanly: ${test.title} (${result.status}, retry ${result.retry})`,
      );
    } else {
      const attachments = result.attachments.filter(
        (attachment) => attachment.name === ATTACHMENT_NAME,
      );
      if (attachments.length > 1)
        this.#errors.push(
          `Multiple documentation attachments for test: ${test.title}`,
        );
      for (const attachment of attachments) {
        try {
          if (attachment.contentType !== ATTACHMENT_TYPE || !attachment.body) {
            throw new Error(
              "Documentation attachment must contain an in-memory frozen document",
            );
          }
          const document = JSON.parse(
            attachment.body.toString("utf8"),
          ) as FrozenDocument;
          if (!document || typeof document.id !== "string")
            throw new Error(
              "Documentation attachment has no document identity",
            );
          if (this.#documents.has(document.id))
            throw new Error(`Duplicate document identity: ${document.id}`);
          this.#documents.set(document.id, document);
        } catch (error) {
          this.#errors.push(
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    }
    this.#guard.invoke("onTestEnd", test, result);
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult["status"] }> {
    this.#result = result;
    for (const test of this.#suite?.allTests() ?? []) {
      if (
        test.results.length !== 1 ||
        test.results[0]?.status !== "passed" ||
        test.expectedStatus !== "passed"
      ) {
        this.#errors.push(
          `Incomplete or unsupported test outcome: ${test.title}`,
        );
      }
    }
    this.#guard.invoke("onEnd", result);
    await this.#guard.settle();
    return {
      status:
        this.#errors.length === 0 && this.#guard.errors.length === 0
          ? result.status
          : "failed",
    };
  }

  async onExit(): Promise<void> {
    this.#guard.invoke("onExit");
    await this.#guard.settle();
    const filename = process.env[RECEIPT_ENV];
    const token = process.env[TOKEN_ENV];
    // Direct Playwright execution can collect diagnostic attachments; only the
    // SDK parent process provides a receipt destination and can publish.
    if (!filename || !token) return;
    const errors = [...this.#errors, ...this.#guard.errors];
    if (!this.#suite || !this.#result)
      errors.push("Playwright lifecycle did not complete");
    if (this.#documents.size === 0)
      errors.push("No authored documents were collected");
    for (const error of errors) process.stderr.write(`lgtmd: ${error}\n`);
    const receipt: RunReceipt = {
      version: 1,
      token,
      status: this.#result?.status ?? "failed",
      errors,
      testCount: this.#suite?.allTests().length ?? 0,
      attempts: this.#attempts,
      documents: [...this.#documents.values()].sort((left, right) =>
        left.id.localeCompare(right.id, "en"),
      ),
    };
    // A swallowed write error leaves no valid receipt, which the parent rejects.
    writeFileSync(filename, JSON.stringify(receipt), {
      flag: "wx",
      mode: 0o600,
    });
  }
}
