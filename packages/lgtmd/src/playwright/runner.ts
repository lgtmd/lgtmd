import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publish, type ExportLayout } from "../compiler.js";
import { freezeJson, type FrozenDocument } from "../model.js";
import { RECEIPT_ENV, TOKEN_ENV, type RunReceipt } from "./reporter.js";

export interface CollectPlaywrightOptions {
  readonly config: string | URL;
  readonly cwd?: string;
  /** Documents from other host runs whose preparation and cleanup completed. */
  readonly documents?: readonly FrozenDocument[];
}

export interface RunPlaywrightOptions extends CollectPlaywrightOptions {
  readonly command: "build" | "check" | "update";
  readonly reader: string;
  readonly contributor: string;
  readonly layout?: ExportLayout;
}

function readReceipt(source: string, token: string): RunReceipt {
  const value = JSON.parse(source) as RunReceipt;
  if (
    !value ||
    value.version !== 1 ||
    value.token !== token ||
    value.status !== "passed" ||
    !Array.isArray(value.errors) ||
    value.errors.length !== 0 ||
    !Number.isInteger(value.testCount) ||
    value.testCount < 1 ||
    !Array.isArray(value.attempts) ||
    value.attempts.length !== value.testCount ||
    !value.attempts.every(
      (attempt) => attempt.status === "passed" && attempt.retry === 0,
    ) ||
    new Set(value.attempts.map((attempt) => attempt.testId)).size !==
      value.testCount ||
    !Array.isArray(value.documents) ||
    value.documents.length === 0
  ) {
    const errors = Array.isArray(value?.errors)
      ? value.errors.join("\n")
      : "Invalid or missing success receipt";
    throw new Error(
      `Playwright output is not eligible for publication: ${errors}`,
    );
  }
  return value;
}

/** Collect only after the actual runner process and all guarded reporters finish. */
export async function collectPlaywright(
  options: CollectPlaywrightOptions,
): Promise<readonly FrozenDocument[]> {
  const config =
    options.config instanceof URL
      ? fileURLToPath(options.config)
      : resolve(options.cwd ?? process.cwd(), options.config);
  const cwd = resolve(options.cwd ?? dirname(config));
  const require = createRequire(config);
  const cli = require.resolve("@playwright/test/cli");
  const directory = await mkdtemp(join(tmpdir(), "lgtmd-playwright-"));
  const receiptPath = join(directory, "receipt.json");
  const token = randomUUID();
  try {
    const child = spawn(
      process.execPath,
      [cli, "test", "--config", config, "--forbid-only"],
      {
        cwd,
        env: { ...process.env, [RECEIPT_ENV]: receiptPath, [TOKEN_ENV]: token },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let interrupted = false;
    const interrupt = () => {
      interrupted = true;
      child.kill("SIGINT");
    };
    const terminate = () => {
      interrupted = true;
      child.kill("SIGTERM");
    };
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    child.stdout.on("data", (chunk: Buffer) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    let exit: { code: number | null; signal: NodeJS.Signals | null };
    try {
      exit = await new Promise((fulfill, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => fulfill({ code, signal }));
      });
    } finally {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    }
    if (interrupted || exit.code !== 0 || exit.signal !== null) {
      throw new Error(
        `Playwright did not finish successfully (exit ${String(exit.code)}, signal ${String(exit.signal)})`,
      );
    }
    let receipt: RunReceipt;
    try {
      receipt = readReceipt(await readFile(receiptPath, "utf8"), token);
    } catch (error) {
      throw new Error(
        `Playwright produced no valid completed success receipt: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    const documents = [...(options.documents ?? []), ...receipt.documents];
    if (
      new Set(documents.map((document) => document.id)).size !==
      documents.length
    ) {
      throw new Error("Duplicate document identity across completed host runs");
    }
    return freezeJson(documents) as unknown as readonly FrozenDocument[];
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Publish the same completed collection through the existing Markdown store. */
export async function runPlaywright(
  options: RunPlaywrightOptions,
): Promise<void> {
  const config =
    options.config instanceof URL
      ? fileURLToPath(options.config)
      : resolve(options.cwd ?? process.cwd(), options.config);
  const cwd = resolve(options.cwd ?? dirname(config));
  const documents = await collectPlaywright(options);
  await publish(documents, {
    command: options.command,
    reader: resolve(cwd, options.reader),
    contributor: resolve(cwd, options.contributor),
    ...(options.layout === undefined ? {} : { layout: options.layout }),
  });
}
