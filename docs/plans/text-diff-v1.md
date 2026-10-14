# Text diff v1 contract

Date: 2026-10-14

Status: **Implemented and released in npm 0.3.0.**

This fixes the high-return first implementation of rendered text review. It
extends [the docs-site contract](../decisions/0002-docs-site-and-git-review.md)
without changing document schemas, historical execution, or exact acceptance.
Implementation was authorized on 2026-10-14. Publication remains separate.

## Tooling decision

Use **jsdiff, npm package `diff`, pinned to `9.0.0`** in `packages/viewer`. The exact published version and BSD-3-Clause license
were checked against npm on 2026-10-14. Commit the lockfile and retain its notice
through the existing Vite license output.

Use its `diffArrays` core for block and text tokens and `diffLines` for code.
Own a small pure TypeScript adapter and render through the existing React content
tree. No Monaco, CodeMirror, editor model, DOM mutation library, second diff
library, or generic plugin layer. Sanity's core remains a considered alternative,
not a parallel implementation or automatic fallback. Do not write a custom
shortest-edit algorithm.

Use native `Intl.Segmenter` with explicit `en` locale and `word` / `grapheme`
granularity. Preserve every segment, including punctuation and whitespace.
Grapheme segmentation protects emoji sequences and combining marks. If the API
is unavailable, show whole-block changes. No additional segmentation polyfill
in v1. Browser/ICU differences may affect presentation boundaries; identical
cross-browser highlight ranges are not an evidence or compatibility promise.

Primary references: [jsdiff v9 API](https://github.com/kpdecker/jsdiff/tree/v9.0.0#api),
[bounded comparison implementation](https://github.com/kpdecker/jsdiff/blob/v9.0.0/src/diff/base.ts),
and [license](https://github.com/kpdecker/jsdiff/blob/v9.0.0/LICENSE).

## Visible result

**View diff** enables text highlights alongside existing image comparisons.
Current shows additions in its own text; Previous shows deletions in its own
text. Neither side contains inserted copies of the other version's content.
The existing Previous / Current controls remain the only document mode switch.

| Content                                                      | First-version behavior                                                                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Top-level headings and paragraphs                            | Word-level changes, preserving existing inline formatting.                                                                   |
| A small replacement within one word                          | Grapheme-level detail under the bounded rule below.                                                                          |
| Code blocks                                                  | Added/deleted line highlights; indentation and line endings count.                                                           |
| Whole added/removed blocks or pages                          | Mark the blocks present on that side, without ghost placeholders on the absent side.                                         |
| Lists, tables, blockquotes, mixed text/image blocks          | Whole-block marking for changed content; no cell or nested-block alignment in v1.                                            |
| Formatting, link destination/title, or heading-level changes | Whole-block modification marking, even if visible text is unchanged.                                                         |
| Contributor notes                                            | Existing note rendering; note-only changes retain the canonical page status and report that detailed text review is partial. |

Existing image widgets, comments, navigation, downloads, and link sanitization
keep their behavior. Missing historical docs remain unavailable. The adapter
never tries to regenerate them.

## Matching and range contract

1. Compare only the selected page pair from already audience-filtered bundles.
   Keep the input immutable. Canonical page and asset status always comes from
   Rust; display heuristics cannot override it.
2. Use top-level rendered blocks as alignment units. Exclude generated anchor
   nodes and positional anchor IDs from matching signatures, but retain original
   tree paths for rendering. Do not use array positions as cross-version identity.
3. Match exact semantic block signatures with `diffArrays`. A signature includes
   node kinds, inline structure, text, and meaningful attributes. It excludes
   presentation-only IDs. Exact unchanged content remains unmarked.
4. Inside an unmatched interval, refine only an unambiguous one-before / one-after
   replacement of compatible block kinds. Reject refinement for repeated
   signatures, unequal block counts, changed inline structure/attributes, or
   unsupported descendants. Do not zip unmatched blocks by index or use fuzzy
   similarity matching. Reorders have no move classification in v1.
5. For compatible prose, flatten text leaves and breaks into an exact text stream
   with a reversible leaf/offset map. Inline code, emphasis and links may retain
   their wrappers only when their structure and attributes match. Images and
   resource-bearing nodes make the block opaque. Map spans back to the original
   leaves; never render diff-library strings as replacement document content.
6. Diff exact word segments, including whitespace. Refine only adjacent deletion
   and insertion runs that each contain one word-like token of at most 64
   graphemes. Use grapheme-token comparison; retain the refinement only when at
   least half the graphemes of the longer word are unchanged. Otherwise keep the
   word-level result. There is no character-mode control.
7. For code, use exact line comparison with whitespace, trailing carriage returns,
   and final newlines significant. Do not tokenize syntax or add a highlighter.
   Whitespace-only or final-newline edits that have no visible glyph receive a
   block marker and an accessible explanation.
8. Ranges are half-open UTF-16 offsets within original text leaves, sorted,
   nonoverlapping, in bounds, and on grapheme boundaries. Never normalize Unicode,
   trim text, collapse whitespace, or split an emoji to make matching easier.
   Any invalid map or range discards refinement for that block.

The internal adapter returns two sets of decorations addressed by original node
paths: text ranges for additions/deletions, or whole-block markers with a reason.
It also returns coverage: `complete`, `partial`, or `unavailable`. Reasons are
explicit: `structure`, `ambiguous`, `unsupported`, `budget`, or `missing-side`.
These types live in the viewer, not the shared wire protocol. A matched unchanged
block needs no decoration. A failed analysis never masquerades as unchanged.

## Layout and accessibility

Use background and inset decoration for ranges and blocks. Do not add padding,
font-weight, borders that consume space, replacement strings, line numbers, or
inline explanatory badges. Preserve authored text, line wrapping, image size,
code scroll, and document geometry when highlights toggle within one version.
Switching between genuinely different versions can naturally change geometry;
this feature does not promise identical layouts across revisions.

Use semantic additions/deletions with inherited typography and unobtrusive
non-color cues. Provide an accessible review summary explaining the selected
side and any coarse fallback. Keep the normal UI concise: show a short partial
review status only when needed; expose reasons in the Versions sheet's Advanced
section. Do not rely on color or hover alone. Preserve keyboard focus, selection,
copyable original text, Light/Dark/System themes and reduced motion.

Supported source-viewer styling hooks: `data-lgtmd-part="text-change"` and
`data-lgtmd-part="block-change"`, with `data-change="added|removed|modified"`.
The authored customization guide documents these hooks. Reuse existing semantic
success/danger tokens. Introduce no animation for text highlights.

## Bounded execution

Run the pure adapter in one browser worker, following the existing Vite worker
pattern. Analyze only the active page. Cache only its completed result by both
bundle digests, page ID, audience and adapter version. Terminate obsolete work
on navigation or revision changes and reject late results by request identity.
Do not persist browser-derived ranges in candidates or exports.

Initial explicit limits, to be asserted in tests:

- At most 1,000 blocks and 200,000 UTF-16 code units per side of a page.
- At most 16,000 code units and 4,000 tokens per refined prose/code block.
- Alignment edit budget 256; per-block edit budget 1,024.
- At most 10,000 emitted text ranges across both sides.
- Worker wall-clock limit 500 ms; terminate on expiry.

Exceeding a block limit gives coarse block marking. Exceeding a page limit or
worker failure leaves canonical page changes available with a short partial
review message; it does not perform another expensive comparison on the UI
thread. Library abort/undefined results are failures to refine, not empty diffs.
These are guardrails, not performance promises. Adjust a limit only with measured
fixture evidence recorded alongside the implementation; never silently lift it.

## Implementation and acceptance

1. Add the exact dependency and a pure adapter with golden A/B fixtures before
   connecting rendering. Assert original-text reconstruction, legal ranges,
   deterministic results within one runtime, and immutable inputs.
2. Connect the bounded worker and existing renderer. Keep all unrelated CLI,
   snapshot, source authoring and application contracts unchanged.
3. Extend the controlled review example and its authored review guide. Demonstrate
   an ordinary word edit, a typo, a code-line edit, and an inserted paragraph
   above existing text. Do not modify Stay for this core milestone.
4. Run viewer unit/type/build/browser checks, the relevant native/npm integration
   gate, and own-guide repeatability/exact checks. Review generated prose and
   captures before explicit baseline recording. Preserve failure diagnostics.

Required regression cases: beginning-of-document insertion, repeated paragraphs,
reordered sections, whole-page additions/removals, empty content, whitespace and
newline-only edits, nested inline markup, changed URLs with identical labels,
Korean/CJK, emoji/ZWJ sequences, combining marks, mixed images, opaque tables/lists,
missing snapshots, worker cancellation/timeouts, oversized inputs, and both
audiences. Reader tests must prove contributor-only text never reaches analysis.

Browser acceptance must demonstrate unchanged same-side geometry and scroll,
original text on selection/copy, working links and image controls, keyboard use,
320px-wide layout, both themes, reduced motion, and a truthful coarse fallback.
Measure the production bundle delta and long-document interaction; include the
new dependency license. Unit results alone do not establish readable highlights.

The feature is complete only after those checks and a readable rendered example.
No new release version, registry publication, tag, commit or push follows from
this contract. Cross-version scroll synchronization, move detection, fine table
or list diffs, syntax-aware code diff, source/unified diff panes, and standalone
change navigation remain later work.

## Implementation evidence (2026-10-14)

The pure adapter, cancellable worker, existing-tree decorations and single-page
cache are implemented in `packages/viewer`. The controlled review example now
includes an inserted paragraph, word replacement, typo correction and exact code
line edit. Stay sources were not part of this change.

- 15 viewer tests and 73 SDK/native integration tests pass. Limits include
  missing segmentation, excessive output, deep input, cancellation and timeout.
- Real Chromium acceptance passes for Reader and Contributor, Light/Dark,
  reduced motion and 320px width. It checks exact same-side geometry/scroll,
  unchanged selection text, preserved links/inline formatting, coarse fallback,
  navigation and oversized-page handling. Intercepted worker messages prove
  Reader input contains no contributor-only note text. Existing image controls
  and navigation acceptance also pass.
- The 180-block fixture took 29 ms from navigation through worker completion and
  rendering in both audience runs on this macOS arm64 development host. This is
  one local observation, not a timing guarantee or a cross-browser measurement.
- Compared with the prepared pre-text-diff viewer, the main JS grows from
  264.56 to 276.64 kB (gzip 81.97 to 86.24 kB), with a separate 13.90 kB worker
  (5.06 kB gzip). CSS grows from 35.80 to 37.42 kB. Vite's license output includes
  jsdiff 9.0.0 and its BSD-3-Clause notice.
- Clean offline Cargo/npm consumers pass, including the packed frontend without
  Rust or Playwright installed and the separately installed optional browser
  adapter. Own-guide controlled runs match exactly. Reviewed guide sources and
  the explicit Reader snapshot are recorded; generated files were not edited.

The new screenshot bytes differ only at 64 corner/edge pixels from the earlier
capture: the extended document allows the image to scroll fully to its requested
capture position. Dimensions and interior pixels are unchanged, and fresh runs
repeat exactly. The reviewed guide candidate for this implementation was
`275d71d254b7b4f7052cd9d1f49701194523f6a85a877333da9d23b6461b7f70`.
Verification excludes the concurrently edited Stay example and makes no claim
about other browser engines or publication readiness.

Delivery review added a sixteenth viewer regression for 40 levels of nested
inline markup. Block signatures now serialize their tree once at the root,
avoiding repeated string escaping that could exhaust the worker's budget on a
small document. Exact word highlights remain available for this case.
