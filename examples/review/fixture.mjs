import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileSite, storeSite } from "lgtmd";
import { collectReview } from "./collect.mjs";
const exec = promisify(execFile);
const here = fileURLToPath(new URL(".", import.meta.url));
const cli = fileURLToPath(new URL("./cli.js", import.meta.resolve("lgtmd")));
// The fixture owns its Git namespace. Caller Git environment must never redirect
// init, add, or commit into a developer's repository or alternate index.
export function exampleEnvironment() {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
    ),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "lgtmd example",
    GIT_AUTHOR_EMAIL: "example@lgtmd.invalid",
    GIT_COMMITTER_NAME: "lgtmd example",
    GIT_COMMITTER_EMAIL: "example@lgtmd.invalid",
    GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
    REVIEW_VERSION: "B",
  };
}
export function exampleGit(root) {
  return (...args) =>
    exec(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.autocrlf=false",
        ...args,
      ],
      { cwd: root, env: exampleEnvironment() },
    );
}
export async function prepareDemo({ playground = false } = {}) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "lgtmd-review-demo-")),
  );
  const git = exampleGit(root);
  try {
    await writeFile(
      join(root, "lgtmd.config.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          title: playground
            ? "Image comparison playground"
            : "Review demonstration",
          flow: {
            command: [
              process.execPath,
              join(here, "run.mjs"),
              ...(playground ? ["--playground"] : []),
            ],
            cwd: ".",
          },
          snapshots: "snapshots",
          cacheDir: ".cache/lgtmd",
          outDir: "build",
          git: { base: "before" },
        },
        null,
        2,
      ),
    );
    await writeFile(join(root, ".gitignore"), ".cache/\nbuild/\n");
    await git("init", "--initial-branch=main", "--object-format=sha1");
    let before;
    for (const version of ["A", "B"]) {
      const compiled = await compileSite(
        await collectReview(version, { playground }),
        {
          title: playground
            ? "Image comparison playground"
            : "Review demonstration",
        },
      );
      for (const audience of ["reader", "contributor"])
        await storeSite(
          "update",
          join(root, "snapshots", audience),
          compiled[audience].files,
        );
      await git("add", "snapshots", "lgtmd.config.json", ".gitignore");
      await git("commit", "-m", `Record demonstration ${version}`);
      if (version === "A") {
        await git("branch", "before");
        before = (await git("rev-parse", "HEAD")).stdout.trim();
      }
    }
    return {
      root,
      before,
      after: (await git("rev-parse", "HEAD")).stdout.trim(),
      cleanup: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
export async function startDemo({
  audience = "contributor",
  port = 0,
  playground = false,
} = {}) {
  const fixture = await prepareDemo({ playground });
  const child = spawn(
    process.execPath,
    [
      cli,
      "dev",
      "--config",
      join(fixture.root, "lgtmd.config.json"),
      "--port",
      String(port),
      "--audience",
      audience,
    ],
    {
      cwd: fixture.root,
      env: exampleEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  child.stderr.on("data", (bytes) => {
    log += bytes;
    process.stderr.write(bytes);
  });
  try {
    const url = await new Promise((done, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Demo startup timed out: ${log}`)),
        30000,
      );
      let buffer = "";
      child.stdout.on("data", (bytes) => {
        buffer += bytes;
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          try {
            const event = JSON.parse(line);
            if (event.event === "listening") {
              clearTimeout(timer);
              done(event.url);
            }
          } catch {
            log += line;
          }
        }
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Demo exited ${code}: ${log}`));
      });
    });
    return {
      ...fixture,
      url,
      async close() {
        await stop(child);
        await fixture.cleanup();
      },
    };
  } catch (error) {
    await stop(child);
    await fixture.cleanup();
    throw error;
  }
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}
