![lgtmd — LGTM Docs](.github/assets/cover.webp)

# lgtmd

**LGTM Docs. Documentation authored alongside the code that demonstrates it.**

lgtmd is a documentation SDK and compiler for Rust and TypeScript. Write prose,
exercise your application, check important promises, and include the resulting
values, files, or screenshots in the same source. One completed run produces
Reader and Contributor documents without running the application again.

**Status:** the Rust SDK, Node SDK, optional Playwright adapter, examples, and
verification harness have moved here from N3. APIs and schema-v1 compiler input
remain experimental. Registry entries are name reservations; no usable SDK release
has been published. The [release workflow](docs/releasing.md) prepares packages for
review and requires human approval before OIDC publication.

## What you write

This example uses ordinary Node assertions and supplied data:

```ts
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { guide, runGuide, publish } from "lgtmd";

const example = guide({ id: "records", title: "Read an export" }, async (doc) => {
  const count = doc.observe("record-count", 3);
  await doc.check("three-records", () => assert.equal(count.value, 3));
  const data = doc.assets.json("records", { count: count.value });
  const passage = doc.md`
    The export contains ${count} records.

    ${data.code()}

    ${data.link("Download JSON")}
  `;
  doc.noteOn(passage)`This example uses supplied data.`;
});

await publish([await runGuide(example)], {
  command: "build",
  reader: resolve(".cache/records-review/reader"),
  contributor: resolve(".cache/records-review/contributor"),
});
```

The reader receives prose and JSON as code and a download. The contributor also
receives the attached note. Typed references connect content to frozen values and
resources; ordinary functions provide reuse. Explanation-only documents are valid.
Checks verify their stated expectations, while observations record values.

The [Node SDK](packages/lgtmd/README.md) describes authoring and lifecycle APIs.
The [Rust SDK](crates/lgtmd/README.md) provides native Rust authoring, the shared
compiler, and the artifact store.

## Use it with your application

Your project supplies application code, preparation, services, assertions, and
cleanup. You can reuse mock providers, database seeds, API calls, or existing test
fixtures. lgtmd accepts their context and results without requiring a particular
frontend, backend, repository layout, or test runner.

The optional `lgtmd/playwright` adapter extends an existing Playwright Test fixture.
Keep browser queries and assertions beside the guide prose, then register normal
screenshot bytes as document resources. A dedicated runner publishes only after
the test process, teardown, and guarded reporters succeed.

Start with the [React + Vite example](examples/lgtmd-web/README.md). It includes a
TypeScript client, a separate HTTP API, isolated project-owned workspaces, and
three documents: explanation, async resources, and a browser workflow. The
[Rust consumers](crates/doc-example-config/README.md) demonstrate a configuration
CLI and integration with the existing `serde_json` library.

For a new project, establish executable guides and project-owned fixtures from
the beginning. For an existing project, start with one useful workflow and reuse
its current tooling. Reliable authentication, selectors, state preparation, and
captures can require application work. Broader adoption guides and the complete
server/client walkthrough are tracked in [LTGMD-TODO.md](LTGMD-TODO.md).

## What you get

- Code-authored paragraphs, sections, frozen values, images, code, and downloads.
- Contributor notes attached to the content they explain. Reader exports exclude
  contributor-only content and resources before delivery.
- Reader and Contributor Markdown/resource bundles, plus inventory manifests.
  Choose your own documentation organization and publishing system.
- Explicit artifact lifecycle: `build` creates a fresh review candidate, `check`
  compares exactly, and `update` accepts a compatible baseline deliberately.
- Shared Rust validation and exports across native Rust and Node authoring.

A screenshot does not establish application correctness, and a passing run does
not verify arbitrary prose. Review the explanation and captured evidence together.
Exact captures require controlled browser, fonts, platform, and data. lgtmd does
not make uncontrolled systems deterministic or DOM queries unbreakable.

The initial Playwright adapter uses one project, no retries or sharding, and a
sole guarded reporter. Its full restrictions are documented in the
[Node SDK](packages/lgtmd/README.md#playwright). A canonical interactive viewer,
browser-hosted SDK, cursor/key overlays, and assisted execution remain future
work. The current static preview is a review utility.

## Develop from source

Use Rust 1.95.0 with rustfmt and Clippy, Python 3.11+, Node.js 24 with npm, and just.
The toolchain and dependency versions are pinned in the repository.

```sh
just setup
just verify
```

Setup explicitly installs dependencies, prepares the native Node compiler binary,
and installs Chromium. Verification runs formatting, Rust SDK/consumer checks,
Node tests, browser replay, exact repeated exports, and packaged Cargo/npm
consumers. See [development](docs/development.md) for focused and offline commands.
No N3 checkout, application renderer, Docker, model call, or paid service is
required by these workflows.

The Node runtime is **Node 24 ESM**. CI verifies macOS 15 arm64 and Ubuntu 24.04
x64. Contributors build the platform binary before packing npm; release packaging
combines both native binaries in one tarball. A prepared tarball installs and runs
without a Rust toolchain; there is no install-time build or fallback download.
Broader platform support, signing, and registry installation remain release work.

## Repository layout

```text
crates/lgtmd/                 Rust SDK, compiler, exports, and artifact lifecycle
crates/lgtmd-node/            Coarse native compiler/store bridge for Node
crates/doc-example-config/    Rust CLI/library consumers and retained baselines
packages/lgtmd/               Node SDK and optional Playwright integration
examples/lgtmd-web/           React/Vite application, HTTP API, fixtures, and guides
docs/architecture/            Maintained contracts and boundaries
docs/decisions/               Decisions and alternatives
```

See [architecture](docs/architecture/executable-documents.md), the
[native bridge decision](docs/decisions/0001-native-node-bridge.md), and
[AGENTS.md](AGENTS.md) for contributor boundaries.

## Who is using

[**N3**](https://github.com/gridaco/n3) is the first product integration and the
original incubation host. Its executable user-guide pipeline uses the Rust SDK;
N3 owns application replay, input, rendering, capture, and guide policy. During
release preparation, N3 consumes an exact Git revision. A crates.io dependency is
the preferred later integration after an explicitly authorized release.

The maintained examples here are our integrations, rather than evidence of
outside maintainer adoption. They run independently of N3.

## License and provenance

[MIT](LICENSE). The extracted source retains the original
`Copyright (c) 2026 Grida` notice. The
[N3 framework record](https://github.com/gridaco/n3/blob/a4cf59b8955b00eadfb61d19fecff4a99559f288/rfcs/0003-executable-documentation-framework.md)
and
[web incubation record](https://github.com/gridaco/n3/blob/a4cf59b8955b00eadfb61d19fecff4a99559f288/rfcs/0004-lgtmd-web-incubation.md)
retain the historical design and validation context.
