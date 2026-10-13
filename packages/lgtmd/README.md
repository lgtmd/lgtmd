# lgtmd for Node

Write documentation beside ordinary application code. Combine prose, frozen
values, downloads, images, and contributor notes; use native assertions when
a claim should be verified. The shared Rust compiler exports Reader and
Contributor Markdown/resources from one completed run.

This SDK is maintained in the standalone lgtmd repository. The npm package remains
private and unpublishable; these APIs and schema-v1 input are experimental.

```ts
import assert from "node:assert/strict";
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
  reader: "/absolute/new-review/reader",
  contributor: "/absolute/new-review/contributor",
});
```

`guide` declares content without executing it. `runGuide` executes authoring and
returns frozen input only after acquired cleanup succeeds. An optional `prepare`
returns `{context, cleanup?}`; the project owns partial preparation failure.
`runGuideWithContext(page, context, write)` accepts an existing runner's context
without taking over cleanup. Primary and cleanup failures retain both errors.

`doc.md` dedents its literal Markdown and ends each block automatically. Scalar
substitutions and observation values are escaped. Typed image/link/code views
retain references; code views occupy their own blank-line-separated block.
Use ordinary functions for reuse and `section(id, title)` for a stable anchor.
Paragraph IDs are automatic. Resource registration appends no prose.

`observe` records a snapshot, and `check` executes a native assertion returning
void. Checks are optional. Caught check failures still taint the document; pending
checks prevent finishing. An ordinary assertion outside `check` remains the
host's outcome and does not manufacture a named SDK check. Values and bytes copy
at registration. Unsupported JSON fails rather than silently disappearing.
The [Rust SDK](../../crates/lgtmd/README.md#shared-compiler-and-node-authoring)
describes the portable value domain and host serialization limits.

Notes are plain contributor prose. Reader exports omit notes, exclusively private
resources/observations, and their metadata. Check IDs and status remain public
metadata; their values appear only when referenced publicly. Notes use a separate
counter, so adding them does not change Reader anchors or bytes.

`compile(documents, layout?)` returns both audiences without writing files.
`publish` uses Rust's owned artifact store: `build` requires fresh destinations,
`check` compares exactly without acceptance, and `update` explicitly accepts a
compatible baseline. `layout` selects page/resource prefixes and exact page
overrides. Destinations must be separate, including transaction siblings; symlink
paths are rejected. Audiences publish independently, not as one atomic operation.

## Playwright

```ts
import { test as applicationTest, expect } from "@playwright/test";
import { withDocs } from "lgtmd/playwright";

const test = withDocs(applicationTest);
test("Find a record", async ({ page, doc }) => {
  doc.page({ id: "find-record", title: "Find a record" });
  // Navigate and prepare using the project's existing fixtures.
  await page.getByRole("searchbox", { name: "Search records" }).fill("Alpha");
  const results = page.getByRole("list", { name: "Records" });
  await expect(results.getByRole("listitem")).toHaveCount(2);
  const image = doc.assets.image("matches", await results.screenshot());
  doc.md`The two matching records appear below.

${image.embed("Two matching records")}`;
});
```

Configure `reporter: docsReporter()` and run through `runPlaywright(options)`.
Existing fixtures, queries, assertions, app state, and backend preparation stay
project-owned. A fixture only attaches candidate input. The parent publishes
after the runner process exits successfully and its unique completed receipt
confirms all tests, teardown and reporters succeeded. Timeout, interruption,
worker/global teardown failure, swallowed named check failure, duplicate document
IDs, and missing receipts block publication.

Playwright swallows reporter exceptions, so `docsReporter({reporters: [...]})`
guards imported custom reporter instances through their final callbacks. It must
be the sole configured reporter; unguarded extra reporters are rejected. Built-in
reporter-name delegation is not supported. Direct `playwright test` can collect
attachments but never publishes docs. Initial support requires one project,
retries zero, repeatEach one, no shards or dependency/teardown projects, and clean
passed outcomes for every discovered test. Unsupported modes reject acceptance.

See the [complete example](../../examples/lgtmd-web/README.md), including its
server, preparation fixture, config, and finalizer. DOM queries remain subject to
application changes; documentation does not make them unbreakable.

## Development and support

From the lgtmd repository root:

```sh
just doc-web-setup
just doc-web-test --offline
just doc-web-smoke --offline
```

Setup explicitly installs npm dependencies and Chromium, builds the native bridge,
and compiles TypeScript. Checks do not silently download browsers or require
Docker. The standalone gate copies only portable sources, tests them in their own
workspace, packages Cargo/npm, and installs the npm tarball with Rust absent from
PATH. Playwright is an optional peer; importing the core does not require it.

Initial runtime: **Node 24, ESM**. Native `darwin-arm64` is the locally verified
target; `linux-x64` has a configured CI lane and remains unverified until that lane
runs. Other targets, CommonJS, and browser-hosted SDK execution have no support
claim. Installing a prepared npm tarball requires no Rust compiler; contributors
build the platform binding before packing. There is no install-time build or
fallback download. Unsupported platforms fail clearly. Distributed binaries,
signing, release versions, registry installation, and broader platform testing
remain release work.

The compiler and strict artifact store are Rust; authoring and host lifecycle are
native Node APIs. WASM compilation was exercised against the same input, but its
filesystem publication is unsupported. The initial coarse native bridge reuses
the existing store without implementing a second filesystem contract. A full
canonical viewer, cursor/key overlays, and AI-assisted execution remain later
work. Repository extraction is complete; release and public distribution are deferred.
