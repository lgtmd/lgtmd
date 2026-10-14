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

### Stay dogfooding example: guest and host stay requests

Implemented and verified locally on 2026-10-14. The
[Stay example](examples/stay/README.md) includes the application, filtering and
guest/host guides, two fixture ownership paths, and exact evidence checks. General
adoption guides above remain separate follow-up work.
The [five-hour execution plan](docs/plans/stay-dogfooding.md) fixes scope,
ownership, autonomous decisions, and acceptance gates.
Use an Airbnb-inspired accommodation workflow with original branding, fictional
listings, and a polished responsive React/Vite interface. One application should
cover both the guest journey and the support-style host inbox; a separate inbox
example is unnecessary for this milestone.

- [x] Build one complete workflow: a guest opens a listing, chooses dates, and
      submits a stay request with a message; the host reviews the request, edits
      a mocked AI reply, responds, and accepts the request; the guest sees the
      persisted response and updated status. Use a small real HTTP API and an
      isolated in-memory store. Scope excludes payments, maps, production
      authentication, and a full marketplace or property-management system.
- [x] Keep the AI boundary project-owned, using a pinned mock provider with
      scripted output, controlled streaming, and a failure/retry scenario.
      Demonstrate explicit control of scenario data, visible times and IDs, and
      two declared response variants whose changed evidence fails exact
      comparison. Do not claim that mocks make live model output deterministic.
- [x] Demonstrate both supplied sandbox state and test-owned API preparation and
      cleanup. Verify guest/host state transitions, workspace isolation, reload
      persistence within the running server, and unsuccessful-run/cleanup
      behavior. No real database or external model calls are required.
- [x] Author natural guest and host guides alongside the scenarios, with a
      separate adoption explanation for fixture ownership and verification
      limits. Guest and host are application roles; both need Reader guides.
      They must not be represented by lgtmd's Reader/Contributor audience split.
- [x] Add detailed collection filtering and a third executable guide: search,
      inclusive nightly budget, guest capacity, all-selected amenities, draft
      apply/cancel/reset behavior, removable chips, URL persistence, validation
      and empty-state recovery. Verify keyboard focus and mobile sheet scrolling.
- [x] Add a guest AI stay-finder menu and executable chat guide using the local
      AI SDK mock. Demonstrate follow-up preferences, grounded listing cards,
      no-match recovery, persisted conversation, and a fresh-chat action without
      live provider calls or availability claims.
- [x] Keep an example-local `feedbacks.md` recording authoring friction,
      reproductions, workarounds, fixes, deferred proposals, and verification.
      Prioritize the application and guides; bound product fixes to demonstrated
      bugs and small compatible improvements. Record ambiguous contracts or
      larger features for later review rather than expanding this milestone.

## 2. Built-in docs site and change review

**V1 implemented and verified with one native CLI; included in npm 0.2.0.**

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
- [x] Provide Previous/Current document review, slider and side-by-side image
      views, and optional client-computed annotations with honest format/size/profile fallbacks.
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
- [x] Provide a canonical Git-free viewer showcase with retained versions,
      full-page captures, subtle pixel changes and focused edge-case pages.
      `just docs-demo` opens it; `just docs-git-demo` retains real Git integration.
- [ ] Evaluate simpler history recording and browsing of pre-existing docs from
      the [unratified demo feedback](FEEDBACKS.md). Current Git review requires
      committed site snapshots; ordinary source commits alone do not contain
      executable evidence. Automatic recording and legacy-document import remain
      proposals, not part of the implemented history browser.
- [x] Select text-diff tooling and a bounded first-version contract: jsdiff
      `diff` 9.0.0, existing React rendering, conservative block matching,
      Unicode-safe ranges and explicit work limits. See the
      [text diff v1 contract](docs/plans/text-diff-v1.md).
- [x] Implement that contract: word/limited character highlights for prose,
      exact line highlights for code, and coarse fallback for complex blocks.
      The source viewer highlights each side’s own text without changing layout.
      Bounded workers, privacy, browser and exact own-guide checks cover v1;
      this implementation is included in npm 0.3.0.
- [ ] Evaluate accessible image enlargement or original-size inspection on small
      screens. Stay dogfooding showed that desktop captures fit a mobile reading
      column but their UI text becomes small. Keep ordinary reading, focus,
      download access and image comparison coherent; no gallery or resource
      protocol is selected. See [the observed feedback](examples/stay/feedbacks.md).

### Text diff research (2026-10-14; v1 included in npm 0.3.0)

The [v1 contract](docs/plans/text-diff-v1.md) selects jsdiff `diff` 9.0.0.
The following shortlist records the alternatives considered; it no longer
requires a broad comparison project. The contract records implementation and
verification evidence.

Initial shortlist and references:

| Candidate or precedent                                                                                                                                                        | Evidence and fit to investigate                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [jsdiff (`diff`)](https://github.com/kpdecker/jsdiff)                                                                                                                         | BSD-3-Clause core with word, line and token-array comparison. A starting candidate for block alignment plus inline edits in our existing content tree. Word mode ignores whitespace by default; choose explicit policies for prose and code. Evaluate Unicode segmentation and consistency across browsers.                                                                                                                                                                        |
| [Sanity's `@sanity/diff-match-patch`](https://github.com/sanity-io/diff-match-patch)                                                                                          | Apache-2.0 TypeScript fork with diff functions, semantic cleanup and surrogate-pair fixes. [Sanity documents use of the algorithm](https://www.sanity.io/docs/changelog/7847d0f0-521b-4766-b8b3-4d4b91868fee). Compare its readable edit ranges with jsdiff; plain-text comparison still needs our block/markup mapping. The [original Google repository](https://github.com/google/diff-match-patch) is archived, so evaluate the fork rather than assuming upstream maintenance. |
| [Read the Docs Visual Diff](https://docs.readthedocs.com/platform/stable/visual-diff.html)                                                                                    | A documentation precedent for highlights in rendered content and next/previous change navigation. Its [addon dependency manifest](https://github.com/readthedocs/addons/blob/main/package.json) lists `visual-dom-diff` and `diff-match-patch`. Study the approach and documented table/link limitations; dependency presence alone does not establish each package's exact role. Prefer evaluating our structured content before adopting DOM mutation.                           |
| [ProseMirror changeset](https://github.com/ProseMirror/prosemirror-changeset) and [Tiptap Snapshot Compare](https://tiptap.dev/docs/collaboration/documents/snapshot-compare) | Rich-text references, not the default integration choice. The MIT changeset module consumes document editing steps/maps; lgtmd retains completed snapshots, not editor history. Tiptap's comparison extension is distributed through its private registry and tied to its editor model. Do not assume it uses the changeset package internally or import an editor stack just for review.                                                                                          |

Implementation and acceptance now follow the [v1 contract](docs/plans/text-diff-v1.md).
Keep our alignment and rendering layer small; reuse the selected algorithm core.
Fine-grained tables/lists, move detection and source diff panes are deferred.
Library or budget failure must produce a truthful coarse fallback, never change
Rust's exact comparison or the recorded evidence. The viewer now includes the
pinned dependency and its license notice.

Git supplies revisions; the frontend consumes completed documents. Managed
hosting, collaborative comments, remote evidence storage, and additional image
comparison modes remain separate work.

## 3. Project website: landing page and documentation

- [x] Add an isolated Astro placeholder in `www/`, with `/` and a `/docs/` guide
      link page, a locked install, website build CI and Git-owned Vercel build
      configuration. See [website setup](www/README.md). This is scaffolding;
      the full landing page and embedded documentation remain unfinished.
- [ ] Connect the website to **Vercel**, with `www` as its stable project root,
      and verify production deployment after a merged PR. Automatic deployments
      are limited to `main`; contributor previews use local builds. Vercel supersedes the
      original GitHub Pages proposal. Domain and account setup remain separate
      from the committed build configuration.
- [ ] Replace the placeholder with the product landing page and the actual
      user-facing documentation under `/docs`. Keep the framework replaceable
      through source and deployment configuration changes.
- [ ] Connect the landing page to the adoption guides in item 1 and complete
      examples. Clearly distinguish available features from planned capabilities.
- [ ] Use the site to demonstrate the built-in docs experience from item 2 as it
      lands. Keep project branding and hosting separate from the reusable viewer;
      consumers must not need lgtmd's website or hosting setup to use the SDK.

The first static landing page and guides can ship before the full comparison
viewer.

## 4. Native application integration research

- [ ] Investigate React Native as a later dogfooding target. Evaluate native
      execution, automation, capture, project-owned preparation/cleanup, and
      delivery of completed evidence to the existing compiler boundary. Treat
      React Native Web/Expo web and actual iOS/Android execution as separate
      verification targets. This is a research proposal, not a support promise
      or part of the first guest/host web example; no native adapter or mobile
      app implementation is selected yet.
