# Docs site v1 implementation plan

Status: **V1 implemented and verified with one native CLI; included in npm 0.2.0**

Date: 2026-10-14

This is the execution contract for the first usable docs site. It refines
[Decision 0002](../decisions/0002-docs-site-and-git-review.md) and the
[user guide](../../docs/guide/develop-and-record.md). The approved GO covered all
acceptance gates below, including the complete working CLI and browser experience.
This is a feature milestone, not a package version or release authorization.

## 1. Required result

1. An installed `lgtmd dev` command starts a local docs site, runs a configured
   flow, and displays its completed documentation. Explicit retained-output reuse
   and opt-in full-flow watching work.
2. A **View diff** control compares the current candidate with a selected Git
   revision. V1 presents rendered **Previous / Current** views and changed-page
   navigation. The engine supplies changes and content, not a mandated layout.
3. Changed images offer **Before / After** side by side and optional **Regions**
   boxes for compatible static screenshots. Image visualization runs in the
   client and cannot change exact artifact-check results.
4. lgtmd's own user-facing guides are authored through lgtmd. A real executable
   guide demonstrates the real comparison UI and includes captured evidence.
   There is one narrative source and no recursive screenshot dependency.

`build`, `preview`, exact `check`, and explicit candidate `update` complete that
workflow. Foundational correctness, readable output, keyboard operation, and a
working consumer experience are required. Brand styling and elaborate layouts
can follow later. Predecessors are interaction references, not implementation
templates or dependencies.

## 2. Commands and configuration

Ship one Rust-owned `lgtmd` executable from `crates/lgtmd-cli`. It owns command
parsing, project configuration, flow execution, candidate retention, Git reads,
watching, HTTP serving and static assembly. npm supplies a thin launcher that
selects its bundled platform binary and forwards arguments, streams, signals
and exit status. It contains no second implementation of these behaviors.

The same executable carries an internal coarse SDK bridge. The compiler remains
in the independent `lgtmd` library, and the TS SDK retains native JS authoring,
async callbacks and Playwright integration. The React frontend is compiled into
the executable. Native serving and Rust-authored flows need no Node runtime;
JS-authored flows need their normal runtime. Building the frontend from source
is contributor preparation and requires Node. Keep the existing verified native
targets; do not introduce WASM or a new registry release in this migration.
Command examples name the executable; npm users may use a package script or
`npm exec -- lgtmd ...`. Native source users prepare assets and can install with
`cargo install --path crates/lgtmd-cli --locked`. CLI crate publication remains
separate, explicitly authorized release work.

| Command                       | V1 behavior                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lgtmd dev`                   | Start a loopback server with a running/status page, execute the configured flow once, then show the completed candidate.                               |
| `lgtmd dev --watch`           | Also rerun the whole flow when a configured input changes. Refresh only after successful completion.                                                   |
| `lgtmd dev --reuse`           | Open the last valid retained candidate without running the flow. Label it as retained output, not newly verified state. Fail clearly if there is none. |
| `lgtmd build`                 | Run once and write a Reader static site through an owned, staged output transaction. Never accept a snapshot or deploy.                                |
| `lgtmd preview`               | Serve the existing static site only. Never run or import authoring code.                                                                               |
| `lgtmd check`                 | Run once and compare the selected audience's completed bundle/resources exactly against its accepted snapshot. Exit nonzero on drift or failure.       |
| `lgtmd update --candidate ID` | Validate and copy that immutable retained candidate into the selected audience's accepted snapshot. Never rerun authoring or write Git history.        |

Common options: `--config PATH`, `--audience reader|contributor` (Reader by
default). Dev additionally accepts `--base REF`, `--port PORT` and the flags
above; preview accepts `--port`. Default port is 4177; an occupied explicitly or
implicitly chosen port fails with an actionable message, and port 0 supports
isolated tests. Bind only to `127.0.0.1` in v1. `--help` and `--version` work
without a config or executing a flow. Invalid flags fail before effects.

`--reuse --watch` is rejected in v1 so read-only reuse and flow execution are
unambiguous. The dev UI has an explicit **Run again** action for normal dev mode;
it is disabled in reuse mode. Browser reload, revision selection, audience
presentation, and image modes never trigger execution.

Use a passive `lgtmd.config.json` file, selected in the current directory or via
`--config`; do not search arbitrary parents for application configuration. Paths
resolve relative to its directory. The maintained examples will use this shape:

```json
{
  "schemaVersion": 1,
  "title": "Acme docs",
  "flow": {
    "command": ["node", "docs/authoring/run.ts"],
    "cwd": ".",
    "watch": ["docs/authoring", "src"],
    "timeoutMs": 600000
  },
  "snapshots": "docs/snapshots",
  "cacheDir": ".cache/lgtmd",
  "outDir": "build/docs",
  "basePath": "/docs/",
  "theme": { "css": "docs/theme.css" },
  "navigation": ["getting-started", "review-changes"],
  "git": { "base": "HEAD" }
}
```

Only `flow.command` is required for commands that execute it. Schema version
defaults to 1 when omitted. Other defaults are title
`Documentation`, flow cwd `.`, timeout 600000 ms, empty watch roots, snapshots
`docs/snapshots`, cache `.cache/lgtmd`, output `build/docs`, base path `/`, and
Git base `HEAD`. Without navigation configuration, sort by page ID. An explicit
navigation list must name each page once; unknown/duplicate/missing entries fail.
Configuration version and unknown fields are validated. Commands that need a
runner reject a missing command; preview does not require one.

`command` is a nonempty argv array spawned without a shell. An inherited local
environment supports ordinary tools; temporary lgtmd handoff variables are
reserved. A Rust flow can use `["cargo", "run", "--example", "guides"]`.
Configuration does not describe services, databases, browsers, mocks, or seeds.
The flow owns those through its normal runtime and fixtures. Runtime-specific
settings and capture profiles stay with that flow.

Validate output/cache/snapshot locations and transaction namespaces before
execution. Refuse unsafe overlaps, source-root replacement, or symlink escapes.
`--watch` requires at least one existing configured file/directory root. V1
watches files/directories, not a new glob/configuration language. Generated
paths, `.git`, dependencies, caches, and transaction siblings are excluded.

## 3. Run completion, reuse, and watching

There is no inferred input cache in v1. A flow may depend on a server, database,
clock, or environment that lgtmd cannot fingerprint. Default dev/build/check run
fresh. Reuse means displaying an existing result, never claiming its inputs are
unchanged. Do not skip arbitrary flows based only on source mtimes.

The CLI gives each run a fresh handoff file and unique token through
`LGTMD_OUTPUT` and `LGTMD_RUN_ID`. Add equivalent helpers:

- Node `completeRun(documents)` writes the handoff after `runGuide` or another
  project-owned workflow and its cleanup have completed.
- Rust `handoff::complete_run(&documents)` freezes completed `Document`s through
  the existing transport contract and writes the same envelope.
- Node `collectPlaywright(options)` returns completed frozen documents only
  after the real process, fixtures, teardown, and guarded reporters succeed.
  Refactor existing `runPlaywright` into collect then publish without changing
  its API or restrictions. Collection has no `build/check/update` side effect.

The handoff contains its version, run token, and the existing schema-v1 input.
It is not the site bundle. The CLI waits for successful process close, validates
the token and frozen input, then compiles both audiences from that one run. A
receipt written before a later failure is rejected. Raw input is private staging
data, never served or placed in public output, and is removed after processing.

Retain completed results under content-addressed candidate directories. A
candidate ID covers both audience bundles and resources; run times, process
status, source revision, dirty-state information, and temporary paths stay in a
separate run record. Resolve a selected candidate by its immutable identity,
not by a mutable `latest` directory. Scope the last-success pointer to the
canonical config path and normalized authoring config digest (excluding the
presentation-only theme path and bytes), even when several configs
share a cache directory. Reuse retains that candidate's original site metadata.
Validate hashes before serving/accepting it. Private candidate identity may cover
both audiences; public exports and recorded snapshots expose only their own
audience-specific digest.

At admission also retain the existing compiler's Markdown/resource exports from
the same completed input, for the explicit own-guide recording command. These
are not extra authored sources, are not served as raw authoring input, and do
not change existing Markdown bytes. The site snapshot/check contract compares
site evidence; the maintained Markdown guide has its own exact verification.

Run state is `idle`, `running`, `succeeded`, `failed`, or `cancelled`. An older
successful page remains available during a run/failure with a prominent stale
status. Initial failure shows diagnostics instead of an empty successful page.
The candidate being viewed and any pending run are separately identified.
Dev stays open after a flow failure; build/check exit nonzero. Startup/config
errors fail immediately.

Watch debounces events and permits only one flow at a time. Events during a run
request one follow-up run; do not kill a valid run on every save. Events trigger a
whole flow, not guessed partial execution. Watch errors remain visible. Config
changes require restarting dev in v1. On shutdown/timeout, forward termination
to the flow process group, allow cleanup, and prevent admission of interrupted
output; reap owned children. External services remain the project's responsibility.

Serve HTTP and a small status/event stream in Rust; live refresh consumes those
events and completed bundles. Mutation endpoints are same-origin, loopback-only
and require the server session token. Do not expose arbitrary filesystem paths,
shell commands, or configuration-supplied HTML through endpoints.

## 4. Engine-owned document and comparison contracts

Add focused `site`, `review`, and `handoff` modules in the existing Rust crate.
The native bridge exposes coarse compile-site, validate-site, compare-site, and
site-store operations. Keep host callbacks, Git execution, HTTP, and watching in
the CLI. Existing schema-v1 authoring and Markdown exports remain byte-compatible.

The versioned site bundle contains:

| Data                        | Responsibility                                                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format version and audience | Reject incompatible input; distinguish Reader from Contributor before serialization.                                                                      |
| Site metadata               | Logical site title and resolved page order/navigation, included in the audience digest. Deployment base path and frontend assets remain outside evidence. |
| Pages                       | Stable page ID, title, ordered safe content tree, section/block anchors and resource references.                                                          |
| Notes                       | Contributor-only content with validated target references; absent from Reader data.                                                                       |
| Resources                   | Page ID + resource ID, relative path, MIME, exact byte hash, byte length, producer/profile, and sidecar bytes.                                            |
| Bundle digest/inventory     | Validate complete content, references, files and ownership; no Git IDs or runtime timestamps inside content.                                              |

Generate a small safe content tree using the existing CommonMark parser and
typed references: text, emphasis, strong text, code/keys, headings, paragraphs,
lists, quotes, tables, links, images, and fenced code. Parse completed Markdown
with its source mapping; do not parse authored nodes independently, since
current Markdown parts permit paragraph continuation across node boundaries.
Retain anchors/target mapping for notes without inventing cross-revision block
identity. Existing raw-HTML and URL validation must not become weaker.

Notes can target blocks, resources, checks, observations, and bindings. Attach a
note to an actual visible occurrence when one exists; otherwise show it as a
page-level Contributor note labeled with its typed target. Retain the minimal
audience-filtered target catalog for validation. Do not reject a valid SDK note
because its evidence target has no DOM anchor, or invent a nonexistent anchor.

The frontend renders this tree with fixed components; it does not execute MDX,
author code, arbitrary HTML, scripts, event handlers, or unsanitized URLs. Validate
untrusted retained bundles as thoroughly as fresh ones. Content hashes alone do
not establish that a bundle is safe. External links can remain links; remote
images are linked rather than fetched into the owned capture/diff workflow in v1.
Resource paths/links resolve relative to their own bundle and selected revision,
so equal filenames from different revisions cannot accidentally share bytes.

Compile and validate Reader and Contributor projections before output. Exclude
private notes, unused private resources, private/unreferenced observation
payloads, and private metadata from Reader delivery. Publicly referenced
observation values remain resolved in the Reader content. A public comparison uses Reader on both sides.
No hidden Contributor payload may be shipped for a later toggle.

The comparison result is versioned data containing the two bundle identities,
page pairs and resource pairs. Each pair has `added`, `removed`, `changed`, or
`unchanged` status and available before/after references. Resource compatibility
and its reason are separate from byte-change status. A page changes when its
title/content or its referenced resource bytes/metadata change; an image-only
change cannot leave its page marked unchanged. Note-only changes cannot alter a
Reader comparison. Retained title/order/navigation changes are reported
separately from page content changes. Historical snapshots use their own recorded
page list/order, never the current config's exhaustive navigation list. This
allows legitimate added/removed pages; validate current configuration only when
compiling a new candidate.

Match pages by ID and resources by `(page ID, resource ID)`. Renames are add/remove
unless identities stay fixed. Automatic block IDs are positional; v1 makes no
semantic paragraph matching, inferred-rename, or inline word-diff guarantee.
The complete safe content on each side permits those future client presentations
without changing the existing page/resource concepts.

Engine results contain no tab/split layout, React elements, pixel thresholds,
rectangles, masks, or browser canvas data. Image display analysis never feeds
back into the exact comparison result.

## 5. Snapshot storage and Git

The accepted snapshot paths are `snapshots/reader/` and, only when explicitly
requested, `snapshots/contributor/`. Reader is the default for check/update/build.
The cache may hold both audiences but is local/private. Document that committing
Contributor snapshots exposes them to everyone with repository access; never
publish or track them automatically.

Implement a site-specific store policy over the existing generic artifact
lifecycle. The old Markdown store validator is not a site validator. Preserve
owned-output checks, path separation, staged replacement, rollback/recovery, and
clear interruption failures. Do not weaken the old store or reinterpret its
receipts. The generic lifecycle currently rejects removal of old owned files.
Add a narrow replacement/retirement policy for the new site and static-output
stores: validate the complete old inventory, stage the complete new owned tree,
and retire obsolete owned paths only in the guarded replacement transaction.
This must handle removed pages/resources and changing hashed frontend filenames.
Never manually pre-delete them or allow unrelated files to be swept away.
Preserve legacy Markdown retirement behavior and cover rollback on failure.
Acceptance is one explicit audience transaction, not a claimed atomic write
across both projections.

`update --candidate ID` copies the verified reviewed bytes without executing a
flow. Refuse an unknown/tampered candidate before any baseline write. Read the
candidate into one immutable validated byte set and publish that same set; do
not validate paths then reopen mutable files during acceptance. Show the
accepted identity and destination. `check` runs fresh, compares the selected
audience's exact completed snapshot bytes, and does not include dev status,
frontend JS builds, transient Git metadata, or timestamps in evidence checks.
Presentation/assets have their own tests. Recording/acceptance never commits.

Git review defaults to the snapshot at exact `HEAD` against the selected working
candidate. `--base REF` and the UI revision selector resolve that exact commit.
Display the ref, resolved SHA, audience and candidate identity. Do not silently
substitute a merge base or latest available snapshot. A future PR adapter may
explicitly resolve a merge base without changing this comparison contract.

Use the Git repository containing the config; optionally allow `git.root` for
explicit selection and validate that snapshots are within it. Support ordinary
worktrees through Git itself, with no assumption that `.git` is a directory.
No assumed remote, branch name, Git provider, or application repository topology.
Read objects with argument arrays and bounded `rev-parse`, `ls-tree -z`, and
`cat-file` operations. Resolve refs before path lookup; no shell interpolation,
checkout, fetch, index mutation, historical execution, or automatic LFS download.

Distinguish no Git repository, unknown/unavailable revision, missing snapshot,
unsupported bundle version, missing/corrupt resource, and unhydrated LFS pointer.
An empty baseline is only valid for a genuinely recorded empty side if the
format supports it; absence is not evidence of no change. In v1 a missing bundle
shows **No recorded docs at this revision**. A missing required image invalidates
that comparison rather than being silently omitted. Keep current docs readable.

Selecting a revision never changes accepted snapshots or reruns the flow.
Without Git, dev/build/preview still function; Git review explains unavailability.
Historical Contributor review requires an actual Contributor snapshot, with no
fallback that invents absent notes from Reader history.

## 6. Frontend and static output

Use a private React/Vite workspace for the reusable frontend. Reuse the versions
already pinned for the React example, without coupling the implementation to that
example or requiring consumers to install Vite/React in their application.
Embed built frontend assets in the shared native executable shipped by npm and native installations. The frontend is not
the project marketing website and does not require Astro or hosted services.

The reading UI provides navigation, a page title, accessible content, resources,
section links and contributor notes at their owning content. Basic responsive
layout and keyboard-accessible controls are part of v1. No custom theme engine,
MDX runtime, editor, search service, or plugin framework is required.

**View diff** toggles ordinary reading into review of the same page/components.
Show a changed-page list and Previous/Current tabs; added/removed pages have an
explicit missing side. Provide image-pair inspection beside the relevant page.
Leave inline HTML diff and synchronized split reading to later client work. A
control can change its representation without needing new engine semantics.

Static builds are self-contained files with local frontend assets and content.
An owned output directory contains exactly one selected audience and an audience
receipt. Rebuilding it for Reader must retire every previous Contributor-only
file; preview rejects an audience mismatch. No mixed-audience parent directory
is presented as the deployable site.
Use a root entry and hash-based page/section navigation for v1, so deep links
work on basic static hosts without rewrite rules. Base paths `/` and `/docs/`
must both work. Human-readable pre-rendered page URLs/SEO can follow without
changing document IDs or bundles. Public builds contain only the chosen audience
and no dev server endpoints, Git directory, raw handoff, or hidden other audience.
V1 public static output is a reading site; interactive project-history review is
local. The public self-doc screenshots illustrate review without shipping private
historical data. Preview serves that same built output, not a new dev run.

## 7. Image comparison is a client capability

Provide a small frontend interface over two immutable resource descriptors and
bytes. Built-in modes advertise eligibility and render their view. This is an
internal component boundary, not a public plugin registry. Resource byte status
and capture compatibility remain supplied by the engine.

Ship these two modes:

- **Before / After**, the default: labeled images, revision identity, natural
  dimensions, and explicit missing-side/profile notices. Available when the
  browser can display the resources. Never stretch different-size images to
  falsely align their coordinates.
- **Regions**, optional per comparison: for equal-size, static PNG/WebP with
  matching declared capture profiles. Decode at natural resolution, compare
  RGBA pixels, mark dirty 16-by-16 pixel tiles, group connected tiles, and draw
  bounding rectangles on the current image. Include all changed pixels; no
  perceptual threshold or ignored small regions. Explain that boxes group
  changed pixels and are not semantic UI-element detection.

Run Regions lazily in a browser worker; decoded data and geometry stay out of the
bundle, Rust bridge, and server protocol. Use a documented initial budget of
8 million pixels per image and a bounded encoded input size of 32 MiB. Inspect
headers/dimensions and animation markers before allocating a comparison buffer.
Cancel stale work when the pair changes. Missing browser capabilities, oversized
input, corrupt decoding, profile/dimension mismatch, SVG, JPEG, GIF, APNG, and
animated WebP keep Before/After with a specific Regions-unavailable reason.
Do not add a mandatory server compute path for those cases.

SVG is displayed only through an image element, never injected into the DOM.
Animated image previews are independent playback, not frame-aligned comparison.
Equal decoded pixels do not make changed resource bytes unchanged: say the bytes
changed but no decoded pixel change was found. Browser decoding may differ across
environments; this analysis is a review aid, never baseline acceptance or the
canonical regression verdict.

Raw pixel masks, perceptual scores, SSIM, polygon outlines, anti-alias tolerances,
animation synchronization, and GPU analysis are deferred. Client code can gain
new modes later over the same pair of resource versions.

## 8. lgtmd's own executable documentation

Add `docs/authoring/` for the sole maintained sources of user-facing guides and
a root config running them. At minimum cover getting started/current limits,
developing and recording guides, and reviewing text/images/contributor notes.
Port the existing draft into those sources and generate `docs/guide/` Markdown
and media for repository reading. The site uses the same completed documents.
Exclude generated output from formatting. Keep engineering plans/decisions as
ordinary maintained Markdown; do not force all repository notes into scenarios.
Normal `dev`, `build`, and `check` only produce candidates or the ignored static
site; they never overwrite tracked `docs/guide/` files. Add a maintainer-only
`just docs-record CANDIDATE_ID` recipe that validates that own-doc candidate and
records its already compiled Reader Markdown/media explicitly, with the same
owned replacement safeguards. It does not rerun the scenario. Verification
compares fresh output against the tracked guide exactly.

Provide verified repository shortcuts: `just docs` for local dev,
`just docs-build`, `just docs-preview`, and `just docs-demo`. They invoke the
workspace CLI, not a global or previously published binary.

The root `lgtmd dev` experience builds these real guides. Their runner can combine
explanation-only pages with one guarded browser scenario. The browser scenario
uses public SDK APIs, not private compiler internals or hand-built documentation
JSON. Separate prose, checks, capture, notes and cleanup explicitly.

Build the demonstration in this order:

1. Build reusable frontend/CLI assets once as normal repository preparation.
2. A small maintained `examples/review` app/flow uses normal Playwright capture
   and SDK authoring to produce controlled versions A and B: one text edit and
   one screenshot edit, fixed page/resource identities, and public sample notes.
3. Prepare a disposable Git repository containing recorded A and B snapshots,
   with fixed local commit metadata and no dependence on global hooks/signing.
   Record both audiences using only public sample notes; the contributor demo
   launches explicitly with `--audience contributor`. Test Reader exclusion
   separately rather than using the public sample as a privacy test.
   The candidate B can be compared against a named local A revision.
4. Launch the actual CLI against that explicit example configuration on an
   isolated port. The example flow has no dependency on the final user guide.
5. The own-doc scenario selects **View diff**, verifies the selected revisions
   and known changes, switches Previous/Current, inspects Before/After and Regions,
   and captures the review region. Compose its explanation and capture through
   lgtmd after the normal guarded browser completion.
6. Export the final user guides. Neither those pages nor their captured review
   images are inputs to A/B. Navigation and static export reuse completed output.

This is a finite two-stage build, not a self-hosted server that recursively calls
the root docs flow. All browser services are isolated, dynamic ports are excluded
from captured areas, and cleanup is tested. Assert Git identity outside screenshot
regions or fix fixture metadata; do not conceal failure indicators to get stable
captures. Screenshots may include only intentionally public sample contributor
notes, because export filtering cannot remove secrets already drawn into pixels.

Ship and document a `just docs-demo` convenience command for contributors that
prepares the disposable example and starts its real `lgtmd dev` session. Consumers
can run the same maintained example with the installed CLI. Label its UI/title
as a demonstration. It must work before any implementation source is committed.
Never invent a baseline at the actual repository's `HEAD`. The root docs site
shows missing historical snapshots honestly until users record and commit them.
Completion delivery includes both the own-doc site and a working live demo URL,
so the diff can be tried immediately without changing source history.

## 9. Code ownership and shipping

| Location                             | Planned changes                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `crates/lgtmd/src/site/`             | Safe content export, bundle validation, canonical bytes and site-store policy over generic lifecycle. |
| `crates/lgtmd/src/review.rs`         | UI-independent page/resource comparison and compatibility.                                            |
| `crates/lgtmd/src/handoff.rs`        | Completed Rust flow handoff, separate from pure compiler semantics.                                   |
| `crates/lgtmd-cli/`                  | Shared commands, config, runner, Git, server, embedded assets and coarse SDK operations.              |
| `packages/lgtmd/src/`                | Typed site/handoff APIs, guarded Playwright collection, and a thin native executable launcher.        |
| `packages/viewer/`                   | Private React/Vite frontend and image-analysis worker; no independent public package required.        |
| `docs/authoring/`, `docs/guide/`     | Executable sources and generated Reader guide, respectively.                                          |
| `examples/review/`                   | Controlled application, revision fixture preparation, and runnable review demonstration.              |
| `tools/`, SDK verification harnesses | Frontend build, exact self-doc gates, CLI installation and standalone consumers.                      |

Add npm `bin.lgtmd` pointing to the thin executable JS launcher with its shebang. Package
the native executable with embedded viewer and worker assets, with no install-time compilation/download. Build
Vite/React only during source/package preparation. Keep Playwright optional for
plain Node/Rust guide flows and retained-site preview.

Update the release archive inventory checks narrowly: they currently allow only
SDK JS/declarations and native binaries. Explicitly validate CLI metadata,
executable permissions and exact native inventory. Validate the embedded viewer
manifest and referenced assets at build/test time; reject retired TS host modules
and loose frontend directories from the npm archive. Update fixed standalone-copy inventories
and npm workspace/lockfile inputs to include maintained new sources. Exercise
the packed archive, not only workspace imports. Preserve current platforms and
release approval gates; no registry publication, tag, or version choice here.

## 10. Implementation sequence and completion gates

Implement vertical slices with working consumers; the next GO covers all of them:

1. **Bundle and collection.** Add typed safe site output, validation, handoff,
   and guarded Playwright collection. Match Rust/Node outputs; prove current
   Markdown/schema conformance unchanged. Finish safe rendering/link semantics
   before consuming historic data in a browser.
2. **CLI and reading.** Ship installed dev/build/preview, passive configuration,
   flow lifecycle, explicit reuse, watching and run status. Render a normal
   external consumer using bundled assets at root and `/docs/`.
3. **Git, snapshots and review.** Implement site store, exact check, exact-candidate
   update, Git object reading, page/resource comparisons, revision selection and
   View diff. Exercise all absent/incompatible states without mutations/replay.
4. **Image views.** Implement Before/After and worker-based Regions with budgets,
   format detection, cancellation and explicit fallbacks. Keep exact engine
   verdicts unchanged by every display mode.
5. **Own guides and demonstration.** Replace handwritten user narrative with
   SDK sources, build the controlled Git example, capture real review, and make
   own docs and demo start from documented commands in a prepared checkout.
6. **Verify the delivered package.** Run native verification, browser evidence,
   independent Rust/Node consumers and packed npm CLI gates. Review generated
   prose/screenshots in the browser. Resolve failures before reporting completion.

Required evidence:

| Area              | Acceptance                                                                                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Completion        | A write-then-fail runner, stale token, missing handoff, teardown/reporter failure or cancellation never replaces the last successful candidate.                                                                                                                                             |
| Watching          | Several rapid edits coalesce; a mid-run edit schedules one later run; output writes do not create loops; failures show stale state; shutdown cleans owned children.                                                                                                                         |
| Reuse and preview | A sentinel flow is never invoked by reuse, preview, page navigation, revision changes, or image mode changes.                                                                                                                                                                               |
| Core comparison   | Known added/removed/changed/unchanged pages/resources, image-only change, note-only Reader stability, profile mismatch, and mismatched audiences are classified correctly.                                                                                                                  |
| Git               | Worktree and index remain unchanged; exact ref resolution works; missing history/snapshot, unsafe paths, LFS pointers and invalid bundles fail honestly.                                                                                                                                    |
| Acceptance        | Exact candidate identity is accepted without running; tampering/unknown IDs fail before writes; retired owned paths are handled without deleting unrelated files; check catches changed/missing/extra artifacts.                                                                            |
| Privacy           | Both sides of every Reader comparison and all Reader site files exclude private notes/resources/metadata. Contributor access requires the chosen export.                                                                                                                                    |
| Rendering         | Common supported prose/resources/notes, keyboard controls, root and subpath navigation, downloads and encoded resource paths work in real browsers.                                                                                                                                         |
| Images            | Known pixel fixtures yield expected boxes; every changed pixel is covered; incompatible/animated/oversized/corrupt inputs fall back; byte changes never disappear into a visual verdict.                                                                                                    |
| Self-docs         | Ordinary dev/build/check leave tracked guide files unchanged; explicit recording uses the reviewed candidate; actual controls and comparison identities are asserted before capture; repeated fresh runs match exactly in the pinned environment; generated prose and images are inspected. |
| Packaging         | Packed CLI starts with Rust absent for Node/core consumers; browser assets load; Playwright stays optional; a separate Rust flow uses the same handoff with its own toolchain.                                                                                                              |
| Compatibility     | Existing Markdown baselines, SDK authoring, Playwright guard restrictions, release inventory checks and native/macOS/Linux verification continue passing.                                                                                                                                   |

Use existing `just verify` as the full gate, expanded to include site and CLI
checks, plus focused recipes for the new areas. Keep exact comparison and capture
profiles explicit; never use retries, visual tolerances or missing-browser skips
to make this feature pass. Test comparison semantics with independent fixtures;
a screenshot of the diff UI alone does not prove correctness.

Final delivery states how to start own docs and the demo, shows the captured
guide, reports checks and platform limits, and identifies any manual review
remaining. At the original v1 delivery, availability text distinguished the
implemented checkout/packed candidate from registry 0.1.0; implementing commands
did not imply a new release.
No implementation item above may silently become deferred styling.

## 11. Explicit follow-up scope

Marketing `www/`, Astro selection and live GitHub Pages deployment remain separate
website work. V1's built docs must already work on that class of static host.
Also deferred: SSR/SEO and clean page URLs, word/block semantic diffs, advanced
themes/search, custom render plugins, alternate Git artifact stores, Git LFS
retrieval, automatic PR approval/merge, hosted collaboration, browser-hosted SDK,
AI execution, extra native platforms, and the image modes listed above.

N3 stays unchanged. Its dependency upgrade remains a separate consumer task.
Preserve the pre-existing uncommitted release runbook/website backlog changes in
the lgtmd checkout. Implementation follows ordinary source review/commit
instructions; the GO is not permission for package publication or deployment.

Implementation references are limited to the actual platform capabilities:

[Canvas pixel access](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/getImageData),
[OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas),
and the already pinned [CommonMark parser](https://docs.rs/pulldown-cmark/0.13.0/pulldown_cmark/).
These do not change the product boundaries or require copying a predecessor's
technical architecture.

## 12. Initial implementation receipt

Implemented on 2026-10-14 on `feature/docs-site-v1`. All four required outcomes
are present, with the command, bundle, lifecycle, Git and client boundaries above.
The user guide now comes from `docs/authoring/`, and its tracked Reader captures
show the actual Before/After and Regions controls. `just docs-demo` starts the
controlled comparison without changing the source repository's history.

Verification passed on macOS arm64 / Node 24: full native `just verify --offline`,
independent Rust and web workspaces, packed npm CLI with Rust/Playwright absent,
optional Playwright installed consumer, and a packaged Rust flow using the same
CLI handoff. The web gate exercises both audiences at root and `/docs/`, and two
fresh own-doc runs match exactly. `just docs-check` also matches the tracked
Reader Markdown and captures byte for byte in their declared capture environment.

The portable repeatability check is deliberately separate from accepting tracked
media: each host compares completed runs in its own capture environment. The
checked-in own-guide captures use the declared macOS profile. A different host
must not silently replace those images or report a cross-platform exact match.
Linux CI was not run remotely for this local implementation turn.

No package version was changed, published, tagged or deployed. The existing
release-runbook changes remain preserved. N3 source and its pinned dependency
remain unchanged. Website hosting and the follow-up scope above remain deferred.

## 13. Unified CLI completion

The initial Node-owned orchestration is superseded by the explicit product
requirement for one native CLI. The earlier verification receipt covers that
initial implementation. The migration below is complete and independently verified.

1. Move configuration, candidate retention, flow lifecycle, Git reads, HTTP,
   cancellation and watch orchestration into `crates/lgtmd-cli`.
2. Carry the coarse SDK bridge and built frontend in the same executable;
   remove the former bridge-only crate and TS orchestration modules.
3. Keep command/config/handoff/site contracts and exact evidence unchanged.
   Watch may use bounded native polling; runs remain serialized and coalesced,
   editor atomic saves work, and output/cache paths remain excluded.
4. Verify native and npm invocation with the same blackbox scenarios, include
   signal forwarding and descendant teardown, and run the native executable
   with Node absent from PATH. Verify packed npm without a Rust toolchain.
5. Regenerate only the intentionally updated user guide, inspect it, and rerun
   full native and standalone gates before marking v1 complete. No release,
   version change, Git commit, or push is part of this work.

Completed on 2026-10-14. `crates/lgtmd-cli` now owns all five public commands and
carries the embedded frontend plus the coarse SDK bridge. The former bridge-only
crate and TypeScript orchestration modules are removed. npm forwards to that same
executable; the TS SDK retains JavaScript authoring and Playwright integration.
The Rust SDK remains library-only, independent of HTTP and frontend dependencies.

The final source passed `just verify --offline` and the fresh source-only
`just doc-web-smoke --offline` gate on macOS arm64 / Node 24. This includes
warnings-denied Clippy, 14 native CLI tests, 19 native/npm CLI scenarios, real
browser checks, packaged consumers, and exact own-guide comparison. The installed
native executable built a precompiled Rust flow and served its embedded frontend
with an empty PATH; packed npm ran with only Node available. Cancellation tests
cover signal exit status, owned descendants and stalled HTTP downloads. Standalone
build targets are isolated per disposable source tree to prevent stale binaries
from retaining deleted compile-time source paths.

Only the intentionally revised getting-started prose and its inventory changed;
the retained guide images remain byte-identical. Live native dev and npm-launched
review sessions were inspected with View diff and Regions. N3 remains clean and
unchanged. This closes the local v1 implementation gates; remote Linux CI and a
new package release have not been run. All work remains local and uncommitted.

## 14. Viewer styling and theme overrides

The approved presentation follow-up adopts Tailwind for the bundled frontend,
semantic `--lgtmd-*` tokens, Light/Dark/System appearance, and stable
`data-lgtmd-part` styling hooks. The default design uses restrained surfaces and
borders, compact navigation, a clear reading column, consistent code/media
presentation, and a compact development toolbar that expands for comparison.
Full component customization remains deferred.

Optional `theme: { css: "docs/theme.css" }` configuration accepts one ordinary
browser stylesheet, resolved relative to the config. Dev loads its current bytes
after default styles, with no-store caching, on browser reload. The configured
file is excluded from flow watching. Changing its configured path requires a
dev restart. Build copies CSS into the completed static output; preview serves
that copy even when the source file is absent. No consumer frontend build or
Tailwind setup is required.

Keep theme path and bytes out of candidate identity, retained-output config keys,
site snapshots, exact checks and Git evidence comparisons. Current styling
presents both compared versions. Dev/build reject unsafe, missing or unreadable
inputs. Check/update need no source CSS. Preserve output transaction safety and
validate path shape/overlap independently of file reading. Do not follow imports,
copy adjacent assets or rewrite URLs; relative URLs resolve from the served CSS.

Acceptance covers live CSS changes without flow execution, retained-candidate
reuse after changing the theme path, unchanged candidate IDs and exact checks,
frozen static CSS and preview after source removal, path errors, both appearance
modes, supported hooks, responsive reading and the real review interaction. The
user-facing customization guide is authored through the same own-doc flow.

Completed on 2026-10-14. Tailwind 4 is compiled into the embedded frontend;
consumer overrides remain ordinary CSS. The native host owns explicit theme
loading and static publication. The fourth executable own guide documents the
public tokens and styling hooks. Light/Dark/System appearance, mobile navigation,
keyboard focus, notes and real Git/image review were inspected in the browser.

Final `just verify --offline` and `just doc-web-smoke --offline` passed on macOS
arm64, including 22 CLI integration cases, four viewer browser configurations,
installed Cargo/npm consumers and exact repeated own-guide captures. The reviewed
reader candidate is
`3550188da3151e7b19e2e00d4d62a4fb6559bfad953a4b8d1b3b53c4b3339ce7`.
Native binary staging now replaces the executable atomically, preserving running
processes and avoiding macOS signature-cache failures. A test-only PID handshake
was made atomic after a parallel-build run exposed its incomplete-file race.
N3 is unchanged. This follow-up remains local and uncommitted; remote Linux CI
and package publication are separate work.

## 15. WebP retention before the v1 commit

Own-guide and review-example captures now retain lossless WebP. PNG was the
Playwright capture default, not a comparison requirement. A development-only
Sharp helper converts the in-memory PNG and records its pinned encoder identity;
the SDK and engine remain format-agnostic. The helper regression checks exact
rendered RGBA preservation and repeated encoded bytes. The executable
review guide exercises WebP in Before/After and Regions, still reporting the
example's 3,954 changed pixels.

The reviewed WebP reader candidate is
`2b4988966213377489713cfb57d974477f556fb3fee837b8f816b123455e0fb7`.
Normal record/update regenerated both the guide and its snapshot, retiring the
PNG files and their references. The four retained image files total 66,324 bytes,
down from 135,538 bytes (51.1% smaller). This changes stored evidence bytes and
profiles intentionally; it does not weaken exact checks or alter comparison
policy for older captures.

The pinned Playwright browser also supports direct lossless WebP at quality 100,
but its measured output for these two captures totaled 78,002 bytes per copy,
versus 67,769 bytes for the original PNGs and 33,162 bytes with the pinned
lossless encoder. Retain the development-only encoder for the measured storage
saving. A real-browser regression verifies every decoded RGBA byte against PNG
and repeatable encoded WebP; no encoder dependency ships with the npm SDK.
