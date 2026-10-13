# lgtmd TODO

This backlog moved with lgtmd from N3 into this dedicated repository. Items record
follow-up work; they are not claims of current support or completed setup.

## 1. User-facing adoption guides and a complete server/client example

The [React/Vite example](examples/lgtmd-web/README.md) already runs a client and
HTTP API together, prepares isolated records, checks browser behavior, captures
an image, and cleans up through project-owned fixtures. The remaining work is to
turn that foundation into complete adoption guidance.

- [x] Write a user-facing guide explaining what lgtmd provides, what developers
      author, what readers receive, setup requirements, limitations, and when adopting
      it is worthwhile. Show the workflow from developing a feature and writing its
      guide through reviewing generated output and checking an accepted baseline.
- [ ] Provide distinct paths for **new projects** and **existing projects**. For
      new projects, recommend an **lgtmd-native setup for the best experience**:
      establish executable guides, project-owned fixtures and state preparation, and
      documentation checks from the start. Explain this as a development convention
      using ordinary application and test tooling, with no required frontend/backend
      topology or lgtmd dependency in the application's runtime.
- [ ] Treat existing-project adoption as the trickier path. Demonstrate starting
      with one valuable workflow, reusing existing tests and fixtures, and adding
      documentation incrementally. Explain the work that may be needed around
      authentication, mocks or seeds, cleanup, selectors, and reproducible captures;
      do not imply that installing the SDK solves these concerns.
- [ ] Complete the adoption walkthrough around the existing **server + client
      example working together** and use it to answer the major practical questions.
      Build on the current React + Vite and HTTP API example. Show who starts each
      service, how the client reaches the server, how scenario data is prepared and
      isolated, how behavior is checked
      and documented, how cleanup works, and how the same workflow runs locally and
      in CI. Explain the boundaries of mocked state and a seeded backend, including
      what each example actually verifies.

Application architecture, authentication, backend/database provisioning, mocks,
seeds, and deployment remain project responsibilities. The guide and examples
should make these integration choices understandable while keeping lgtmd's
authoring and lifecycle interfaces agnostic to the project's stack and topology.

## 2. Built-in docs site and change review

**V1 implemented and verified with one native CLI; not yet released.**

- [x] Move all CLI orchestration into one Rust executable with an embedded
      frontend; keep npm as a thin launcher and verify native/Node invocation
      parity, cancellation, and serving without Node. The
      [user guide](docs/guide/develop-and-record.md) describes the experience. The
      [docs-site decision and delivery plan](docs/decisions/0002-docs-site-and-git-review.md)
      records the direction. The [v1 execution plan](docs/plans/docs-site-v1.md) fixes
      the implemented scope, interfaces, defaults and verification gates.
      Markdown exports remain supported.

- [x] Write the user-facing docs-site workflow before implementing it, clearly
      distinguishing planned commands from 0.1.0 support.
- [x] Design the compiled site bundle and render Rust/Node examples using the
      same frontend for development and static deployment. Preserve audience
      filtering and existing Markdown exports.
- [x] Add `lgtmd dev`, `lgtmd build`, and `lgtmd preview` with explicit project
      configuration, explicit retained-output reuse, opt-in full-flow watching, and
      visible failures/stale output. Add exact `check` and explicit
      `update --candidate ID`; application setup and cleanup remain project-owned.
- [x] Add Git-backed revision selection and text/before-and-after screenshot
      review over retained completed bundles. Keep missing history/evidence and
      incompatible captures explicit; never rerun historical code silently.
- [x] Provide Previous/Current document review, Before/After images, and optional
      client-computed Regions boxes with honest format/size/profile fallbacks.
      Keep presentation choices out of the engine comparison contract.
- [x] Make the review guide executable using lgtmd and real browser assertions
      against fixed public example history. Capture the review interface once;
      never feed that guide's evidence back into its own comparison fixture.
- [x] Verify installed consumers, private-content exclusion on both comparison
      sides, unchanged Git/baseline state during review, and exact reproducibility.
      Inspect the rendered guide before marking the feature available.

- [x] Adopt Tailwind with semantic theme tokens, an optional ordinary CSS
      override, Light/Dark/System appearance, and stable styling hooks. Keep
      presentation separate from document identity and exact evidence checks.
- [ ] Offer optional editable viewer components or a custom frontend build path
      for structural and behavioral customization, without requiring an engine
      fork. Keep ordinary CSS theming independent of this later interface.

Git supplies revisions; the frontend consumes completed documents. Managed
hosting, collaborative comments, remote evidence storage, and additional image
comparison modes remain separate work.

## 3. Project website: landing page and documentation

- [ ] Introduce `www/` for lgtmd's public website, serving both the product landing
      page at `/` and user-facing documentation under `/docs`. **Astro is a
      candidate**, not a selected dependency yet.
- [ ] Start with a static deployment on **GitHub Pages**. Keep navigation and
      resource URLs compatible with the deployment base path, including a Pages
      project subpath if used before a root domain is configured.
- [ ] Connect the landing page to the adoption guides in item 1 and complete
      examples. Clearly distinguish available features from planned capabilities.
- [ ] Use the site to demonstrate the built-in docs experience from item 2 as it
      lands. Keep project branding and hosting separate from the reusable viewer;
      consumers must not need lgtmd's website or hosting setup to use the SDK.

The first static landing page and guides can ship before the full comparison
viewer.
