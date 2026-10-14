import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeText,
  TEXT_LIMITS,
  withinTextBudget,
  type Decoration,
} from "../src/text-diff.ts";
import { requestTextReview } from "../src/text-diff-client.ts";
import type { ContentNode, Page } from "../src/protocol.ts";
const paragraph = (text: string): ContentNode => ({
  type: "paragraph",
  children: [{ type: "text", text }],
});
const page = (...content: ContentNode[]): Page => ({
  id: "p",
  title: "Page",
  content,
  anchors: [],
  notes: [],
});
const p = (...text: string[]) => page(...text.map(paragraph));
function selected(page: Page, decorations: Decoration[]) {
  return decorations.flatMap((d) => {
    let node = page.content[d.path[0]];
    for (const index of d.path.slice(1)) node = node.children![index];
    const text = node.text ?? "";
    const boundaries = new Set([
      0,
      ...Array.from(
        new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text),
        (s) => s.index + s.segment.length,
      ),
    ]);
    let end = 0;
    for (const r of d.ranges ?? []) {
      assert.ok(r.start >= end && r.end > r.start && r.end <= text.length);
      assert.ok(boundaries.has(r.start) && boundaries.has(r.end));
      end = r.end;
    }
    // Splitting to decorate must reconstruct the original exactly.
    let offset = 0,
      rebuilt = "";
    for (const r of d.ranges ?? []) {
      rebuilt += text.slice(offset, r.start) + text.slice(r.start, r.end);
      offset = r.end;
    }
    rebuilt += text.slice(offset);
    assert.equal(rebuilt, text);
    return d.ranges?.map((r) => text.slice(r.start, r.end)) ?? [];
  });
}
test("word and bounded grapheme edits are legal, immutable, and repeatable", () => {
  const a = p(
    "A quiet cabin.",
    "A stable separator.",
    "Confirm your resrevation.",
  );
  const b = p(
    "A sunny cabin.",
    "A stable separator.",
    "Confirm your reservation.",
  );
  const saved = JSON.stringify([a, b]);
  const result = analyzeText(a, b);
  assert.equal(result.coverage, "complete");
  assert.deepEqual(selected(a, result.before), ["quiet", "r"]);
  assert.deepEqual(selected(b, result.after), ["sunny", "r"]);
  assert.deepEqual(analyzeText(a, b), result);
  assert.equal(JSON.stringify([a, b]), saved);
});
test("deep markup within the input budget preserves exact word review", () => {
  function nested(text: string) {
    let node: ContentNode = { type: "text", text };
    for (let i = 0; i < 40; i++) node = { type: "strong", children: [node] };
    return page({ type: "paragraph", children: [node] });
  }
  const before = nested("A quiet cabin.");
  const after = nested("A sunny cabin.");
  assert.equal(withinTextBudget(before), true);
  const result = analyzeText(before, after);
  assert.equal(result.coverage, "complete");
  assert.deepEqual(selected(before, result.before), ["quiet"]);
  assert.deepEqual(selected(after, result.after), ["sunny"]);
});
test("an inserted paragraph and shifted positional anchors do not change existing text", () => {
  const a = page(
    { type: "anchor", id: "block-1" },
    paragraph("Existing"),
    { type: "anchor", id: "block-2" },
    paragraph("Keep"),
  );
  const b = page(
    { type: "anchor", id: "block-1" },
    paragraph("New"),
    { type: "anchor", id: "block-2" },
    paragraph("Existing"),
    { type: "anchor", id: "block-3" },
    paragraph("Keep"),
  );
  assert.deepEqual(analyzeText(a, b).after, [{ path: [1], change: "added" }]);
  assert.deepEqual(analyzeText(a, b).before, []);
});
test("ambiguous replacements, repeated paragraphs, reorders and opaque content remain coarse", () => {
  const repeated = analyzeText(p("same", "same"), p("same", "different"));
  assert.ok(repeated.reasons.includes("ambiguous"));
  const swapped = analyzeText(p("one", "two"), p("two", "one"));
  assert.ok(swapped.before.length && swapped.after.length);
  assert.ok([...swapped.before, ...swapped.after].every((d) => !d.ranges));
  for (const type of ["list", "table", "blockquote"] as const) {
    const result = analyzeText(
      page({ type, children: [paragraph("Old")] }),
      page({ type, children: [paragraph("New")] }),
    );
    assert.ok(result.reasons.includes("unsupported"));
  }
  const image: ContentNode = { type: "image", resource_id: "shot" };
  assert.equal(
    analyzeText(
      page({
        type: "paragraph",
        children: [{ type: "text", text: "Old" }, image],
      }),
      page({
        type: "paragraph",
        children: [{ type: "text", text: "New" }, image],
      }),
    ).coverage,
    "partial",
  );
});
test("inline formatting is retained while URL, formatting and heading changes are coarse", () => {
  const formatted = (text: string, url = "https://example.com") =>
    page({
      type: "paragraph",
      children: [
        {
          type: "strong",
          children: [{ type: "link", url, children: [{ type: "text", text }] }],
        },
      ],
    });
  const a = formatted("quiet"),
    b = formatted("sunny");
  assert.deepEqual(selected(b, analyzeText(a, b).after), ["sunny"]);
  assert.ok(
    analyzeText(a, formatted("quiet", "https://example.org")).reasons.includes(
      "structure",
    ),
  );
  assert.ok(analyzeText(a, p("quiet")).reasons.includes("structure"));
  assert.ok(
    analyzeText(
      page({
        type: "heading",
        level: 1,
        children: [{ type: "text", text: "Same" }],
      }),
      page({
        type: "heading",
        level: 2,
        children: [{ type: "text", text: "Same" }],
      }),
    ).reasons.includes("structure"),
  );
});
test("Unicode edits never split graphemes or normalize the original text", () => {
  for (const [old, next] of [
    ["서울 여행", "부산 여행"],
    ["安静的小屋", "明亮的小屋"],
    ["Hi 👩🏽‍💻!", "Hi 👨🏽‍💻!"],
    ["cafe\u0301", "café"],
    ["🇰🇷 stay", "🇯🇵 stay"],
  ]) {
    const a = p(old),
      b = p(next),
      r = analyzeText(a, b);
    selected(a, r.before);
    selected(b, r.after);
    assert.ok(r.before.length || r.after.length);
  }
  // A grapheme straddling markup boundaries must not be partially decorated.
  const split = (text: string) =>
    page({
      type: "paragraph",
      children: [
        { type: "text", text },
        { type: "emphasis", children: [{ type: "text", text: "\u0301" }] },
      ],
    });
  assert.equal(analyzeText(split("e"), split("a")).coverage, "partial");
});
test("exact code lines and invisible edits retain original newline/whitespace semantics", () => {
  const code = (text: string) =>
    page({ type: "code_block", language: "js", text });
  const a = code('const state = "draft";\nkeep();\n'),
    b = code('const state = "ready";\nkeep();\n');
  assert.deepEqual(selected(b, analyzeText(a, b).after), [
    'const state = "ready";\n',
  ]);
  for (const [old, next] of [
    ["x\n", "x"],
    ["x\r\n", "x\n"],
    ["x", "x "],
    ["", "\n"],
  ]) {
    const result = analyzeText(code(old), code(next));
    assert.ok(result.before.length || result.after.length);
    assert.equal(result.coverage, "partial");
    assert.ok([...result.before, ...result.after].every((d) => !d.ranges));
  }
  assert.equal(analyzeText(p("a b"), p("a  b")).coverage, "partial");
});
test("missing segmentation and excessive output use honest coarse fallbacks", () => {
  const segmenter = Intl.Segmenter;
  try {
    Object.defineProperty(Intl, "Segmenter", {
      value: undefined,
      configurable: true,
    });
    assert.equal(analyzeText(p("old"), p("new")).coverage, "partial");
  } finally {
    Object.defineProperty(Intl, "Segmenter", {
      value: segmenter,
      configurable: true,
    });
  }
  const a: string[] = [],
    b: string[] = [];
  for (let i = 0; i < 25; i++) {
    a.push(`Section ${i}: ${"cat ".repeat(220)}`, `Separator ${i}`);
    b.push(`Section ${i}: ${"dog ".repeat(220)}`, `Separator ${i}`);
  }
  assert.equal(analyzeText(p(...a), p(...b)).coverage, "unavailable");
  let deep: ContentNode = paragraph("deep");
  for (let i = 0; i < 70; i++) deep = { type: "strong", children: [deep] };
  assert.equal(withinTextBudget(page(deep)), false);
});
test("added/removed/empty pages and contributor notes have honest coverage", () => {
  assert.deepEqual(analyzeText(undefined, p("New")).after, [
    { path: [0], change: "added" },
  ]);
  assert.deepEqual(analyzeText(p("Old"), undefined).before, [
    { path: [0], change: "removed" },
  ]);
  assert.equal(analyzeText(undefined, undefined).coverage, "unavailable");
  assert.deepEqual(analyzeText(page(), page()).after, []);
  const a = p("Public"),
    b = p("Public");
  b.notes = [{ id: "note", content: [paragraph("Contributor note")] }];
  assert.equal(analyzeText(a, b).coverage, "partial");
  assert.deepEqual(analyzeText(a, b).after, []);
});
test("input, token, alignment and output budgets fall back honestly", () => {
  assert.equal(withinTextBudget(p("x".repeat(TEXT_LIMITS.units + 1))), false);
  assert.equal(
    analyzeText(p("x".repeat(TEXT_LIMITS.units + 1)), p("y")).coverage,
    "unavailable",
  );
  assert.equal(withinTextBudget(p(...Array(1001).fill("small"))), false);
  assert.ok(
    analyzeText(p("x".repeat(16001)), p("y".repeat(16001))).reasons.includes(
      "budget",
    ),
  );
  assert.ok(
    analyzeText(p("a ".repeat(2100)), p("b ".repeat(2100))).reasons.includes(
      "budget",
    ),
  );
  assert.ok(
    analyzeText(
      p(...Array.from({ length: 130 }, (_, i) => `old ${i}`)),
      p(...Array.from({ length: 130 }, (_, i) => `new ${i}`)),
    ).reasons.includes("budget"),
  );
  assert.ok(
    analyzeText(
      p(Array.from({ length: 1100 }, (_, i) => `a${i}`).join(" ")),
      p(Array.from({ length: 1100 }, (_, i) => `b${i}`).join(" ")),
    ).reasons.includes("budget"),
  );
});
class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  sent?: { id: number; before: Page; after: Page };
  stopped = false;
  postMessage(value: typeof this.sent) {
    this.sent = value;
  }
  terminate() {
    this.stopped = true;
  }
}
test("worker cancellation, request identities, failure, and timeout cannot publish stale results", async () => {
  const worker = new FakeWorker();
  let calls = 0;
  const cancel = requestTextReview(
    p("old"),
    p("new"),
    () => calls++,
    () => worker as unknown as Worker,
  );
  worker.onmessage!({
    data: { id: -1, result: analyzeText(p("old"), p("new")) },
  } as MessageEvent);
  assert.equal(calls, 0);
  cancel();
  assert.ok(worker.stopped);
  worker.onmessage!({
    data: { id: worker.sent!.id, result: analyzeText(p("old"), p("new")) },
  } as MessageEvent);
  assert.equal(calls, 0);
  const stalled = new FakeWorker();
  await new Promise<void>((resolve) =>
    requestTextReview(
      p("old"),
      p("new"),
      (result) => {
        assert.equal(result.coverage, "unavailable");
        assert.ok(stalled.stopped);
        resolve();
      },
      () => stalled as unknown as Worker,
    ),
  );
  requestTextReview(
    p("old"),
    p("new"),
    (result) => {
      assert.equal(result.coverage, "unavailable");
      calls++;
    },
    () => {
      throw new Error("worker blocked");
    },
  );
  assert.equal(calls, 1);
});
