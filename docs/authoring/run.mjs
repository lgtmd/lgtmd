import { runGuide, completeRun } from "lgtmd";
import { collectPlaywright } from "lgtmd/playwright";
import { startDemo } from "../../examples/review/fixture.mjs";
import gettingStarted from "./getting-started.mjs";
import develop from "./develop-and-record.mjs";
import customize from "./customize-the-site.mjs";
const documents = [
  await runGuide(gettingStarted),
  await runGuide(develop),
  await runGuide(customize),
];
const demo = await startDemo();
const prior = Object.fromEntries(
  ["LGTMD_DEMO_URL", "LGTMD_DEMO_BEFORE", "LGTMD_DEMO_AFTER"].map((key) => [
    key,
    process.env[key],
  ]),
);
let captured;
try {
  process.env.LGTMD_DEMO_URL = demo.url;
  process.env.LGTMD_DEMO_BEFORE = demo.before;
  process.env.LGTMD_DEMO_AFTER = demo.after;
  captured = await collectPlaywright({
    config: new URL("./playwright.config.ts", import.meta.url),
  });
} finally {
  await demo.close();
  for (const [key, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
await completeRun([...documents, ...captured]);
