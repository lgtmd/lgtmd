# Repository map

This is the authoritative map of lgtmd's layout and ownership. Link here from
other project guidance rather than maintaining another directory inventory.

## Project guidance

| Entry                                                  | Purpose                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| [README.md](README.md)                                 | Short product introduction, example, installation, and next steps.                    |
| [CONTRIBUTING.md](CONTRIBUTING.md)                     | Contributor entry point, setup, change review, and verification expectations.         |
| [AGENTS.md](AGENTS.md)                                 | Repository instructions for agents, including execution and authorization boundaries. |
| [AGENT_READINESS.md](AGENT_READINESS.md)               | Placeholder for assessing the agent experience across adoption and contribution.      |
| [TODO.md](TODO.md)                                     | Epic and milestone index; link to individual work in issues.                          |
| [GitHub Issues](https://github.com/lgtmd/lgtmd/issues) | Feedback, bugs, feature requests, discussion, and individual work items.              |
| [RELEASING.md](RELEASING.md)                           | Release preparation, verification, and explicitly authorized publication.             |

## Code and tooling

| Location                                                          | Responsibility                                                                                                                           |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [crates/lgtmd/](crates/lgtmd/README.md)                           | Rust authoring, frozen document model, validation, audience projection, exports, site bundles, exact comparison, and artifact lifecycle. |
| [crates/lgtmd-cli/](crates/lgtmd-cli/README.md)                   | Native CLI, embedded frontend, flow execution, candidates, Git reads, watching, serving, and coarse SDK bridge.                          |
| [packages/lgtmd/](packages/lgtmd/README.md)                       | Node authoring, lifecycle integration, native executable loading, and optional Playwright adapter.                                       |
| [packages/viewer/](packages/viewer/)                              | Shared React reading/review frontend, styles, text highlights, and browser-only image analysis.                                          |
| [crates/doc-example-config/](crates/doc-example-config/README.md) | Independent Rust CLI/library consumers, fixtures, and retained Reader/Contributor baselines.                                             |
| [examples/](examples/)                                            | Complete consumer applications and controlled review fixtures; see the examples below.                                                   |
| [www/](www/README.md)                                             | Public website project, with its own npm manifest and lockfile.                                                                          |
| [tools/](tools/)                                                  | Repository prose formatting and release automation with their tests.                                                                     |
| [skills/](skills/README.md)                                       | User-installable agent skills for adopting and using lgtmd in consumer projects.                                                         |
| [.agents/skills/](.agents/skills/)                                | Repository-agent skills for maintaining lgtmd; excluded from normal Skills CLI installation discovery.                                   |
| [justfile](justfile)                                              | Shared setup, verification, documentation, and example commands.                                                                         |
| [.github/workflows/](.github/workflows/)                          | CI, website build, and guarded release workflows.                                                                                        |

Rust owns shared document semantics and exact evidence comparison. Application
actions, state preparation, and cleanup stay in the host runtime. Node uses the
native executable; its CLI entry launches that executable. Viewer annotations
are presentation aids and do not change canonical check results. Read the
[architecture](wg/architecture/executable-documents.md) and owning package README
before changing these boundaries.

Keep consumer skills portable: bundle needed references or link public docs,
and do not assume the user has this source checkout. Maintainer skills may use
repository-relative guidance. Mark them with `metadata.internal: true` so the
public installer catalog stays focused on consumers; this is discovery metadata,
not a privacy boundary. Both directories are public repository content.

## User documentation and internal work

`docs/` contains user-facing documentation and the sources, assets, and tooling
that produce it. `wg/` contains internal engineering work.

| Location                                         | What belongs here                                                                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| [docs/authoring/](docs/authoring/)               | The authored user narrative, executable flows, and capture/verification helpers. Edit these sources when changing a guide. |
| [docs/guide/](docs/guide/)                       | Generated Reader Markdown, media, manifest, and ownership receipt. Do not hand-edit.                                       |
| [docs/snapshots/reader/](docs/snapshots/reader/) | Explicitly recorded Reader site bundle and resources for exact review. Do not hand-edit.                                   |
| [lgtmd.config.json](lgtmd.config.json)           | Configuration for this repository's own executable documentation.                                                          |
| [wg/architecture/](wg/architecture/)             | Implemented contracts, ownership boundaries, and engineering rationale.                                                    |
| [wg/decisions/](wg/decisions/)                   | Proposals, alternatives, decisions, and their explicit status.                                                             |
| [wg/plans/](wg/plans/)                           | Bounded execution plans, scope, dependencies, and completion gates.                                                        |
| [wg/development.md](wg/development.md)           | Internal setup, focused checks, diagnostics, and development workflows.                                                    |

Keep API reference beside its owning SDK. Put feedback and individual work items
in GitHub Issues; link them from plans and the epic index instead of duplicating
an issue backlog. A proposal or plan is not implementation or release approval.

Generated guides and retained example baselines are reviewed evidence. Change
their authored sources, build a fresh candidate, inspect it, and record only
intentional changes through the owning workflow. Ordinary build, dev, and check
commands do not accept baselines. Build output, dependency directories, caches,
prepared native binaries, and disposable captures remain ignored.

## Examples

| Example                                                | Start here to learn                                                                                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [Rust consumers](crates/doc-example-config/README.md)  | Document a configuration CLI and an existing library (`serde_json`), including fixtures, checks, both audiences, and exact retained baselines. |
| [React/Vite records app](examples/lgtmd-web/README.md) | Combine ordinary functions, async resources, an HTTP API, and browser filtering with project-owned fixtures.                                   |
| [Stay](examples/stay/README.md)                        | Document guest/host journeys in a larger application with mock AI and both fixture-owned and externally supplied context.                      |
| [Viewer showcase](examples/review/showcase/README.md)  | Explore retained Original/Revised text, image, note, and fallback examples without Git or fresh capture at launch (`just docs-demo`).          |
| [Git review example](examples/review/README.md)        | Exercise actual Git-backed review in disposable A/B history (`just docs-git-demo`).                                                            |

Examples own their application state, fixtures, capture policies, and retained
evidence. N3 is a separate consumer and retains its application adapter, replay,
renderer, and guides outside this repository.
