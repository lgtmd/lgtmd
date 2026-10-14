# lgtmd epics and milestones

This index groups existing follow-up work. The order below preserves the previous
backlog grouping; it does not assign priority, owners, dates, or release promises.
Those choices remain open for the project owner. An item here is not approval to
implement or publish it.

Use [GitHub Issues](https://github.com/lgtmd/lgtmd/issues) for feedback and
individual work. Record consequential alternatives in
[proposals and decisions](wg/decisions/README.md), and agreed execution scope in
[plans](wg/plans/). [REPOSITORY.md](REPOSITORY.md) maps the owning code and examples.

## Adoption through complete examples

Status: follow-up work; the working examples and introductory guides exist.

Outcome: a developer can choose a new-project or existing-project adoption path
and complete one valuable executable guide with understandable integration work.

Milestone scope:

- For new projects, explain an lgtmd-native development convention: establish
  executable guides, project-owned fixtures and state preparation, and checks
  alongside the feature. This is ordinary application/test tooling, with no
  required topology or lgtmd dependency in the application's runtime.
- For existing projects, demonstrate incremental adoption using one valuable
  workflow and existing tests/fixtures. Make authentication, mocks or seeds,
  cleanup, selectors, and capture reproducibility costs visible.
- Complete the server/client adoption walkthrough using the
  [React/Vite example](examples/lgtmd-web/README.md). Explain service startup,
  routing, isolated data, behavior checks, cleanup, and local/CI execution.
  Distinguish mocked state and a seeded backend, including verification limits.

Completion evidence: the walkthrough and its complete example support both
adoption paths without hiding fixture or infrastructure work. Application
architecture, authentication, databases, provisioning, and deployment remain
project-owned. [Stay](examples/stay/README.md) supplies further dogfooding evidence;
its completion does not itself complete these general adoption guides.

Related follow-up: [guarded runner diagnostics](https://github.com/lgtmd/lgtmd/issues/11).

## Docs-site adoption and review

Status: v1 is implemented; the following extensions remain proposals.

Outcome: evaluate demonstrated friction in reading, recording, and reviewing
executable documentation while preserving exact checks and explicit acceptance.

Areas awaiting selection:

- Structural/behavioral viewer customization through editable components or a
  custom frontend build path, without an engine fork. Ordinary CSS theming
  remains independent; no component interface is selected.
- [Simpler history recording and browsing](https://github.com/lgtmd/lgtmd/issues/10).
- [Browsing pre-existing documentation and media](https://github.com/lgtmd/lgtmd/issues/9).
- [Accessible image detail on small screens](https://github.com/lgtmd/lgtmd/issues/12).

Next milestone: select a bounded problem and record its expected experience and
completion evidence before implementation. Current Git review requires committed
site snapshots; source commits alone do not contain executable evidence.
Automatic recording, legacy import, and new image resource protocols are not
current capabilities.

Git supplies revisions; the frontend consumes completed documents. Managed
hosting, collaborative comments, remote evidence storage, and additional image
comparison modes remain separate work.

## Public website and documentation

Status: [Astro placeholder and build setup](www/README.md) exist; the full product
landing page and embedded documentation remain follow-up work.

Outcome: a concise product introduction leads to usable documentation and examples.

Milestone scope:

- Connect the website to Vercel with `www` as its project root, and verify
  production deployment after an authorized merged PR. Automatic deployment is
  limited to `main`; contributor previews use local builds. Domain and account
  setup remain separate from committed build configuration. Vercel supersedes
  the original GitHub Pages proposal.
- Replace the placeholder with the landing page and actual user documentation
  under `/docs`. Keep the framework replaceable through source and deployment
  configuration changes.
- Connect adoption paths, complete examples, and the built-in docs experience.
  State current availability accurately. Keep lgtmd website branding and hosting
  independent of the reusable viewer; consumers do not need our hosting setup.

Completion evidence: the deployed entry and documentation paths work and match
current capabilities. Deployment remains a separate authorized action; this
backlog entry does not authorize it.

## Native application integration research

Status: research proposal; no adapter or mobile implementation is selected.

Outcome: determine the feasibility and cost of React Native as a later dogfooding
target. Evaluate execution, automation, capture, project-owned preparation and
cleanup, and completed-evidence delivery to the existing compiler boundary.

Completion evidence: a bounded research record distinguishes React Native
Web/Expo web from actual iOS/Android execution, states what was exercised, and
records limitations and the next decision. It is not a support promise or part
of the completed guest/host web example.

## Completed foundations and evidence

- [Docs site v1](wg/plans/docs-site-v1.md): native CLI, retained Git review,
  executable own guides, theme controls, and the Git-free viewer showcase.
- [Text diff v1](wg/plans/text-diff-v1.md): selected algorithm, bounded rendering,
  implementation evidence, and the historical alternatives shortlist.
- [Stay dogfooding](wg/plans/stay-dogfooding.md): guest/host workflows, detailed
  filters, scripted stay-finder chat, fixture modes, and verification receipts.
  [Historical feedback and resolved fixes](https://github.com/lgtmd/lgtmd/issues/13)
  are preserved in a closed archive; unresolved follow-ups have separate issues.

These records retain their original verification scope. Moving or linking a
record is not a fresh runtime, CI, baseline, or release acceptance.
