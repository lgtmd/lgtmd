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
