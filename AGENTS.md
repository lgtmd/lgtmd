# Working on lgtmd

These instructions apply throughout this repository. lgtmd is a code-authored
documentation SDK and shared Rust compiler. Keep the implemented scope small,
judge interface choices through complete examples, and distinguish current
capabilities from proposals and release promises.

## Current state and ownership

The SDK, examples, baselines, preview, and independent development harness were
extracted from N3. N3 remains a consumer and retains its application adapter,
replay, renderer, generated guides, capture policies, and agent skills.

| Location                     | Responsibility                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `crates/lgtmd/`              | Rust authoring, frozen document model, validation, Markdown exports, and artifact lifecycle.                 |
| `crates/lgtmd-cli/`          | Shared native CLI, embedded frontend, and coarse SDK bridge.                                                 |
| `crates/doc-example-config/` | CLI/library consumers, isolated fixtures, and retained Reader/Contributor baselines.                         |
| `packages/lgtmd/`            | Node authoring, project-owned lifecycle integration, native bridge loading, and optional Playwright adapter. |
| `examples/lgtmd-web/`        | React/Vite application, HTTP API, fixtures, guides, and browser configuration.                               |
| `docs/architecture/`         | Implemented contracts and engineering rationale.                                                             |
| `docs/decisions/`            | Decisions and alternatives with explicit status.                                                             |
| `tools/`                     | Repository formatting and contributor automation.                                                            |

Read the [architecture](docs/architecture/executable-documents.md), the owning
package README, and the relevant example before changing a boundary. The Node
integration uses a native binary, not a shipped WASM package. The docs-site CLI and bundled React frontend are implemented in this checkout.
Browser-hosted authoring and a generic plugin framework remain future work. The [docs-site decision](docs/decisions/0002-docs-site-and-git-review.md)
and [user guide](docs/guide/develop-and-record.md) describe the feature; the
[v1 execution plan](docs/plans/docs-site-v1.md) fixes its first implementation
scope and completion gates.
The docs site is one experience in development and after publishing; viewer is
an internal frontend responsibility, not a separate public product.
Create components only when they have real responsibilities.

## Authoring and project boundaries

- Keep prose, resources, observations, meaningful checks, and contributor notes
  together. Avoid parallel templates and generated prose copies maintained by hand.
- Favor ordinary functions and typed handles. Evaluate authoring cost including
  fixtures, helpers, configuration, and long documents. Do not hide redundant
  setup in undeclared helpers to make an example appear concise.
- Keep application state and infrastructure project-owned. Preparation may use
  mock providers, seeds, APIs, existing fixtures, or supplied context. Do not
  require a database, browser, repository layout, or frontend/backend topology.
- Preserve host failures and cleanup outcomes. Compilation success cannot stand
  in for a completed successful application run. Failed checks must not become
  successful evidence because the author catches an exception.
- Distinguish observations, checks, captures, and prose. An observation records a
  value; a check verifies its explicit expectation. A screenshot or label does
  not prove the application's behavior or verify every sentence.
- Keep ordinary authoring, compilation, and review free of model calls and paid
  services. Optional assistance is separate functionality and must never be a
  silent fallback for failed deterministic execution.

## Compiler and host contracts

Rust owns document semantics, reference and audience validation, canonical
encoders, exports, and the strict artifact lifecycle. Host-language actions,
callbacks, promises, browser operations, state preparation, and cleanup execute
in their own runtime.

Node sends complete schema-v1 frozen input through `lgtmd::transport`, once per
compile/publication operation. Keep binding code thin and avoid a foreign call
per paragraph. The compiler accepts completed content and resources; it does not
execute application callbacks or discover a consumer's repository.

Freeze observed values and resource bytes at registration. Subsequent caller
mutation must not change evidence. Exporting a second audience must not rerun the
application or capture again. Preserve typed-handle ownership, collision checks,
reference integrity, and useful diagnostics.

The Markdown manifest records an inventory and ownership receipt. The versioned
site bundle is a separate content, audience, navigation and resource protocol. Public input and exports remain
experimental; meaningful compatibility changes need explicit tests and review.
Preserve APIs and output bytes during extraction and packaging changes unless a
separate behavior change is authorized.

## Audiences and publication

- Remove contributor-only prose, observations, resources, and private metadata
  from Reader output before delivery. Viewer controls and CSS are not access
  control. Adding notes must not renumber Reader blocks or change their output.
- Keep fresh candidates, exact comparison, and explicit baseline acceptance
  distinct. Missing, extra, orphaned, duplicate, or changed artifacts must fail.
  Investigate drift before accepting new output; never add silent acceptance,
  visual tolerance, or unavailable-environment skips.
- Preserve ownership receipts, output-path separation, and adjacent lock,
  staging, and backup paths. Publication and recovery must preserve unrelated
  files and fail visibly for incompatible or interrupted state.
- State the real transaction boundary. Audience destinations publish
  independently; ordinary rollback protection is not a crash-atomic transaction.
- The Playwright adapter requires successful process completion and its unique
  guarded receipt, including teardown/reporters. Unsupported retries, shards,
  projects, or unguarded reporters must fail explicitly rather than weaken
  acceptance. Native application assertions remain native assertions.

## Development and verification

Start with [CONTRIBUTING.md](CONTRIBUTING.md), the root `justfile`, and the
[development guide](docs/development.md). Source
contributors need Rust 1.95.0 with rustfmt/Clippy, Python 3.11+, Node.js 24/npm, and
just. Setup is explicit:

```sh
just setup
just verify
```

For focused work:

```sh
just doc-framework-test
just doc-framework-smoke --offline
just doc-web-test --offline
just doc-web-smoke --offline
```

Run the relevant formatting, warnings-denied lint, SDK/consumer tests, doctests,
and documentation checks. Node or bridge changes also require the real browser
and clean Cargo/npm consumer gate. Standalone checks must pass without N3's
workspace, dependency patches, toolchain, assets, renderer, or application state.
Honor explicit Cargo/npm cache and target overrides.

Add regressions for actual changed semantics or failure cases. Inspect generated
prose and resources when they change. Assertions and byte comparisons do not
establish readable explanations, visual legibility, useful pacing, or physical
interaction. Report completed checks and their limits precisely.

A prepared npm package must install without a Rust compiler. Contributors build
its platform binary from the same source revision before packing. The executed
local target is macOS arm64 with Node 24 ESM; CI has verified macOS 15 arm64 and
Ubuntu 24.04 x64. CommonJS, other platforms,
and browser-hosted authoring have no support promise.

Release packaging uses one npm archive containing both verified native targets.
Read [RELEASING.md](RELEASING.md) before preparing or publishing a release or
changing publication. Keep verification free of registry credentials and require
the protected environment and current run approval before OIDC authentication. A verification run never grants release
authorization.

## Repository and release conventions

- Keep code, identifiers, comments, tests, logs, and authored UI strings in English.
- Keep the README focused on the user's documentation problem, a real authoring
  example, adoption, and current availability. Lead with the useful result; use
  direct statements and avoid question-style headings or unverified guarantees.
  Preserve the cover artwork and N3 usage link. Put contributor setup in
  CONTRIBUTING.md and the development guide, and implementation contracts and
  decisions in their owning docs.
- Keep the requested follow-up backlog in [TODO.md](TODO.md). Record
  proposal status explicitly; a TODO or decision document is not implementation
  approval.
- Ignore build output, dependencies, caches, native binaries, and disposable
  review captures. Keep intentional consumer baselines with their examples;
  never hand-edit them or pass them through prose formatting.
- Preserve original license notices and source provenance. Keep N3-specific
  history linked to the original repository rather than copying broken source
  references into standalone contracts.
- N3 consumes an exact Git revision during release preparation. Registry
  publication and the later crates.io integration are separate work.
- Respect current user scope. Local edits, commits, pushes, tags, releases, and
  package publication are distinct actions. Never publish a package, create a
  release tag, or dispatch publishing workflows without active explicit
  authorization for the exact release/version.

## Docs site and own guides

`packages/viewer/` owns presentation and browser-only image analysis;
`crates/lgtmd-cli/` owns host execution, Git reads, watching and serving;
`packages/lgtmd/src/cli.ts` only launches that native executable;
`crates/lgtmd/src/site/` and `review.rs` own bundles and exact comparison.
Do not make browser Regions boxes or decoding outcomes canonical check results.

Maintain user-facing narrative only in `docs/authoring/`. `docs/guide/` is generated
Reader Markdown/media; `docs/snapshots/reader/` is the explicitly recorded site
snapshot. Do not hand-edit either tree. Run `just docs-build`, review the result,
then use `just docs-record CANDIDATE_ID` and the explicit CLI snapshot update
when intentional changes are ready. Normal dev/build/check never overwrite the
tracked guide. `just docs-check` compares the tracked guide exactly in its declared
capture environment; `just docs-test` separately checks repeatability through
fresh controlled Git/browser runs and does not accept a baseline.

Retain own-guide and review-example screenshots as lossless WebP. Playwright's
PNG capture buffer is an intermediate; the repository capture helper encodes it
with pinned Sharp/libwebp and records that encoder in the profile. Keep the SDK
format-agnostic and pass the actual image MIME explicitly. Verify decoded pixel
preservation and fresh-run repeatability before recording changed evidence.

Use `just docs` for local development, `just docs-demo` for the canonical Git-free
viewer showcase, and `just docs-git-demo` for the disposable Git-backed example.
The showcase lives in `examples/review/showcase/`; edit its authoring and capture
sources, then explicitly regenerate its snapshots. Normal launch only validates
and serves retained bundles through the shared comparison engine and viewer. A missing snapshot at real HEAD remains unavailable until
recorded source is committed; never invent it or commit automatically. Keep
explanation capture one level deep: controlled A/B example -> real review UI ->
final guide, with no dependency back from that final guide into the example.

### Viewer presentation and themes

Use Tailwind for bundled viewer components, backed by the documented semantic
`--lgtmd-*` CSS tokens. Keep the public `data-lgtmd-part` hooks stable; utility
classes and DOM nesting are implementation details. Maintain Light, Dark and
System appearance, readable focus states and responsive layouts together.

`theme: { css: "docs/theme.css" }` is optional host configuration. Load ordinary
CSS after default styles, read it fresh on dev requests, and freeze its bytes in
static builds. Theme edits do not rerun flows, invalidate retained candidates or
alter exact evidence checks. Do not add theme bytes to the site bundle, candidate
identity or snapshot protocol. Preview uses the built CSS, not the source file.
Do not traverse CSS imports or infer adjacent assets. Full component replacement
and a component registry remain deferred. User-facing details belong in the
[authored customization guide](docs/authoring/customize-the-site.mjs).
