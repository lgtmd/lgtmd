import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Doc } from "../src/authoring.js";
import { compile, publish } from "../src/compiler.js";
import type { FrozenDocument } from "../src/model.js";
import { test } from "node:test";

test("JSON resources use Rust's canonical key and number encoding", async () => {
  const doc = new Doc("canonical-json", "Canonical JSON");
  const resource = doc.assets.json("data", { "2": 2, "10": 1, tiny: 0.000001 });
  doc.md`${resource.code()}`;
  const exports = await compile([doc.finish()]);
  assert.equal(
    new TextDecoder().decode(exports.reader["assets/canonical-json/data.json"]),
    '{\n  "10": 1,\n  "2": 2,\n  "tiny": 1e-6\n}\n',
  );
});

async function portableDocument(): Promise<FrozenDocument> {
  const doc = new Doc("portable", "Portable document");
  const count = doc.observe("count", 3);
  const privateValue = doc.observe("internal-only", "private observation");
  await doc.check("verified-count", () => assert.equal(count.value, 3));
  doc.section("overview", "Overview");
  const passage = doc.md`Contains ${count} records.`;
  doc.noteOn(passage)`Internal: ${privateValue}`;
  const data = doc.assets.json("data", { z: 2, a: 1 });
  doc.md`Data:

${data.code()}

${data.link("Download")}`;
  const image = doc.assets.image("image", Uint8Array.of(1, 2, 3), {
    producer: "fixture",
    profile: "exact-v1",
  });
  doc.md`${image.embed("Fixed fixture bytes")}`;
  return doc.finish();
}

test("Rust and TypeScript authoring produce identical common exports", async () => {
  const fixture =
    process.env.LGTMD_CONFORMANCE_FIXTURE ??
    fileURLToPath(
      new URL(
        "../../../../crates/lgtmd/tests/fixtures/portable.json",
        import.meta.url,
      ),
    );
  const expected = JSON.parse(await readFile(fixture, "utf8")) as {
    exports: {
      reader: Record<string, number[]>;
      contributor: Record<string, number[]>;
    };
  };
  const actual = await compile([await portableDocument()]);
  for (const audience of ["reader", "contributor"] as const) {
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(actual[audience]).map(([path, bytes]) => [
          path,
          Array.from(bytes),
        ]),
      ),
      expected.exports[audience],
    );
  }
  assert.ok(
    !new TextDecoder()
      .decode(actual.reader["manifest.json"])
      .includes("internal-only"),
  );
});

test("the native store checks exactly, preserves ownership, and requires explicit updates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lgtmd-store-"));
  // macOS /var is a symlink; use real paths for the store's explicit policy.
  const { realpath } = await import("node:fs/promises");
  const root = await realpath(directory);
  const options = {
    reader: join(root, "public"),
    contributor: join(root, "private"),
  };
  try {
    const document = await portableDocument();
    await publish([document], { ...options, command: "build" });
    await publish([document], { ...options, command: "check" });
    await assert.rejects(
      publish([document], { ...options, command: "build" }),
      /already exists/,
    );
    const changed = new Doc("portable", "Portable document");
    changed.md`Changed prose.`;
    await assert.rejects(
      publish([changed.finish()], { ...options, command: "check" }),
      /differ|Missing|Orphan|Changed|mismatch/i,
    );
    await writeFile(join(options.reader, "unowned.txt"), "keep me");
    await assert.rejects(
      publish([document], { ...options, command: "update" }),
      /Unowned/,
    );
    await rm(join(options.reader, "unowned.txt"));
    await publish([document], { ...options, command: "check" });
    const alternate = await portableDocument();
    const unsupported = {
      ...alternate,
      resources: alternate.resources.map((resource) =>
        resource.id === "image"
          ? { ...resource, profile: "different-host" }
          : resource,
      ),
    };
    await assert.rejects(
      publish([unsupported], { ...options, command: "update" }),
      /Incompatible producer/,
    );
    await publish([document], { ...options, command: "check" });
    await assert.rejects(
      publish([document], {
        ...options,
        contributor: options.reader,
        command: "update",
      }),
      /overlap|distinct|separate/i,
    );
  } finally {
    await rm(root, { recursive: true });
  }
});

test("compiler rejects malformed frozen data instead of trusting host handles", async () => {
  const doc = await portableDocument();
  const missing = structuredClone(doc) as unknown as {
    nodes: { parts?: { target?: { id: string } }[] }[];
  };
  missing.nodes[1]!.parts![1]!.target!.id = "missing";
  await assert.rejects(
    compile([missing as unknown as FrozenDocument]),
    /Missing reference/,
  );
  const orphan = {
    ...doc,
    resources: [...doc.resources, { ...doc.resources[0]!, id: "orphan" }],
  };
  await assert.rejects(compile([orphan]), /Unreferenced resources/);
  await assert.rejects(
    compile([doc], { pageOverrides: { portable: "../outside.md" } }),
    /path|Path/,
  );
});

test("untyped compiler callers cannot silently coerce unsupported JSON", async () => {
  const doc = await portableDocument();
  const invalidNumber = {
    ...doc,
    observations: [{ id: "count", value: Number.NaN }],
  };
  await assert.rejects(compile([invalidNumber]), /finite/);
  const omitted = { ...doc, observations: [{ id: "count", value: undefined }] };
  await assert.rejects(
    compile([omitted as unknown as FrozenDocument]),
    /JSON value/,
  );
});
