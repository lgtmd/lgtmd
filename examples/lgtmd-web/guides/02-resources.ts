import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guide, type Doc } from "lgtmd";
import { exampleRecords } from "../src/records.ts";
import type { RecordsContext } from "./shared.ts";

/** Preparation belongs to the application; the SDK receives only the result. */
export async function prepareRecords(): Promise<{
  context: RecordsContext;
  cleanup: () => Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), "lgtmd-records-"));
  try {
    const filename = join(directory, "records.json");
    await writeFile(filename, JSON.stringify(exampleRecords));
    const records = JSON.parse(await readFile(filename, "utf8"));
    return {
      context: {
        records,
        preparationNote:
          "Records came from an isolated, application-owned file.",
      },
      cleanup: () => rm(directory, { recursive: true }),
    };
  } catch (error) {
    // Until acquisition returns, the project owns partial setup cleanup.
    try {
      await rm(directory, { recursive: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Record setup and cleanup failed",
      );
    }
    throw error;
  }
}

/** Also usable with a context that an existing runner has already prepared. */
export async function writeResources(
  doc: Doc,
  context: RecordsContext,
): Promise<void> {
  const recordCount = doc.observe("record-count", context.records.length);
  const countCheck = await doc.check("three-records", () => {
    assert.equal(context.records.length, 3);
  });

  doc.md`
    This export contains ${recordCount} sample records. Keep a JSON copy when
    you need the record identifiers as well as their names.
  `;

  doc.section("download-records", "Read or download an export");
  const exportData = {
    records: context.records.map((record) => ({ ...record })),
  };
  const json = doc.assets.json("records", exportData);
  const csvBytes = new TextEncoder().encode(
    "id,name\n" +
      context.records.map((record) => `${record.id},${record.name}\n`).join(""),
  );
  const csv = doc.assets.file("records-table", {
    bytes: csvBytes,
    mediaType: "text/csv",
    extension: "csv",
  });
  const preparation = doc.assets.text("preparation", context.preparationNote);

  // Values and bytes have already been captured. Later source mutation must
  // never rewrite the document or a previously registered download.
  exportData.records[0]!.name = "Changed after registration";
  csvBytes.fill(0);

  const passage = doc.md`
    The JSON includes the same three records:

    ${json.code()}

    ${json.link("Download the JSON export")} or
    ${csv.link("download a CSV table")} for use in another tool.
  `;

  doc.noteOn(passage)`
    ${preparation.link("Preparation details")}
    This resource belongs to the contributor explanation and is excluded from
    the Reader export. The source values and buffer are deliberately changed
    after registration to exercise snapshot ownership.
  `;
  doc.noteOn(countCheck)`
    The named check verifies the supplied sample count. It does not exercise
    a production export endpoint. The observed count alone is not an assertion.
  `;
}

export default guide(
  {
    id: "record-resources",
    title: "Read and download record data",
    prepare: prepareRecords,
  },
  writeResources,
);
