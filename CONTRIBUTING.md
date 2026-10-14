# Contributing to lgtmd

Start with a complete example and the contract your change affects. The
[Rust consumers](crates/doc-example-config/README.md) and
[React + Vite application](examples/lgtmd-web/README.md) exercise the SDK without
an N3 checkout or renderer.

## Set up and verify

Use Rust 1.95.0 with rustfmt and Clippy, Python 3.11+, Node.js 24 with npm, and just.
Toolchain and dependency versions are pinned in the repository.

```sh
just setup
just verify
```

Setup installs dependencies, prepares the shared native CLI and embedded frontend, and
installs Chromium. Verification covers formatting, Rust and Node tests, browser
replay, exact repeated exports, and installed Cargo/npm consumers. See the
[development guide](docs/development.md) for focused checks, offline work, example
review, and failure diagnostics.

For prose-only changes, check formatting, links, and factual claims. Rebuilding
the SDK or replaying unchanged examples is unnecessary. When a change affects
generated documentation, inspect the prose and resources before accepting a new
baseline.

## Find the owning code

| Location                     | Responsibility                                             |
| ---------------------------- | ---------------------------------------------------------- |
| `crates/lgtmd/`              | Rust SDK, compiler, exports, and artifact lifecycle        |
| `crates/lgtmd-cli/`          | Shared native CLI and coarse SDK bridge                    |
| `crates/doc-example-config/` | Rust CLI/library consumers and retained baselines          |
| `packages/lgtmd/`            | Node SDK and optional Playwright integration               |
| `examples/lgtmd-web/`        | React/Vite app, HTTP API, fixtures, and guides             |
| `examples/stay/`             | Guest/host app, mock AI, fixtures, and executable guides   |
| `packages/viewer/`           | Bundled reading/review frontend and image worker           |
| `examples/review/`           | Git-free viewer showcase and controlled Git/browser review |
| `docs/authoring/`            | Sole sources of generated user guides                      |
| `docs/architecture/`         | Maintained contracts and boundaries                        |
| `docs/decisions/`            | Decisions and alternatives                                 |

Rust owns shared document validation, exports, and the artifact store. Authoring,
application callbacks, preparation, and cleanup stay in the host runtime. The
Node package uses a native binary; it does not ship a browser-hosted or WASM SDK.
Read the [architecture](docs/architecture/executable-documents.md),
[native bridge decision](docs/decisions/0001-native-node-bridge.md), and
[AGENTS.md](AGENTS.md) before changing those boundaries.

The README introduces the product to prospective users. Keep it focused on the
problem, a real authoring example, adoption, and current availability. Put API
contracts in the package READMEs, engineering rationale in architecture and
decision documents, and development instructions here or in the development guide.
Keep the existing cover artwork and the N3 usage link.

## Distribution and release

CI verifies Node 24 ESM on macOS 15 arm64 and Ubuntu 24.04 x64. Release packaging
combines both native binaries into one npm tarball that runs without a Rust
compiler, install-time build, or fallback download. Broader platform support and
signing remain release work. Version 0.3.0 is published on npm under `latest` and
on crates.io. APIs and schema-v1 compiler input remain experimental.

Read the [release runbook](RELEASING.md) for packaging, trusted publishers,
and human approval gates. A successful verification run does not authorize
publication. Packages, tags, and publishing workflows require explicit approval
for the exact version.

## History and provenance

lgtmd's SDK and development harness were extracted from
[N3](https://github.com/gridaco/n3), its first product integration. N3 owns its
application adapter, input replay, rendering, capture, and guide policy. During
release preparation it consumes an exact Git revision; crates.io integration is
separate release work. The examples here run independently and demonstrate our
own integrations.

The [MIT license](LICENSE) retains the original
`Copyright (c) 2026 Grida` notice. The
[N3 framework record](https://github.com/gridaco/n3/blob/a4cf59b8955b00eadfb61d19fecff4a99559f288/rfcs/0003-executable-documentation-framework.md)
and
[web incubation record](https://github.com/gridaco/n3/blob/a4cf59b8955b00eadfb61d19fecff4a99559f288/rfcs/0004-lgtmd-web-incubation.md)
preserve the historical design and validation context. Deferred features and
adoption work live in [TODO.md](TODO.md).
