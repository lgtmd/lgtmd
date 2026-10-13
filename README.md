![lgtmd — LGTM Docs](.github/assets/cover.webp)

# lgtmd

**Your UI changes. Your docs' screenshots should too.**

Write the guide alongside the workflow it explains. Capture screenshots, values,
and downloads from that workflow in TypeScript or Rust, then include them directly
in your prose. Rerun it as the product changes, review the results, and check the
approved output in CI.

## Write the guide where the feature runs

This shortened [React + Vite example](examples/lgtmd-web/README.md) uses a
Playwright fixture that prepares sample records. Its runner builds the guide
after the tests and cleanup succeed.

```ts
import { withDocs } from "lgtmd/playwright";
import { test as appTest, expect } from "./application-test.ts";

const test = withDocs(appTest);

test("Find a record", async ({ page, workspace, doc }) => {
  doc.page({ id: "find-record", title: "Find a record" });
  await page.goto(workspace.url);
  await page.getByRole("searchbox", { name: "Search records" }).fill("Alpha");

  const results = page.getByRole("list", { name: "Records" });
  await expect(results.getByRole("listitem")).toHaveText([
    "Alpha contract",
    "Alpha renewal",
  ]);

  const image = doc.assets.image("matches", await results.screenshot());
  const instructions = doc.md`
    Enter **Alpha** in **Search records** to find matching records.

    ${image.embed("The two matching records")}
  `;
  doc.noteOn(instructions)`This guide uses three isolated sample records.`;
});
```

Readers get the instructions and screenshot. Your team also gets the attached
note, excluded from reader exports. Keep explanations, assertions, and captures
in one source, and review them in the same change as the feature.

## Fit it into your project

- **Keep your tooling.** Reuse Playwright actions, assertions, and fixtures. Write
  API, CLI, and library guides in ordinary TypeScript or Rust too.
- **Own your docs.** Export Markdown and resources to your documentation site or
  repository. Build a fresh candidate, review it, then accept the changes.
  Later checks fail when the accepted output changes.
- **Start with one guide.** In an existing app, choose a workflow whose docs keep
  going stale. In a new app, develop the feature, guide, and fixtures together.

Your project owns authentication, sample data, and cleanup. Assertions check the
behavior you specify; prose still needs review. Exact screenshot comparisons need
a controlled browser, fonts, platform, and data.

## Get started

**Experimental; available from source.** npm and crates.io entries currently
reserve the name; no usable SDK release has been published.

- [React + Vite walkthrough](examples/lgtmd-web/README.md) — client, HTTP API,
  Playwright setup, and the complete guide workflow.
- [TypeScript SDK](packages/lgtmd/README.md) · [Rust SDK](crates/lgtmd/README.md) ·
  [Rust CLI and library examples](crates/doc-example-config/README.md).

The Node SDK runs as development tooling, outside your frontend bundle. Verified
setup: Node 24 ESM on macOS 15 arm64 and Ubuntu 24.04 x64. The initial Playwright
adapter requires a dedicated run with one project and no retries or sharding; see its
[configuration and limits](packages/lgtmd/README.md#playwright).

## Planned: a docs site built for review

Read your guides, see contributor notes, and compare changes to text and
screenshots before updating your published docs. The built-in site and visual
review are on the [roadmap](TODO.md#2-built-in-docs-site-and-change-review).
Markdown exports remain available for your existing docs stack.

## Who is using

[**N3**](https://github.com/gridaco/n3) uses lgtmd for its executable user guides,
with application replay and screenshots from its own renderer.

[Contributing](CONTRIBUTING.md) · [MIT license](LICENSE)
