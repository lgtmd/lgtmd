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
- [ ] Research text-level change highlighting: align document blocks, then show
      word insertions/deletions and useful line diffs for code. Current review
      only switches between **Previous / Current** documents; it does not render
      inline text edits. Keep the UI authored in lgtmd; evaluate reusing a diff
      algorithm core rather than embedding another product's diff viewer.
- [ ] Evaluate accessible image enlargement or original-size inspection on small
      screens. Stay dogfooding showed that desktop captures fit a mobile reading
      column but their UI text becomes small. Keep ordinary reading, focus,
      download access and image comparison coherent; no gallery or resource
      protocol is selected. See [the observed feedback](examples/stay/feedbacks.md).

### Text diff research (2026-10-14; proposal, no dependency selected)

Initial shortlist and references:

| Candidate or precedent                                                                                                                                                        | Evidence and fit to investigate                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [jsdiff (`diff`)](https://github.com/kpdecker/jsdiff)                                                                                                                         | BSD-3-Clause core with word, line and token-array comparison. A starting candidate for block alignment plus inline edits in our existing content tree. Word mode ignores whitespace by default; choose explicit policies for prose and code. Evaluate Unicode segmentation and consistency across browsers.                                                                                                                                                                        |
| [Sanity's `@sanity/diff-match-patch`](https://github.com/sanity-io/diff-match-patch)                                                                                          | Apache-2.0 TypeScript fork with diff functions, semantic cleanup and surrogate-pair fixes. [Sanity documents use of the algorithm](https://www.sanity.io/docs/changelog/7847d0f0-521b-4766-b8b3-4d4b91868fee). Compare its readable edit ranges with jsdiff; plain-text comparison still needs our block/markup mapping. The [original Google repository](https://github.com/google/diff-match-patch) is archived, so evaluate the fork rather than assuming upstream maintenance. |
| [Read the Docs Visual Diff](https://docs.readthedocs.com/platform/stable/visual-diff.html)                                                                                    | A documentation precedent for highlights in rendered content and next/previous change navigation. Its [addon dependency manifest](https://github.com/readthedocs/addons/blob/main/package.json) lists `visual-dom-diff` and `diff-match-patch`. Study the approach and documented table/link limitations; dependency presence alone does not establish each package's exact role. Prefer evaluating our structured content before adopting DOM mutation.                           |
| [ProseMirror changeset](https://github.com/ProseMirror/prosemirror-changeset) and [Tiptap Snapshot Compare](https://tiptap.dev/docs/collaboration/documents/snapshot-compare) | Rich-text references, not the default integration choice. The MIT changeset module consumes document editing steps/maps; lgtmd retains completed snapshots, not editor history. Tiptap's comparison extension is distributed through its private registry and tied to its editor model. Do not assume it uses the changeset package internally or import an editor stack just for review.                                                                                          |

Proposed evaluation, pending implementation approval:

- [ ] Compare jsdiff and Sanity's core on the same retained A/B document pairs.
      Measure readable results, installed/bundled size, runtime on long documents,
      cancellation/budgets, maintenance and license notices before selecting one.
- [ ] Design a small custom adapter for block alignment and mapping edit ranges
      back to safe content nodes. Cover headings, paragraphs, lists, tables,
      links, emphasis, code and adjacent images. Treat generated positional IDs
      as insufficient proof of matching blocks; test insertions near the start,
      repeated paragraphs, reordered sections and formatting-only changes.
- [ ] Compare rendered inline highlighting with an optional line-oriented source
      view using complete examples. Keep our image widgets and comment markers,
      accessible additions/deletions, change navigation, themes and mobile layout.
      Avoid raw HTML injection and distinguish changed link destinations from
      unchanged visible labels.
- [ ] Exercise whitespace, Korean/CJK, emoji and combining characters, whole
      added/removed pages, and both audiences. Diff only the already-filtered
      bundles. Client display heuristics must not alter Rust's exact comparison,
      candidate identity, snapshot acceptance or recorded evidence.

Working recommendation: own the alignment/rendering layer and reuse a small diff
core if the fixtures justify it. A fully custom core remains an option if these
libraries do not meet the measured requirements. This research does not authorize
implementation or change the current support claim.

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

## 4. Native application integration research

- [ ] Investigate React Native as a later dogfooding target. Evaluate native
      execution, automation, capture, project-owned preparation/cleanup, and
      delivery of completed evidence to the existing compiler boundary. Treat
      React Native Web/Expo web and actual iOS/Android execution as separate
      verification targets. This is a research proposal, not a support promise
      or part of the first guest/host web example; no native adapter or mobile
      app implementation is selected yet.
