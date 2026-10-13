# Get started with lgtmd

<a id="block-0001"></a>

Keep screenshots and explanations together. Write the guide beside the actions that produce its evidence, then regenerate and review both when your product changes.

lgtmd compiles code-authored guides into Markdown and a docs site. It works with your existing fixtures and assertions. Your project owns its application, services, test data, authentication and cleanup.

## Availability

The SDK is published as **lgtmd 0.1.0**, with npm's **next** tag. The docs-site CLI shown in this guide is available from the prepared source checkout and its packed candidate; it has not yet been released to the registries.

The current Node package supports Node.js 24 ESM on macOS arm64 and Linux x64. Rust authors use the Rust crate and their normal toolchain. Both use the same native lgtmd command. npm supplies a launcher for that executable; a native installation can serve docs and run Rust-authored flows without Node. The frontend is included in the executable.

## Author your first guide

Install the SDK and keep the runner in your project. A simple Node guide uses ordinary code:

```ts
import { guide, runGuide, completeRun } from "lgtmd";

const introduction = guide({ id: "hello", title: "Hello" }, (doc) => {
  doc.md`Welcome to our product.`;
});

await completeRun([await runGuide(introduction)]);
```

Place the runner in `docs/authoring/run.ts`, then configure its command:

```json
{
  "schemaVersion": 1,
  "title": "My product",
  "flow": { "command": ["node", "docs/authoring/run.ts"] }
}
```

Save this as `lgtmd.config.json`. Run the installed command through a package script or `npm exec -- lgtmd dev`. A Rust runner can use `cargo run --example guides` and `lgtmd::handoff::complete_run` instead.

## Add evidence where it matters

Use your normal assertions to establish behavior, then attach a screenshot or another resource to the explanation. An image illustrates what happened; it does not prove every statement in a paragraph.

For Playwright, retain your existing fixtures with `withDocs(test)`, use `docsReporter()`, then collect the completed run with `collectPlaywright`. Pass those documents to `completeRun` only after your own cleanup succeeds. A failed process, fixture or guarded reporter cannot become a successful docs candidate.

For a new app, explicit state providers or isolated seeds make guides easier to reproduce. In an existing app, start with one useful flow and your current testing setup. lgtmd cannot make DOM selectors unbreakable or remove external nondeterminism.

Build screenshots in a stable browser, font, viewport and rendering environment. Live services, clocks, changing data and animations can produce real byte differences. Investigate those differences before accepting a new baseline.

