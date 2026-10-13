import { completeRun } from "lgtmd";
import { buildApp, collectStay } from "./collect.ts";

await buildApp();
// A failed assertion or application cleanup never reaches the native handoff.
await completeRun(await collectStay());
