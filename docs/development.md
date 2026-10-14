# Develop lgtmd

Use an independent checkout of this repository. Rust SDK consumers and the
React/Vite example do not require N3, its renderer, Docker, or a provider account.

## Prerequisites and setup

Install Python 3.11 or newer, Node.js 24 with npm, Rust through rustup, and just. The repository
pins Rust 1.95.0 with rustfmt/Clippy and uses exact npm dependency versions.

```sh
just setup
```

Setup prepares the formatter, npm dependencies, native CLI, TypeScript
SDK, and Chromium explicitly. It does not accept any documentation baseline or
publish packages. Source development needs Rust; installing a prepared npm tarball
does not.

The package READMEs document direct commands for
[Rust](../crates/lgtmd/README.md#develop-and-verify-the-portable-packages) and
[Node](../packages/lgtmd/README.md#development-and-support).

## Verify changes

```sh
just verify
```

This includes formatting and both SDK verification gates. The Rust gate checks
SDK/consumer tests, exact retained Rust guide output, doctests, warnings-denied
Clippy/API documentation, and harness regressions. The web gate checks the bridge,
Node authoring, real Chromium replay, exact repeated exports, and clean installed
Cargo/npm consumers.

For focused checks:

```sh
just doc-framework-test
just doc-web-test --offline
```

The Rust-only gate requires Python/Rust without Node or a graphics adapter.
The web gate needs the explicitly prepared Chromium installation and real local
process/socket access. It does not silently download a browser or skip unavailable
execution.

Verify source independence and the Rust minimum in disposable workspaces:

```sh
just doc-framework-smoke --offline
just doc-web-smoke --offline
```

Standalone gates copy maintained sources rather than build output or installed
binaries, resolve their own minimal Cargo lockfiles, and exercise Rust 1.95.0.
`--offline` requires warm Cargo/npm caches. Omit it to allow dependency resolution;
browser setup remains explicit. Gates honor explicit Cargo/npm cache and target
overrides. Relative overrides retain their meaning from the invocation directory.
Each standalone run uses a temporary target beneath the configured target root,
then removes it. This prevents reuse of binaries containing source paths from a
deleted temporary workspace; ordinary native verification keeps its target.

```sh
just fmt
just fmt-check
```

Generated example baselines, receipts, and resources are excluded from prose
formatting. Change authored sources, regenerate deliberately, and review output
before accepting an intentional baseline change.

## Run and review examples

The [Rust consumers](../crates/doc-example-config/README.md) explain the CLI and
library examples, build/check/update commands, retained baselines, and static
preview. The [React/Vite walkthrough](../examples/lgtmd-web/README.md) explains
normal client/API development and documenting the filtering feature.

Build fresh candidates for review. Read both audience exports and inspect their
resources before `update`. `check` compares exactly and never accepts drift.
The web verifier builds a temporary candidate and requires three fresh browser
runs to match it exactly. Every comparison must pass; failures are never retried.
This checks repeatability without creating a retained visual baseline.
Projects choose their own baseline location and acceptance policy.

If browser verification fails, the verifier preserves the candidate baseline and
the failing run's original screenshot and trace under
`.cache/lgtmd-web/diagnostics/`. These survive standalone workspace cleanup. CI
uploads this evidence on failure with seven-day retention; the diagnostic
capture is not a new browser run or an accepted baseline.

## Distribution and integration

The SDK manifests identify their public registries; the CLI crate and example
packages remain private. Version 0.2.0 is published on npm under `next` and on crates.io.
CI verifies macOS 15 arm64 and Ubuntu 24.04 x64 with Node 24 ESM; ordinary
verification does not publish packages. APIs and schema-v1 compiler input remain
experimental. CommonJS and browser-hosted SDK packages have no support promise.

The npm gate packs the built SDK and native executable, installs the tarball in a
clean project with no Rust toolchain on PATH, tests the core without Playwright,
then installs the optional peer and executes its integration. The Cargo gate
builds the normalized package archive and a consumer using its extracted source.
These establish package-content checks, not registry installation.

N3 consumes an exact Git revision during release preparation. Its native replay
and exact guide verification remain N3 responsibilities. Signing, broader
platform support, and replacing N3's interim dependency with crates.io remain
separate work. Future package publications require explicit authorization for
the exact version.

Release preparation and publication use the manual, approval-gated
[release workflow](../RELEASING.md). `just release-test` checks artifact and approval
guards without authenticating to registries; these tests also run in `just verify`
and normal CI. Release tooling needs Python 3.11+; CI uses Python 3.13.

## Develop the docs site and its own guides

After `just setup`, use:

```sh
just docs-prepare
just docs
just docs-demo
```

`just docs` runs the real own-guide flow and serves completed docs on port 4177.
`just docs-demo` opens the canonical [viewer showcase](../examples/review/showcase/README.md)
from retained Original/Revised bundles, without Git or fresh captures. It includes
full-width screenshots and text, image, note and fallback examples.
`just docs-git-demo` separately creates disposable, labeled A/B Git history to
exercise actual Git review without changing this repository’s history. All print
their local URL. Ctrl-C stops their owned processes.

Own-guide and review-example screenshots use lossless WebP to reduce retained
media size. `examples/review/capture.mjs` converts Playwright's in-memory PNG
buffer through the pinned development-only Sharp encoder. The capture profile
includes Sharp and libwebp versions; encoding changes require fresh review and
explicit baseline acceptance. A real-browser regression verifies decoded pixel equality against PNG,
and the real review scenario exercises WebP in slider and side-by-side views with annotations. The SDK
continues to accept other image formats and never silently transcodes evidence.

User-facing sources live in `docs/authoring/`; a bounded browser scenario captures
the actual review UI. The final guide never feeds back into its A/B fixture.
`just docs-build` makes a static candidate; `just docs-preview` serves it without
running authoring. Normal commands leave tracked guide files untouched.

After inspecting a candidate, `just docs-record CANDIDATE_ID` records its exact
Reader Markdown/media, and `node packages/lgtmd/dist/src/cli.js update --candidate
CANDIDATE_ID` records its Reader site snapshot. Neither reruns authoring or commits.
`just docs-check` checks the tracked Markdown/media byte for byte using its recorded
capture profile. The checked-in guide was recorded on macOS arm64 with the pinned
Chromium and CPU raster arguments; changing platform/fonts is a different capture
environment and must not silently replace or bypass that baseline.

The portable web gate runs the viewer's real browser tests at `/` and `/docs/`,
then requires two complete own-guide runs to match exactly on that host. This is
a repeatability gate, not acceptance of tracked captures. Native `just verify`
also runs the exact tracked-guide check. CI's standalone lanes retain their
independent platform capture checks. Failed evidence must be investigated before
any explicit recording.

The packed npm consumer executes `lgtmd build`, `preview` and `dev --reuse` with
Rust and Playwright absent, loads bundled assets, and checks that reuse/preview
never execute authoring. The optional browser peer is exercised separately.

## Native CLI ownership

`crates/lgtmd-cli` builds the one `lgtmd` executable. It embeds the prepared React
frontend and owns command/configuration, flow execution, retained candidates,
Git reads, watching and serving. The npm entry only selects the bundled platform
executable and forwards arguments, streams, signals and exit status. The SDK's
coarse JSON bridge is an internal mode of that same executable.

`just docs-prepare` builds the frontend, stages it under the CLI crate, builds the
native executable and prepares npm's local binary. Source preparation needs Node;
`cargo install --path crates/lgtmd-cli --locked` then installs the native command
without a frontend build at installation. The CLI crate is private until a
separately authorized publication. The Rust SDK stays library-only and does not
pull in the HTTP host or frontend build.

The clean native consumer gate installs that CLI into an isolated prefix and
runs an already-built Rust flow plus static serving with an empty PATH. The npm
gate separately installs with only Node available. CLI blackbox cases exercise
both entry points, including exit codes and signal forwarding. Watch polls every
500 ms, reuses file metadata/content identities, and debounces changes; it does
not rebuild the React frontend or reload project configuration.

## Viewer styles and consumer themes

The React viewer uses Tailwind at build time. Its semantic `--lgtmd-*` tokens and
`data-lgtmd-part` styling hooks are the consumer customization boundary; utility
classes and exact element nesting are internal. Maintain Light, Dark and System
appearance together. Consumers supply ordinary browser CSS through optional
`theme: { css: "docs/theme.css" }` configuration, with no Tailwind or Node
requirement for a prepared native CLI.

The native host loads overrides after default styles. Dev rereads the file with
no-store responses on browser reload and excludes it from flow watches. Build
freezes those bytes into its output; preview does not consult the source. A
config change still requires restarting dev. Theme path/content are presentation,
not authored evidence: they are excluded from retained configuration identity,
site snapshots and exact `check`/`update` comparisons. Both Git versions use the
active theme.

Theme input validation belongs in the host. Keep path separation and symlink
checks; do not follow CSS `@import` or copy `url()` dependencies. The browser
resolves CSS URLs from the published stylesheet. See the
[authored customization guide](authoring/customize-the-site.mjs) for the supported
tokens and hooks. Full component customization is deferred.

### Local version history

The source development viewer's **Versions** sheet browses repository commits
across local Git refs, with commit subjects, dates, and optional branch/tag labels.
The sheet opens on the right, or from the bottom on narrow screens, without
reflowing the document. **Run again** lives in the bottom toolbar; the lgtmd
status menu retains run diagnostics. Git references and candidate IDs are under
**Advanced**.

History includes commits that did not change documentation and commits with no saved
documentation. **Older commits** and **Newer commits** page through 20 commits at
a time. Traversal pins the local ref tips until **Refresh project history**, so
new commits cannot shift page boundaries mid-session. Refreshing or paging does
not change the selected baseline or run application code.

Selection reads and validates the complete audience bundle and resources stored
at that exact commit, including snapshots unchanged from a parent. Missing or
invalid snapshots remain unavailable; the viewer never substitutes another
revision or executes old source. No Git fetch, checkout, index write, or baseline
acceptance occurs. This picker is not included in the published 0.2.0 viewer.

Commit metadata is dev-host state. Static exports and canonical evidence hashes
exclude it. Change summaries count added, removed and modified pages/assets;
they are not line-level text diffs. Candidate IDs identify completed generated
output for explicit recording and cannot be used as Git revisions. Keep accepted
snapshots outside ignored cache directories when historical docs review is wanted.
