import type { Doc } from "lgtmd";
import type { RecordEntry } from "../src/records.ts";

/** Ordinary functions are enough to reuse prose between authored documents. */
export function explainRecordNames(doc: Doc): void {
  doc.section("recognizable-names", "Use words you will recognize");
  doc.md`
    **Alpha contract** is easier to recognize than **Record 3**.
    Use a project name and the purpose of the record when both are useful.
  `;
}

export interface RecordsContext {
  records: RecordEntry[];
  preparationNote: string;
}
