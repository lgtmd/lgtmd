# lgtmd TODO

This backlog moved with lgtmd from N3 into this dedicated repository. Items record
follow-up work; they are not claims of current support or completed setup.

## 1. User-facing adoption guides and a complete server/client example

- [ ] Write a user-facing guide explaining what lgtmd provides, what developers
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
- [ ] Develop a complete **server + client example working together** and use it
      to answer the major practical adoption questions. Build on the current React +
      Vite and HTTP API example. Show who starts each service, how the client reaches
      the server, how scenario data is prepared and isolated, how behavior is checked
      and documented, how cleanup works, and how the same workflow runs locally and
      in CI. Explain the boundaries of mocked state and a seeded backend, including
      what each example actually verifies.

Application architecture, authentication, backend/database provisioning, mocks,
seeds, and deployment remain project responsibilities. The guide and examples
should make these integration choices understandable while keeping lgtmd's
authoring and lifecycle interfaces agnostic to the project's stack and topology.

## 2. Built-in docs site and change review

**Planned product scope; not implemented.** Deliver a first-party docs website
for reading guides and reviewing changes to their text and screenshots. This
carries forward the intended canonical viewer and makes change review an explicit
roadmap commitment. Markdown exports remain a supported choice.

- [ ] Read compiled guides with navigation, prose, images, code, and downloads.
      Opening a page must not execute its authoring script or rerun the application.
- [ ] Show contributor notes attached to the content they explain. Reader exports
      must exclude contributor-only content, resources, and metadata before delivery;
      a viewer toggle is presentation, not access control.
- [ ] Compare a retained candidate with an accepted baseline, including text
      changes and before/after screenshots. Choose additional image views through
      concrete review examples; an overlay or pixel-difference mode is not yet a
      fixed interface commitment.
- [ ] Preserve stable page and resource identities and show missing historical
      evidence as unavailable. Do not silently recapture an older revision or
      represent unmatched content as unchanged.
- [ ] Keep comparison separate from acceptance. Visual review must not weaken
      exact checks or automatically accept a baseline. Demonstrate reading a guide,
      inspecting its notes, and reviewing an intentional text and screenshot change
      with a complete example before claiming the viewer is available.

The viewer consumes completed document bundles through an explicitly designed
contract. The current inventory manifest alone is not that contract. Git may
later supply revisions, while local baselines and build artifacts remain valid
sources. Git integration, managed hosting, collaboration services, and a general
plugin system are separate decisions, not requirements of this milestone.
