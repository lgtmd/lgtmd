import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { FrozenDocument } from "./model.js";
import { freezeJson } from "./model.js";

/** Hand completed evidence to the owning CLI only after the flow's cleanup succeeds. */
export async function completeRun(
  documents: readonly FrozenDocument[],
): Promise<void> {
  const output = process.env.LGTMD_OUTPUT;
  const runId = process.env.LGTMD_RUN_ID;
  if (!output || !isAbsolute(output) || !runId) {
    throw new Error(
      "completeRun requires LGTMD_OUTPUT and LGTMD_RUN_ID from lgtmd dev/build/check",
    );
  }
  const envelope = freezeJson({
    schema_version: 1,
    run_id: runId,
    input: { schema_version: 1, documents },
  });
  const file = await open(output, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(envelope));
    await file.sync();
  } finally {
    await file.close();
  }
}
