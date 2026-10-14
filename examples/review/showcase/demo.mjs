import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { parseArgs } from "node:util";
import { buildShowcase } from "./build.mjs";
export async function startShowcase({
  port = 0,
  audience = "contributor",
  basePath = "/",
  environment = process.env,
} = {}) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "lgtmd-viewer-showcase-")),
  );
  let child, exit;
  const close = async () => {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await exit;
    }
    await rm(root, { recursive: true, force: true });
  };
  try {
    const state = await buildShowcase(join(root, "site"), {
      audience,
      basePath,
    });
    const config = join(root, "lgtmd.config.json");
    await writeFile(
      config,
      JSON.stringify({ schemaVersion: 1, outDir: "site", basePath }),
    );
    const cli = fileURLToPath(
      new URL("../../../packages/lgtmd/dist/src/cli.js", import.meta.url),
    );
    child = spawn(
      process.execPath,
      [
        cli,
        "preview",
        "--config",
        config,
        "--port",
        String(port),
        "--audience",
        audience,
      ],
      { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] },
    );
    exit = once(child, "close");
    let output = "";
    child.stderr.on("data", (bytes) => {
      output += bytes;
    });
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Showcase startup timed out: ${output}`)),
        15000,
      );
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        reject(new Error(`Showcase exited (${code}): ${output}`));
      });
      child.stdout.on("data", (bytes) => {
        output += bytes;
        for (const line of output.split("\n")) {
          try {
            const event = JSON.parse(line);
            if (event.event === "listening") {
              clearTimeout(timer);
              resolve(event.url);
            }
          } catch {
            /* Wait for complete JSON lines. */
          }
        }
      });
    });
    return { url, state, root, close };
  } catch (error) {
    await close();
    throw error;
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { values } = parseArgs({
    options: {
      port: { type: "string" },
      audience: { type: "string", default: "contributor" },
    },
  });
  const demo = await startShowcase({
    port: values.port === undefined ? 0 : Number(values.port),
    audience: values.audience,
  });
  console.log(`Viewer showcase: ${demo.url}`);
  let closing = false;
  const close = () => {
    if (!closing) {
      closing = true;
      void demo.close();
    }
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
