import { runGuideWithContext } from "lgtmd";
import { writeResources } from "./02-resources.ts";
import type { RecordsContext } from "./shared.ts";

/** An existing application runner retains ownership of its context and cleanup. */
export function documentPreparedRecords(context: RecordsContext) {
  return runGuideWithContext(
    { id: "record-resources", title: "Read and download record data" },
    context,
    writeResources,
  );
}
