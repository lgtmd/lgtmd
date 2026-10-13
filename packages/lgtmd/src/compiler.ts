import { spawn } from "node:child_process";
import { nativeExecutable } from "./native.js";
import type { FrozenDocument } from "./model.js";
import { freezeJson } from "./model.js";

export interface ExportLayout {
  pages?: string;
  resources?: string;
  pageOverrides?: Readonly<Record<string, string>>;
}

export interface PublishOptions {
  command: "build" | "check" | "update";
  reader: string;
  contributor: string;
  layout?: ExportLayout;
}

export interface Exports {
  reader: Readonly<Record<string, Uint8Array>>;
  contributor: Readonly<Record<string, Uint8Array>>;
}

function layout(value?: ExportLayout): Record<string, unknown> {
  return {
    pages: value?.pages ?? "",
    resources: value?.resources ?? "assets",
    page_overrides: value?.pageOverrides ?? {},
  };
}

export async function bridgeRequest(value: unknown): Promise<unknown> {
  const executable = nativeExecutable();
  // Freeze the complete request before starting a process. Host execution has
  // already ended; the bridge never calls application or authoring callbacks.
  const input = JSON.stringify(freezeJson(value));
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["__bridge"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) =>
      reject(
        new Error(
          `lgtmd native executable unavailable for ${process.platform}-${process.arch}. Build the local CLI or install a package containing that platform.`,
          { cause: error },
        ),
      ),
    );
    child.stdin.on("error", (error) => {
      if (error.message !== "write EPIPE") reject(error);
    });
    child.on("close", (code, signal) => {
      try {
        const response = JSON.parse(stdout) as {
          ok?: boolean;
          result?: unknown;
          error?: string;
        };
        if (code !== 0 || signal || response.ok !== true) {
          reject(
            new Error(
              response.error ??
                `lgtmd bridge failed (${signal ?? code}): ${stderr}`,
            ),
          );
        } else resolve(response.result);
      } catch (cause) {
        reject(
          new Error(
            `Invalid lgtmd bridge response (${signal ?? code}): ${stderr}`,
            { cause },
          ),
        );
      }
    });
    child.stdin.end(input);
  });
}

/** Compile both audiences from immutable document input. This writes no files. */
export async function compile(
  documents: readonly FrozenDocument[],
  options?: ExportLayout,
): Promise<Exports> {
  const result = (await bridgeRequest({
    operation: "compile",
    input: { schema_version: 1, documents },
    layout: layout(options),
  })) as {
    reader: Record<string, number[]>;
    contributor: Record<string, number[]>;
  };
  const bytes = (files: Record<string, number[]>): Record<string, Uint8Array> =>
    Object.fromEntries(
      Object.entries(files).map(([path, content]) => [
        path,
        Uint8Array.from(content),
      ]),
    );
  return {
    reader: bytes(result.reader),
    contributor: bytes(result.contributor),
  };
}

/** Build fresh review trees, check exactly, or explicitly accept a baseline.
 * Both audiences compile before publication. Their filesystem transactions are
 * independent; a later audience failure can leave the earlier one published.
 */
export async function publish(
  documents: readonly FrozenDocument[],
  options: PublishOptions,
): Promise<void> {
  await bridgeRequest({
    operation: "publish",
    input: { schema_version: 1, documents },
    command: options.command,
    reader: options.reader,
    contributor: options.contributor,
    layout: layout(options.layout),
  });
}
