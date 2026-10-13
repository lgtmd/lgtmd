# Executable document architecture

lgtmd combines native-language document authoring with one Rust compiler and
artifact lifecycle. Application actions and assertions run in the project's
runtime. The compiler receives completed prose, observations, checks, bindings,
and frozen resources, then produces audience-specific Markdown/resource bundles.

```text
Rust authoring ----------------------> completed Document
                                              |
Node authoring -> schema-v1 frozen input ------+-> Rust validation and export
                                                    |
                                      Reader / Contributor bundles
                                                    |
                                      build / check / explicit update
```

The [Rust SDK](../../crates/lgtmd/README.md) and
[Node SDK](../../packages/lgtmd/README.md) are the API references. The current
exporter produces Markdown; the included static preview is a review utility.
A built-in docs site with contributor notes and text/screenshot change review is
[planned](../../TODO.md#2-built-in-docs-site-and-change-review), not yet
implemented. An alternate public exporter interface also remains future work.
Artifact inventory manifests are not a complete viewer protocol.

## Authoring and evidence

Authors compose prose, sections, resources, and contributor notes in ordinary
Rust or TypeScript. Typed handles identify values, resources, bindings, and note
targets without a parallel template. Functions provide reuse. Explanation-only
pages and observation-only pages are valid.

Observations freeze serialized values without implying a check. Named checks
retain explicit success and optional observed/expected values. Ordinary native
assertions remain the host's outcome; the SDK does not manufacture named checks
for assertions outside its authoring API. Caught SDK check failures still prevent
successful completion.

Resource registration copies the supplied bytes or JSON value. Subsequent caller
mutation cannot alter registered evidence. Rendering another audience reuses the
same completed document and resources without replaying the application.

Meaningful assertions, controls, producers, fixtures, review, and documentation
organization remain project-owned. An image MIME declaration does not validate
pixels, and artifact existence does not establish application correctness.

## Rust responsibilities

The core remains one crate with focused modules:

| Module                        | Responsibility                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `model`, `authoring`, `prose` | Frozen content, typed ownership, builder operations, observations/checks, and composition. |
| `artifact`                    | Resource snapshots, explicit file acquisition, and shared UTF-8/JSON encoders.             |
| `markdown`, `validation`      | Authored Markdown, reference integrity, resource use, and intrinsic audience visibility.   |
| `paths`, `layout`             | Safe bundle paths, configurable page/resource placement, and collision checks.             |
| `render`, `manifest`          | Audience projection, Markdown/resource exports, and typed inventory receipts.              |
| `lifecycle`, `store`          | Owned-tree comparison, staged publication, rollback/recovery, and receipt compatibility.   |
| `runner`                      | Project-owned generation and configured build/check/update orchestration.                  |
| `transport`                   | Schema-v1 frozen input, native round trips, and coarse shared compilation.                 |

Finishing validates the document's intrinsic contract. Export additionally
validates configured paths, complete references, resource use, and audience
visibility before returning publishable bytes. Native document fragments remain
available for consumers such as N3 that retain their established page format and
own whole-guide validation.

## Node responsibilities and the native bridge

`packages/lgtmd` provides Node 24 ESM authoring, immutable runtime handles,
project-owned async lifecycle integration, and optional Playwright support.
`crates/lgtmd-node` accepts one serialized request per compile/publication through
a native executable bundled with a prepared npm tarball.

Schema-v1 input contains ordered authored content and resource snapshots. It
contains no callbacks, browser objects, or process-local handle owners. The
compiler validates unknown fields, schema versions, references, checks, and
resource representation. Rust round trips preserve native exports, including
literal Markdown versus typed Markdown parts. Node and Rust share canonical
JSON resource encoding.

Node rejects unsupported JSON values rather than losing them in serialization.
Its strict domain includes safe integers and valid Unicode; it excludes
undefined, non-finite values, negative zero, cycles, accessors, symbols, and
non-plain objects. Native Rust serialization retains its own serde behavior
before values enter the portable contract; the Node facade does not replace it.

The selected native route preserves the existing Rust filesystem store. See the
[bridge decision](../decisions/0001-native-node-bridge.md). Installing a prepared
npm package requires no Rust toolchain, install-time compilation, or fallback
download. The published 0.1.0 npm package includes both verified native targets;
additional platforms and signing remain future work.

## Project lifecycle and application state

The SDK receives context and paths explicitly. It has no Cargo/Git discovery,
required fixture directory, frontend/backend topology, service count, database,
or deployment assumption.

Node `guide` declares authoring without executing it. `runGuide` can call a
project's `prepare` callback, receive context and cleanup, execute authoring, and
return completed input after cleanup succeeds. Primary and cleanup failures are
both preserved. Partial preparation failure belongs to the project because no
completed acquisition has been handed over. `runGuideWithContext` accepts an
existing runner's context while leaving cleanup with that runner.

The Rust runner likewise accepts project-owned generation. Consumers can use
existing mocks, seeds, API clients, rendering, or supplied state. Stateful service
and database design remain application responsibilities.

The [React/Vite example](../../examples/lgtmd-web/README.md) owns its HTTP API and
isolated workspaces. Its browser bundle imports no SDK code. Capture uses the
production application build on isolated test ports; the ordinary developer app
can remain open.

## Playwright completion

`withDocs(existingTest)` extends normal project fixtures with document authoring.
It records candidate attachments during fixture teardown; that step does not
publish. The parent `runPlaywright` operation waits for successful process exit
and a unique completed receipt from the sole guarded `docsReporter` before
publishing the complete documents.

The guard includes tests, worker/global teardown, and reporter completion. Timeout,
interruption, missing receipts, duplicate document IDs, swallowed named-check
failure, and guarded reporter failures prevent acceptance. Direct Playwright CLI
runs may collect diagnostic attachments but cannot publish documents.

Initial support requires one project, retries zero, repeatEach one, no shards or
dependency/teardown projects, and clean passed outcomes for all discovered tests.
Imported custom reporter instances are guarded; built-in reporter-name delegation
and unguarded extra reporters are unsupported. The adapter preserves ordinary
Playwright selectors/assertions and their normal limitations.

## Audience projection and publication

Reader exports omit contributor notes, exclusively private observations/resources,
and their private metadata before delivery. Contributor exports retain them.
Check IDs and status are public metadata; values become public only when publicly
referenced. Notes use separate counters so adding one does not renumber Reader
blocks. This is export filtering, not a viewer toggle used as access control.

`ExportLayout` configures page/resource prefixes and per-document page paths.
Links resolve relative to actual page locations. `RunnerConfig` configures caller
path bases, retained audience destinations, and candidate audience directories.
Destinations may be outside the source project.

The artifact store distinguishes:

- `build`: fresh output for review; existing destinations fail.
- `check`: exact read-only comparison; differences fail.
- `update`: explicit acceptance into a compatible owned baseline.

Ownership receipts and producer/profile checks protect retained output. Missing,
extra, orphaned, duplicate, or changed artifacts fail. Paths must remain separate,
including adjacent lock/staging/backup transaction paths. Symlink destinations
are rejected; configured placement does not relax integrity.

Ordinary publication failures preserve or restore the previous tree. Interrupted
transactions retain recovery material and fail visibly. Audience destinations
publish independently. This is rollback protection, not a crash-atomic operation
across both audiences.

## Verification and support boundaries

The Rust gate covers SDK/consumer tests, retained outputs, formatting,
warnings-denied Clippy, doctests, API documentation, and tooling regressions. Its
standalone mode resolves only portable dependencies in a disposable workspace.

The web gate adds Node authoring/failure tests, shared conformance, real Chromium
replay, exact repeated exports, an actual Cargo archive consumer, and npm tarball
installation/execution with Rust absent from PATH. The core is tested before
installing the optional Playwright peer.

A fresh candidate and successful repeated-run check establish repeatability for
that environment. They do not establish an accepted visual baseline or
cross-platform pixel identity. Projects deliberately select and accept their own
baselines. Prose, visual legibility, meaningful coverage, and physical interaction
still need review.

Rust 1.95 is the declared minimum. CI has verified Node 24 ESM on macOS 15 arm64
and Ubuntu 24.04 x64. Version 0.1.0 is available from npm and crates.io; APIs and
schema-v1 compiler input remain experimental, without a stable API guarantee.
N3's separate native replay remains its consumer acceptance gate.

The [development guide](../development.md) lists commands. Historical N3
[framework](https://github.com/gridaco/n3/blob/a4cf59b8955b00eadfb61d19fecff4a99559f288/rfcs/0003-executable-documentation-framework.md)
and
[incubation](https://github.com/gridaco/n3/blob/a4cf59b8955b00eadfb61d19fecff4a99559f288/rfcs/0004-lgtmd-web-incubation.md)
records retain the original application-specific rationale.
