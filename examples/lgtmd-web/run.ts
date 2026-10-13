import { runGuide, publish } from "lgtmd";
import { runPlaywright } from "lgtmd/playwright";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import recordNames from "./guides/01-record-names.ts";
import resources from "./guides/02-resources.ts";

const [command, output] = process.argv.slice(2);
if (
  !(command === "build" || command === "check" || command === "update") ||
  !output
) {
  throw new Error(
    "Usage: node run.ts build|check|update OUTPUT [--without-browser]",
  );
}
const root = fileURLToPath(new URL(".", import.meta.url));
const destination = resolve(output);
const options = {
  command,
  reader: `${destination}/reader`,
  contributor: `${destination}/contributor`,
} as const;
const documents = await Promise.all([
  runGuide(recordNames),
  runGuide(resources),
]);
if (process.argv.includes("--without-browser")) {
  await publish(documents, options);
} else {
  await runPlaywright({
    config: `${root}playwright.config.ts`,
    cwd: root,
    ...options,
    documents,
  });
}
console.log(`lgtmd ${command} completed: ${output}`);
