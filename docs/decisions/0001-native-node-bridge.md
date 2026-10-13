# Decision 0001: Use a coarse native compiler/store bridge for Node

Status: **Accepted and implemented; initial distribution released in 0.1.0**

Date: 2026-10-13

## Context

Rust and Node authoring share document semantics, audience filtering, canonical
resource encoding, and exact artifact publication. Node keeps idiomatic functions,
promises, application fixtures, and cleanup. Completed content crosses the
boundary in one operation, rather than requiring a foreign call for each paragraph.

The initial question was whether WebAssembly would deliver the complete shared
contract more simply. A probe compiled the same frozen prose, notes, JSON, and
image input through WASM and produced equal exports. The existing filesystem
store returned an unsupported-platform error there.

That probe establishes compiler portability for the exercised input. It does
not establish browser-hosted SDK support, general WASM publication, performance,
or a complete alternative distribution.

## Decision

Use `crates/lgtmd-node` as a thin native executable. The Node facade sends one
schema-v1 request per compilation or publication. Rust validates content and
calls the same exporter, runner, and strict owned artifact store used by native
Rust consumers.

Bundle the matching platform executable into a prepared npm tarball. Package
installation performs no Rust build and no fallback download. Source contributors
build the binding explicitly before packing; clean installed-consumer checks run
with Rust absent from PATH.

Keep authoring and host lifecycle in Node. The compiler receives completed
content/resources and never schedules application callbacks or owns project state.

## Rationale and tradeoffs

This route reuses the existing output ownership, path separation, exact checks,
staging, compatibility, and recovery rules. A second Node filesystem store would
create another implementation of the most failure-sensitive contract.

The cost is platform binaries, explicit unsupported-platform errors, packaging,
and ongoing distribution work. Signing remains future work. macOS arm64 is the
executed local scope. CI has also verified macOS 15 arm64 and Ubuntu 24.04 x64;
the published 0.1.0 npm archive combines both native targets. This is not
a claim that native execution is universally faster or simpler than WASM.

WASM remains an option for pure processing when a browser-hosted consumer or a
specific deployment need justifies it. A Node-API binding is another possible
transport. Neither requires duplicating compiler semantics; neither is needed to
preserve today's authoring and artifact contracts.

## Validation and history

The portable gate checks native Rust/Node export conformance, real browser
authoring, exact repeated output, Cargo packaging, and installed npm core and
Playwright execution with Rust absent from PATH. Runtime/platform scope and
release limits are stated in the [Node README](../../packages/lgtmd/README.md).

The original
[N3 incubation record](https://github.com/gridaco/n3/blob/a4cf59b8955b00eadfb61d19fecff4a99559f288/rfcs/0004-lgtmd-web-incubation.md)
retains the decision context and preceding design.
