![lgtmd — LGTM Docs](.github/assets/cover.webp)

# lgtmd

**Your UI changes. Your docs' screenshots should too.**

Write guides in TypeScript or Rust alongside the workflows they explain. Capture
screenshots and results, review changes, and check approved output in CI.

Read your guides in the built-in docs site or export Markdown to yours.

## Write the guide where the feature runs

From the [complete Playwright example](examples/lgtmd-web/README.md). The project
fixture prepares sample records; its runner builds the guide after tests and
cleanup succeed.

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
  doc.md`
    Enter **Alpha** in **Search records** to find matching records.

    ${image.embed("The two matching records")}
  `;
});
```

The instructions and screenshot come from the same workflow. Rerun it when the
feature changes, then review the guide alongside the code.

## Get started

```sh
npm i -D lgtmd
```

**Experimental.** Start with one guide. See the
[getting-started guide](docs/guide/getting-started.md),
[TypeScript setup and support](packages/lgtmd/README.md), or
[Rust setup](crates/lgtmd/README.md).

[See change review](docs/guide/review-changes.md) ·
[Try the viewer showcase](examples/review/showcase/README.md)

Used by [**N3**](https://github.com/gridaco/n3) for its executable user guides.

[Repository map](REPOSITORY.md) · [Contributing](CONTRIBUTING.md) · [MIT license](LICENSE)
