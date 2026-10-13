import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { storeSite } from "lgtmd";
import { readFile } from "node:fs/promises";
import { bridgeRequest } from "../../packages/lgtmd/dist/src/compiler.js";
const root = fileURLToPath(new URL("../../", import.meta.url));
const configPath = resolve(root, "lgtmd.config.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
const loadCandidate = (id) =>
  bridgeRequest({
    operation: "load-candidate",
    config: configPath,
    candidate_id: id,
  });
async function fresh() {
  const child = spawn(
    process.execPath,
    [resolve(root, "packages/lgtmd/dist/src/cli.js"), "build"],
    { cwd: root, stdio: ["ignore", "pipe", "inherit"] },
  );
  let output = "";
  child.stdout.on("data", (bytes) => {
    output += bytes;
    process.stdout.write(bytes);
  });
  const stop = () => child.kill("SIGTERM");
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const code = await new Promise((done, reject) => {
      child.once("error", reject);
      child.once("close", done);
    });
    if (code !== 0) throw new Error(`Own-doc flow failed: ${code}`);
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
  const event = output
    .split("\n")
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .findLast((event) => event?.event === "candidate");
  if (!event) throw new Error("Own-doc flow produced no completed candidate");
  return loadCandidate(event.id);
}
const [command, id] = process.argv.slice(2);
if (command === "record") {
  if (!id) throw new Error("Usage: just docs-record CANDIDATE_ID");
  const candidate = await loadCandidate(id);
  assert.deepEqual(candidate.reader.bundle.navigation, config.navigation);
  assert.equal(candidate.reader.bundle.title, config.title);
  await storeSite(
    "update",
    resolve(root, "docs/guide"),
    candidate.markdown.reader,
    "markdown",
  );
  console.log(`Recorded exact own-guide candidate ${id}`);
} else if (command === "check") {
  const candidate = await fresh();
  await storeSite(
    "check",
    resolve(root, "docs/guide"),
    candidate.markdown.reader,
    "markdown",
  );
  console.log("Tracked own-guide text and captures match exactly.");
} else if (command === "verify") {
  const first = await fresh();
  const second = await fresh();
  assert.equal(
    second.candidate_id,
    first.candidate_id,
    "Fresh own-doc runs must match exactly in this capture environment",
  );
  console.log(
    "Two complete own-doc browser runs match exactly. This does not accept or replace tracked guide output.",
  );
} else
  throw new Error(
    "Usage: node docs/authoring/verify.mjs record ID|check|verify",
  );
