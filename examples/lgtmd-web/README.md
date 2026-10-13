# lgtmd web example

Build a small records application with React, TypeScript, and Vite, then develop
its filtering feature through executable documentation. The application uses an
ordinary HTTP API and Playwright fixtures. lgtmd authors and publishes its guide;
the application and fixture own their state, preparation, and cleanup.

Three complete documents use the same SDK and Rust compiler:

| Source                                              | What it demonstrates                                                                                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Record names](guides/01-record-names.ts)           | Explanation-only prose, a reused ordinary function, and a note attached to a passage. It makes no executed verification claim.                      |
| [Record resources](guides/02-resources.ts)          | Async preparation and cleanup, a frozen observation, a named native assertion, JSON as code and a download, CSV bytes, and a private text resource. |
| [Browser filtering](browser/filter-records.spec.ts) | Normal Playwright queries and assertions, filtering and clearing, a screenshot, and a targeted contributor note.                                    |

[Supplied context](guides/supplied-context.ts) calls the same resource authoring
function when another application runner already owns preparation. It is an
alternative execution path for the same document, not a fourth page. The SDK
does not acquire or dispose of that supplied context.

## Run the application

Use Node.js 24 ESM and the pinned workspace dependencies. From the repository root,
install dependencies, build the local Rust binding and TypeScript SDK, and install
Chromium explicitly:

```sh
just doc-web-setup
```

Start the API in one terminal and the Vite development server in another:

```sh
npm run dev:api --workspace @lgtmd/example-web
```

```sh
npm run dev --workspace @lgtmd/example-web
```

Open <http://127.0.0.1:4173>. The API listens on port 4174; Vite proxies its
requests. The root page loads the sample records immediately, so viewing the
application requires no test fixture or seed command. Playwright creates isolated
workspaces through the same API for its tests.

Documentation runs build the app, then start production preview and a test API
on ports 4183 and 4184.
The development servers can stay open; the test configuration owns its services
and uses the same React application. Vite excludes the generated `.cache/` tree
from its dev watcher, so writing Playwright HTML traces does not reset an open
development session.

These are conventional application commands:

```sh
npm run build --workspace @lgtmd/example-web
npm run preview --workspace @lgtmd/example-web
```

`build` checks TypeScript and writes Vite's production bundle to ignored `dist/`.
`preview` serves that bundle at <http://127.0.0.1:4175> and still requires the API. React's browser bundle
does not import lgtmd; the SDK is a development dependency used by the authoring
and test processes.

## Develop a feature with its guide

The filtering example keeps the reader's instructions beside the actions and
assertions that support them. Its development loop is:

1. Describe the promise in [the browser document](browser/filter-records.spec.ts):
   entering part of a name narrows the list, and clearing the field restores it.
   Write ordinary Playwright assertions for both outcomes alongside the prose.
2. Implement the interaction in [the React application](src/App.tsx). Use the
   development server to inspect and interact with the normal application.
3. Run the document to produce a fresh review candidate:

   ```sh
   npm run docs --workspace @lgtmd/example-web -- build "$PWD/.cache/lgtmd-web-review"
   ```

4. Read the `reader/` and `contributor/` Markdown exports and inspect the filtered
   list image. Contributor notes explain fixture conditions and verification
   limits without entering the reader's guide. Bring feedback into the same
   React implementation and browser document, then build another candidate at a
   fresh output path. `build` rejects an existing destination.
5. After reviewing an intentional change, accept it into a project-owned baseline
   directory explicitly:

   ```sh
   npm run docs --workspace @lgtmd/example-web -- update "$PWD/.cache/lgtmd-web-baseline"
   npm run docs --workspace @lgtmd/example-web -- check "$PWD/.cache/lgtmd-web-baseline"
   ```

`check` runs the same documents and compares the retained trees exactly. It does
not accept drift. A project can choose its own baseline path and commit the
reviewed tree. Fresh candidates, repeatable runs, and accepted baselines serve
different purposes.

The browser document is the narrative source: there is no separate prose
template to keep synchronized. Assertions remain normal Playwright assertions;
they do not need a lgtmd wrapper. The guide gives product feedback a concrete
place to land alongside the implementation and executable promises.

## Run the documents

The commands above run all three authoring sources and use one completed browser
run for both audiences. The browser dependency is pinned to Playwright 1.64.0.

For the two documents that do not require a browser, use a separate output root:

```sh
npm run docs --workspace @lgtmd/example-web -- build "$PWD/.cache/lgtmd-node-review" --without-browser
```

That subset is useful for authoring or binding checks. It does not establish the
browser example's behavior or screenshot baseline.

`just doc-web-test --offline` runs the complete local web and package checks.
`just doc-web-smoke --offline` repeats the portable gate in an independent copy,
including the Rust 1.95 baseline. Setup is separate: checks do not fetch a browser
or require Docker. The native package and browser capture have been verified on
macOS 15 arm64 and Ubuntu 24.04 x64; other platforms need their own binding and capture gate.

## Application and runner ownership

[The application fixture](browser/application-test.ts) creates an isolated
workspace through the example's HTTP API and removes it during ordinary
Playwright teardown. [The API server](server/index.mjs) stores the supplied records
in memory; [the React application](src/App.tsx) renders the accessible search
page. A real project can replace this fixture with its existing mocks, seeds,
services, or already-prepared state.

React with Vite is one complete integration shape. A Next.js project can keep its
own application and Playwright configuration and use the same SDK boundary;
this example does not exercise or establish support for a particular Next.js
configuration.

`withDocs(applicationTest)` adds a `doc` fixture while preserving the application's
fixtures and assertions. Calling `doc.assets.image()` registers the bytes returned
by a normal Playwright screenshot; it does not control browser input or alter the
application. Record names and the CSV buffer are intentionally mutated after
registration in the resources example to exercise snapshot ownership. The exports
must retain their original contents.

The browser document uses unwrapped Playwright assertions. Their success belongs
to the host test result; the SDK does not manufacture named checks for them. The
resources document separately shows the optional `doc.check()` wrapper around a
native assertion and an observation that is not an assertion.

## Completion and supported scope

Documentation captures use the production Vite bundle. Keeping hot reload and
development dependency optimization out of that process gives captures a stable
application build while ordinary development still uses Vite's dev server.
The Playwright configuration owns these commands; lgtmd does not invoke or know
about Vite itself.

[The configuration](playwright.config.ts) selects one Chromium project, no retries,
and a fixed viewport, locale, timezone, color scheme, and reduced-motion preference.
It also selects CPU rasterization and disables partial-raster reuse: fresh macOS
CI captures otherwise differed at rounded-border antialiasing pixels despite
identical application content. The image receipt identifies this capture profile,
the pinned Playwright version, and host platform. These are example-owned browser
settings, not SDK defaults. Exact screenshots still depend on their capture
environment; this example makes no cross-platform pixel-identity claim.

Use `docsReporter()` as the sole configured reporter and run through
`runPlaywright()`, as [the entry point](run.ts) does. The SDK stages document
attachments during the test and publishes only after the complete Playwright
process exits successfully and a unique completed receipt validates. Test or
worker teardown failures, global teardown failures, timeouts, interruption, caught
named-check failures, and document ID collisions block publication.

Playwright swallows exceptions thrown by custom reporter methods. To preserve
their failures, pass publicly imported reporter instances to the guard:

```ts
reporter: docsReporter({ reporters: [new ProjectReporter()] })
```

The guard awaits returned promises through `onExit`. Adding other reporters
outside it is rejected. Built-in reporter name tuples are not delegated by this
initial adapter; it provides its own concise terminal output. Running the
Playwright CLI directly can produce test diagnostics and document attachments,
but never publishes documentation.

The initial adapter explicitly rejects retries, repeated runs, multiple projects,
dependency/teardown projects, and shards. It requires every discovered test to
pass cleanly. These limits keep execution attempts unambiguous while the shared
document APIs remain experimental.
