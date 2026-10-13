# Develop lgtmd

Use an independent checkout of this repository. Rust SDK consumers and the
React/Vite example do not require N3, its renderer, Docker, or a provider account.

## Prerequisites and setup

Install Python 3.11 or newer, Node.js 24 with npm, Rust through rustup, and just. The repository
pins Rust 1.95.0 with rustfmt/Clippy and uses exact npm dependency versions.

```sh
just setup
```

Setup prepares the formatter, npm dependencies, native Node bridge, TypeScript
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

The SDK manifests identify their public registries; bridge and example packages
remain private. No usable SDK version has been released. CI verifies macOS 15
arm64 and Ubuntu 24.04 x64 with Node 24 ESM, without publishing a release.
CommonJS and browser-hosted SDK packages have no support promise.

The npm gate packs the built SDK and native executable, installs the tarball in a
clean project with no Rust toolchain on PATH, tests the core without Playwright,
then installs the optional peer and executes its integration. The Cargo gate
builds the normalized package archive and a consumer using its extracted source.
These establish package-content checks, not registry installation.

N3 consumes an exact Git revision during release preparation. Its native replay
and exact guide verification remain N3 responsibilities. Public versions,
platform binary distribution/signing, actual registry consumption, and replacing
N3's interim dependency with crates.io require separate release work and explicit
publication authorization.

Release preparation and publication use the manual, approval-gated
[release workflow](releasing.md). `just release-test` checks artifact and approval
guards without authenticating to registries; these tests also run in `just verify`
and normal CI. Release tooling needs Python 3.11+; CI uses Python 3.13.
