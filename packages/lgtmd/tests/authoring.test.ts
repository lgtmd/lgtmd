import assert from "node:assert/strict";
import test from "node:test";
import { Doc } from "../src/authoring.js";
import type { Content, Target } from "../src/authoring.js";
import { freezeJson } from "../src/model.js";

test("explanation and observations do not manufacture executed checks", () => {
  const doc = new Doc("saved-view", "Save a view");
  const count = doc.observe("record-count", 3);
  doc.md`The view contains ${count} records.`;
  const frozen = doc.finish();
  assert.deepEqual(frozen.checks, []);
  assert.deepEqual(frozen.observations, [{ id: "record-count", value: 3 }]);
  assert.deepEqual(frozen.nodes, [
    {
      id: "block-0001",
      kind: "markdown",
      parts: [
        { kind: "markdown", text: "The view contains " },
        {
          kind: "reference",
          target: { id: "record-count", kind: "observation" },
        },
        { kind: "markdown", text: " records." },
        { kind: "markdown", text: "\n\n" },
      ],
    },
  ]);
});

test("template indentation and literal Markdown stay separate from escaped substitutions", () => {
  const doc = new Doc("markdown", "Markdown");
  doc.md`
    **A heading**

    A literal ${"[untrusted](wrong.md)"} and ${2}.
  `;
  assert.deepEqual(doc.finish().nodes, [
    {
      id: "block-0001",
      kind: "markdown",
      parts: [
        { kind: "markdown", text: "**A heading**\n\nA literal " },
        { kind: "text", text: "[untrusted](wrong.md)" },
        { kind: "markdown", text: " and " },
        { kind: "text", text: "2" },
        { kind: "markdown", text: "." },
        { kind: "markdown", text: "\n\n" },
      ],
    },
  ]);
});

test("Markdown templates terminate blocks before a following heading or paragraph", () => {
  const doc = new Doc("boundaries", "Block boundaries");
  doc.md`Opening paragraph.`;
  doc.section("next", "Next section");
  doc.md`Final paragraph.`;
  const nodes = doc.finish().nodes;
  for (const index of [0, 2]) {
    const node = nodes[index]!;
    assert.equal(node.kind, "markdown");
    if (node.kind === "markdown") {
      assert.deepEqual(node.parts.at(-1), { kind: "markdown", text: "\n\n" });
    }
  }
  assert.equal(nodes[1]!.kind, "heading");
});

test("template marker characters retain their literal position around substitutions", () => {
  const doc = new Doc("markers", "Template markers");
  doc.md`\uE000${"value"}\uE001\uE0000\uE001`;
  assert.deepEqual(doc.finish().nodes, [
    {
      id: "block-0001",
      kind: "markdown",
      parts: [
        { kind: "markdown", text: "\uE000" },
        { kind: "text", text: "value" },
        { kind: "markdown", text: "\uE001\uE0000\uE001" },
        { kind: "markdown", text: "\n\n" },
      ],
    },
  ]);
});

test("adding notes never changes reader block identities", () => {
  const make = (notes: boolean) => {
    const doc = new Doc("notes", "Notes");
    const first = doc.md`First.`;
    if (notes) doc.noteOn(first)`Private **literal** explanation.`;
    doc.section("next", "Next");
    if (notes) doc.note`A second note.`;
    doc.md`Last.`;
    return doc.finish();
  };
  const withNotes = make(true);
  assert.deepEqual(
    withNotes.nodes.filter((node) => node.kind !== "note"),
    make(false).nodes,
  );
  assert.deepEqual(withNotes.nodes[1], {
    id: "note-0001",
    kind: "note",
    target: { kind: "block", id: "block-0001" },
    parts: [{ kind: "text", text: "Private **literal** explanation." }],
  });
});

test("observations, JSON, and bytes belong to their registration snapshot", () => {
  const doc = new Doc("snapshot", "Snapshots");
  const mutable = { z: ["original"], a: 3 };
  const observed = doc.observe("state", mutable);
  const json = doc.assets.json("json", mutable);
  const bytes = new Uint8Array([7, 8, 9]);
  const image = doc.assets.image("image", bytes);
  mutable.z[0] = "changed";
  bytes.fill(0);
  doc.md`${json.code()}

${json.link("Download JSON")}

${image.embed("Frozen bytes")}`;
  assert.deepEqual(observed.value, { a: 3, z: ["original"] });
  if (false) {
    // @ts-expect-error Snapshot arrays are recursively readonly.
    observed.value.z.push("forbidden");
    // @ts-expect-error Snapshot properties are recursively readonly.
    observed.value.a = 5;
  }
  assert.throws(() => {
    (observed.value.z as string[])[0] = "forbidden";
  }, TypeError);
  const frozen = doc.finish();
  assert.deepEqual(frozen.resources[1]!.bytes, [7, 8, 9]);
  assert.deepEqual(frozen.resources[0]!.bytes, []);
  assert.deepEqual(frozen.resources[0]!.json, { a: 3, z: ["original"] });
  assert.equal(frozen.resources[0]!.producer, "executable-docs/json");
  assert.equal(frozen.resources[0]!.profile, "json-pretty-v1");
  assert.throws(() => {
    (frozen.resources[1]!.bytes as number[])[0] = 0;
  }, TypeError);
  assert.throws(() => doc.md`After finish.`, /already finished/);
  assert.throws(() => doc.finish(), /already finished/);
  assert.throws(() => {
    (doc as unknown as { md: unknown }).md = () => undefined;
  }, TypeError);
});

test("foreign handles and presentations taint even caught authoring failures", () => {
  const first = new Doc("first", "First");
  const value = first.observe("value", 4);
  const asset = first.assets.text("text", "Private");
  const second = new Doc("second", "Second");
  assert.throws(() => second.md`${value}`, /Foreign/);
  assert.throws(() => second.md`${asset.link("Foreign")}`, /Foreign/);
  assert.throws(() => second.noteOn({} as Target), /forged/);
  assert.throws(() => second.finish(), /caught failures/);
});

test("resource registration appends no content and named ids share one namespace", () => {
  const doc = new Doc("ids", "IDs");
  doc.assets.text("same", "Registered once");
  assert.throws(() => doc.observe("same", 1), /Duplicate evidence/);
  assert.throws(() => doc.finish(), /authoring failed/);
  const empty = new Doc("resources", "Resources");
  empty.assets.text("private", "No placement");
  assert.deepEqual(empty.finish().nodes, []);
});

test("native assertion wrappers execute once and retain caught failure", async () => {
  const doc = new Doc("checks", "Checks");
  let calls = 0;
  const error = new Error("Native assertion failed");
  await assert.rejects(
    doc.check("failure", async () => {
      calls += 1;
      throw error;
    }),
    (candidate) => candidate === error,
  );
  assert.equal(calls, 1);
  assert.throws(
    () => doc.finish(),
    (candidate) =>
      candidate instanceof AggregateError && candidate.errors[0] === error,
  );
});

test("boolean check results cannot be mistaken for native assertions", async () => {
  for (const result of [true, false]) {
    const doc = new Doc("boolean", "Boolean");
    await assert.rejects(
      doc.check("wrong", (() => result) as unknown as () => void),
      /must return void/,
    );
    assert.throws(() => doc.finish(), /authoring failed/);
  }
});

test("pending checks prevent publication eligibility", async () => {
  const doc = new Doc("pending", "Pending");
  let settle: () => void = () => {
    throw new Error("Missing resolver");
  };
  const check = doc.check(
    "wait",
    () =>
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
  );
  assert.throws(() => doc.finish(), /pending checks/);
  settle();
  await assert.rejects(check, /already finished/);
});

test("successful checks can receive targeted contributor notes", async () => {
  const doc = new Doc("success", "Success");
  const checked = await doc.check("count", () => assert.equal(3, 3));
  doc.noteOn(checked)`This check covers the sample count.`;
  const frozen = doc.finish();
  assert.deepEqual(frozen.checks, [
    { id: "count", kind: "predicate", passed: true },
  ]);
  assert.deepEqual(frozen.nodes[0], {
    id: "note-0001",
    kind: "note",
    target: { kind: "claim", id: "count" },
    parts: [{ kind: "text", text: "This check covers the sample count." }],
  });
});

test("unsupported JSON never silently omits, coerces, invokes getters, or loses precision", () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  let getterCalls = 0;
  const getter = Object.defineProperty({}, "value", {
    enumerable: true,
    get: () => {
      getterCalls += 1;
      return 1;
    },
  });
  const cases = [
    undefined,
    NaN,
    Infinity,
    -0,
    Number.MAX_SAFE_INTEGER + 1,
    1n,
    new Date(),
    new Map(),
    { missing: undefined },
    [undefined],
    new Array(1),
    cycle,
    getter,
    Object.defineProperty({}, "hidden", { value: 1 }),
    { [Symbol("hidden")]: 1 },
    () => 1,
  ];
  for (const value of cases) assert.throws(() => freezeJson(value), TypeError);
  assert.equal(getterCalls, 0);
  const shared = { value: "same" };
  assert.deepEqual(freezeJson([shared, shared]), [
    { value: "same" },
    { value: "same" },
  ]);
  const special = JSON.parse(
    '{"__proto__":{"safe":true},"constructor":"value"}',
  );
  assert.deepEqual(freezeJson(special), special);
  assert.equal(Object.getPrototypeOf(freezeJson(special)), Object.prototype);
});

test("numeric-looking properties outside an array's index range are never omitted", () => {
  const array: unknown[] = [];
  Object.defineProperty(array, "4294967295", {
    value: "not an array index",
    enumerable: true,
  });
  assert.equal(array.length, 0);
  assert.throws(() => freezeJson(array), /array has extra properties/);
  assert.deepEqual(freezeJson(["ordinary", "indices"]), [
    "ordinary",
    "indices",
  ]);
});

test("ill-formed Unicode is rejected before JSON or text bytes can change it", () => {
  for (const value of [
    "\uD800",
    "\uDFFF",
    "before\uD800after",
    "\uD800\uD800",
  ]) {
    assert.throws(() => freezeJson(value), /unpaired UTF-16 surrogate/);
    assert.throws(() => freezeJson({ value }), /unpaired UTF-16 surrogate/);
    assert.throws(
      () => freezeJson({ [value]: "property" }),
      /unpaired UTF-16 surrogate/,
    );
    const doc = new Doc("invalid-unicode", "Invalid Unicode");
    assert.throws(
      () => doc.assets.text("text", value),
      /unpaired UTF-16 surrogate/,
    );
    assert.throws(() => doc.finish(), /authoring failed/);
  }
  const valid = "A record 📄 with a valid pair \uD83D\uDE00";
  assert.equal(freezeJson(valid), valid);
  const doc = new Doc("unicode", "Unicode");
  doc.assets.text("text", valid);
  const bytes = doc.finish().resources[0]!.bytes;
  assert.equal(
    new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes)),
    valid,
  );
});

test("raw objects and code in notes fail rather than flattening typed structure", () => {
  const doc = new Doc("invalid", "Invalid");
  assert.throws(() => doc.md`${{ value: 1 } as unknown as Content}`, /forged/);
  const code = doc.assets.text("code", "text");
  assert.throws(() => doc.note`${code.code()}`, /not contributor notes/);
  assert.throws(() => doc.finish(), /authoring failed/);
});

test("runner identity is set once and validated", () => {
  const doc = new Doc();
  doc.page({ id: "browser", title: "Browser" });
  doc.md`Ready.`;
  assert.throws(
    () => doc.page({ id: "second", title: "Second" }),
    /only be set once/,
  );
  assert.throws(() => doc.finish(), /authoring failed/);
  assert.throws(() => new Doc("Invalid ID", "Title"), /Invalid document ID/);
});
