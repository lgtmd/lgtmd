import { diffArrays, diffLines } from "diff";
import type { ContentNode, Page } from "./protocol.ts";

export const TEXT_DIFF_VERSION = 1;
export const TEXT_LIMITS = {
  blocks: 1000,
  units: 200_000,
  blockUnits: 16_000,
  tokens: 4000,
  alignment: 256,
  edits: 1024,
  ranges: 10_000,
  timeout: 500,
} as const;
export type Reason =
  | "structure"
  | "ambiguous"
  | "unsupported"
  | "budget"
  | "missing-side";
export interface Decoration {
  path: number[];
  change: "added" | "removed" | "modified";
  ranges?: { start: number; end: number }[];
  reason?: Reason;
}
export interface TextReview {
  before: Decoration[];
  after: Decoration[];
  coverage: "complete" | "partial" | "unavailable";
  reasons: Reason[];
}
export const unavailableTextReview = (reason: Reason): TextReview => ({
  before: [],
  after: [],
  coverage: "unavailable",
  reasons: [reason],
});

// The preflight also runs before posting to the worker. Stop traversing oversized
// input rather than serializing it into a second unbounded copy.
export function withinTextBudget(page?: Page): boolean {
  if (!page) return true;
  if (page.content.length > TEXT_LIMITS.blocks * 2) return false;
  if (page.notes.length > 1000) return false;
  const stack = page.content.map((node) => ({ node, depth: 0 }));
  for (const note of page.notes) {
    if (stack.length + note.content.length > 20_000) return false;
    stack.push(...note.content.map((node) => ({ node, depth: 0 })));
  }
  let units = 0,
    nodes = 0,
    blocks = 0;
  for (const node of page.content) if (node.type !== "anchor") blocks++;
  if (blocks > TEXT_LIMITS.blocks) return false;
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (depth > 64) return false;
    if (++nodes > 20_000) return false;
    for (const value of Object.values(node))
      if (typeof value === "string") units += value.length;
    if (units > TEXT_LIMITS.units) return false;
    if (node.children) {
      if (stack.length + node.children.length > 20_000) return false;
      stack.push(...node.children.map((node) => ({ node, depth: depth + 1 })));
    }
  }
  return true;
}
function signature(node: ContentNode, structure = false): string {
  return JSON.stringify(signatureValue(node, structure));
}
// Serialize once at the root; recursively stringifying child strings doubles
// escaping at each nesting level even for a tiny document.
function signatureValue(
  node: ContentNode,
  structure: boolean,
): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  for (const key of Object.keys(node).sort() as (keyof ContentNode)[]) {
    if (key === "id" && (node.type === "anchor" || node.type === "heading"))
      continue;
    if (key === "text" && structure) continue;
    value[key] =
      key === "children"
        ? node.children
            ?.filter((n) => n.type !== "anchor")
            .map((n) => signatureValue(n, structure))
        : node[key];
  }
  return value;
}
interface Block {
  node: ContentNode;
  path: number[];
  signature: string;
}
interface Leaf {
  path: number[];
  text: string;
  start: number;
  break: boolean;
}
function flatten(
  node: ContentNode,
  path: number[],
): { text: string; leaves: Leaf[] } | undefined {
  let text = "";
  const leaves: Leaf[] = [];
  function visit(n: ContentNode, p: number[]): boolean {
    if (
      n.resource_id ||
      n.type === "image" ||
      ![
        "paragraph",
        "heading",
        "text",
        "emphasis",
        "strong",
        "strikethrough",
        "link",
        "code",
        "key",
        "soft_break",
        "hard_break",
        "code_block",
      ].includes(n.type)
    )
      return false;
    if (n.text !== undefined || n.type.endsWith("break")) {
      const value = n.text ?? "\n";
      leaves.push({
        path: p,
        text: value,
        start: text.length,
        break: n.type.endsWith("break"),
      });
      text += value;
    }
    return (n.children ?? []).every((child, i) => visit(child, [...p, i]));
  }
  return visit(node, path) ? { text, leaves } : undefined;
}
interface Span {
  start: number;
  end: number;
}
export function analyzeText(before?: Page, after?: Page): TextReview {
  if (!before && !after) return unavailableTextReview("missing-side");
  if (!withinTextBudget(before) || !withinTextBudget(after))
    return unavailableTextReview("budget");
  const result: TextReview = {
    before: [],
    after: [],
    coverage: "complete",
    reasons: [],
  };
  function partial(reason: Reason) {
    result.coverage = "partial";
    if (!result.reasons.includes(reason)) result.reasons.push(reason);
  }
  const blocks = (page?: Page): Block[] =>
    (page?.content ?? []).flatMap((node, i) =>
      node.type === "anchor"
        ? []
        : [{ node, path: [i], signature: signature(node) }],
    );
  const a = blocks(before),
    b = blocks(after);
  const mark = (items: Block[], side: "before" | "after", reason?: Reason) => {
    result[side].push(
      ...items.map((block) => ({
        path: block.path,
        change: reason
          ? ("modified" as const)
          : side === "before"
            ? ("removed" as const)
            : ("added" as const),
        ...(reason ? { reason } : {}),
      })),
    );
    if (reason) partial(reason);
  };
  if (!before || !after) {
    mark(a, "before");
    mark(b, "after");
    return result;
  }
  if (JSON.stringify(before.notes) !== JSON.stringify(after.notes))
    partial("unsupported");
  const alignment = diffArrays(
    a.map((x) => x.signature),
    b.map((x) => x.signature),
    { maxEditLength: TEXT_LIMITS.alignment },
  );
  if (!alignment) {
    mark(a, "before", "budget");
    mark(b, "after", "budget");
    return result;
  }
  const frequencies = (items: Block[]) => {
    const map = new Map<string, number>();
    for (const item of items)
      map.set(item.signature, (map.get(item.signature) ?? 0) + 1);
    return map;
  };
  const fa = frequencies(a),
    fb = frequencies(b);
  const word =
    typeof Intl.Segmenter === "function"
      ? new Intl.Segmenter("en", { granularity: "word" })
      : undefined;
  const grapheme =
    typeof Intl.Segmenter === "function"
      ? new Intl.Segmenter("en", { granularity: "grapheme" })
      : undefined;
  const boundaries = (text: string) =>
    new Set([
      0,
      ...Array.from(grapheme!.segment(text), (s) => s.index + s.segment.length),
    ]);
  function refine(left: Block, right: Block): Reason | undefined {
    if (!word || !grapheme) return "unsupported";
    if (
      left.node.type !== right.node.type ||
      signature(left.node, true) !== signature(right.node, true)
    )
      return "structure";
    if (!["paragraph", "heading", "code_block"].includes(left.node.type))
      return "unsupported";
    const x = flatten(left.node, left.path),
      y = flatten(right.node, right.path);
    if (!x || !y) return "unsupported";
    if (Math.max(x.text.length, y.text.length) > TEXT_LIMITS.blockUnits)
      return "budget";
    const code = left.node.type === "code_block";
    if (
      code &&
      x.text !== y.text &&
      x.text.replace(/\s/g, "") === y.text.replace(/\s/g, "")
    )
      return "structure";
    const tokenize = (text: string) =>
      code
        ? (text.match(/[^\n]*\n|[^\n]+$/g) ?? [])
        : Array.from(word.segment(text), (s) => s.segment);
    const xt = tokenize(x.text),
      yt = tokenize(y.text);
    if (Math.max(xt.length, yt.length) > TEXT_LIMITS.tokens) return "budget";
    const changes = code
      ? diffLines(x.text, y.text, {
          maxEditLength: TEXT_LIMITS.edits,
          ignoreWhitespace: false,
          ignoreNewlineAtEof: false,
          stripTrailingCr: false,
        })?.map((c) => ({ ...c, value: [c.value] }))
      : diffArrays(xt, yt, { maxEditLength: TEXT_LIMITS.edits });
    if (!changes) return "budget";
    const xs: Span[] = [],
      ys: Span[] = [];
    let xi = 0,
      yi = 0;
    for (let i = 0; i < changes.length; i++) {
      const c = changes[i],
        next = changes[i + 1];
      const text = c.value.join("");
      if (
        !code &&
        c.removed &&
        next?.added &&
        c.value.length === 1 &&
        next.value.length === 1 &&
        Array.from(word.segment(text)).every((s) => s.isWordLike) &&
        Array.from(word.segment(next.value[0])).every((s) => s.isWordLike)
      ) {
        const gx = Array.from(grapheme.segment(text), (s) => s.segment),
          gy = Array.from(grapheme.segment(next.value[0]), (s) => s.segment);
        if (Math.max(gx.length, gy.length) <= 64) {
          const detail = diffArrays(gx, gy, { maxEditLength: 128 })!;
          const common = detail
            .filter((d) => !d.added && !d.removed)
            .reduce((n, d) => n + d.count, 0);
          if (common * 2 >= Math.max(gx.length, gy.length)) {
            for (const d of detail) {
              const length = d.value.join("").length;
              if (d.removed) {
                xs.push({ start: xi, end: xi + length });
                xi += length;
              } else if (d.added) {
                ys.push({ start: yi, end: yi + length });
                yi += length;
              } else {
                xi += length;
                yi += length;
              }
            }
            i++;
            continue;
          }
        }
      }
      if (c.removed) {
        xs.push({ start: xi, end: xi + text.length });
        xi += text.length;
      } else if (c.added) {
        ys.push({ start: yi, end: yi + text.length });
        yi += text.length;
      } else {
        xi += text.length;
        yi += text.length;
      }
    }
    if (xi !== x.text.length || yi !== y.text.length) return "structure";
    // An invisible edit still needs a visible, non-layout-consuming block mark.
    if (
      [
        ...xs.map((s) => x.text.slice(s.start, s.end)),
        ...ys.map((s) => y.text.slice(s.start, s.end)),
      ].some((s) => !s.trim())
    )
      return "structure";
    function map(
      leaves: Leaf[],
      text: string,
      spans: Span[],
      side: "before" | "after",
    ): Decoration[] | undefined {
      const globalBoundaries = boundaries(text);
      const decorations: Decoration[] = [];
      for (const leaf of leaves) {
        const localBoundaries = boundaries(leaf.text);
        const ranges: Span[] = [];
        for (const span of spans) {
          const start = Math.max(span.start, leaf.start),
            end = Math.min(span.end, leaf.start + leaf.text.length);
          if (start >= end) continue;
          if (
            leaf.break ||
            !globalBoundaries.has(start) ||
            !globalBoundaries.has(end) ||
            !localBoundaries.has(start - leaf.start) ||
            !localBoundaries.has(end - leaf.start)
          )
            return;
          const range = { start: start - leaf.start, end: end - leaf.start };
          const last = ranges.at(-1);
          if (last?.end === range.start) last.end = range.end;
          else ranges.push(range);
        }
        if (ranges.length)
          decorations.push({
            path: leaf.path,
            change: side === "before" ? "removed" : "added",
            ranges,
          });
      }
      return decorations;
    }
    const previous = map(x.leaves, x.text, xs, "before"),
      current = map(y.leaves, y.text, ys, "after");
    if (!previous || !current) return "structure";
    result.before.push(...previous);
    result.after.push(...current);
  }
  let ai = 0,
    bi = 0,
    removed: Block[] = [],
    added: Block[] = [];
  function flush() {
    if (!removed.length && !added.length) return;
    if (!removed.length) mark(added, "after");
    else if (!added.length) mark(removed, "before");
    else {
      const reason =
        removed.length === 1 &&
        added.length === 1 &&
        fa.get(removed[0].signature) === 1 &&
        fb.get(added[0].signature) === 1
          ? refine(removed[0], added[0])
          : "ambiguous";
      if (reason) {
        mark(removed, "before", reason);
        mark(added, "after", reason);
      }
    }
    removed = [];
    added = [];
  }
  for (const change of alignment) {
    if (change.removed) {
      removed.push(...a.slice(ai, ai + change.count));
      ai += change.count;
    } else if (change.added) {
      added.push(...b.slice(bi, bi + change.count));
      bi += change.count;
    } else {
      flush();
      ai += change.count;
      bi += change.count;
    }
  }
  flush();
  if (
    [...result.before, ...result.after].reduce(
      (n, d) => n + (d.ranges?.length ?? 0),
      0,
    ) > TEXT_LIMITS.ranges
  )
    return unavailableTextReview("budget");
  return result;
}
