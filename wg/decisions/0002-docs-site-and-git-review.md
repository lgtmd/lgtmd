# Decision 0002: A docs site with Git-backed change review

Status: **V1 implemented and verified with one native CLI; included in npm 0.2.0**

Date: 2026-10-14

The [v1 execution plan](../plans/docs-site-v1.md) fixes the first implementation
scope, configuration, commands, client image modes and completion gates. It
supersedes open implementation choices in this direction record.

## Product contract

lgtmd is the framework. Users develop and publish a **docs site**. The reusable
browser frontend may be called the **viewer** internally; it is not a separate
product users must configure or a separate authoring application.

The [user guide](../../docs/guide/develop-and-record.md) was the first reviewable contract for this
work. At implementation, it distinguished the checkout from the published
0.1.0 SDK. Its narrative and real captures are generated from `docs/authoring/`.
The [existing architecture](../architecture/executable-documents.md) remains the
authority for the released SDK.

The first complete experience includes:

- `lgtmd dev`, `lgtmd build`, and `lgtmd preview` around the same documentation
  frontend, with guide navigation, prose, images, code, and downloads.
- Attached contributor notes, with audience filtering performed before delivery.
- Git revision selection and review of changed text and before/after screenshots.
- An executable lgtmd guide that demonstrates its own review UI using a controlled
  example rather than the evolving website as its comparison fixture.

Markdown exports remain supported. Application state, services, browser setup,
authentication, seeds, and cleanup remain project-owned. No hosted service or
account is required for the local workflow or static site.

## Command and execution boundary

| Command   | Planned responsibility                                                           | Completion boundary                                                          |
| --------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `dev`     | Invoke the configured runner and serve successful documents; watching is opt-in. | Only a completed successful run may replace the displayed current candidate. |
| `build`   | Invoke the runner, validate completed documents, and export a static site.       | Produce deployable output without accepting a baseline or deploying it.      |
| `preview` | Serve an existing completed build.                                               | Never run authoring, fixtures, capture, or historical code.                  |

Use explicit project configuration for the runner, watched inputs, navigation,
output paths and deployment base path. V1 uses the passive JSON configuration
specified in the execution plan. Capture profiles remain with the project's
flow. Do not discover N3, sibling checkouts, service topology, or a required
frontend framework.

The single Rust CLI orchestrates host-language runners; Rust compilation still receives
completed documents. Navigation and audience presentation use completed exports.
Selecting an unloaded Git revision asks the CLI to resolve and read its retained
bundle; the frontend then displays that bundle without running authoring.

For watching, coalesce changes and serialize runs initially. Exclude generated
output and transaction paths from watch inputs. Never publish partially completed
runs; preserve failures and cleanup outcomes. Retained previous output must have
visible stale/failed status. Exact affected-guide invalidation is a later
optimization, not a prerequisite for correctness.

The existing SDK `build` operation creates a fresh candidate and rejects an
existing destination. The new CLI `build` composes that lifecycle with site
export; it must not silently redefine the existing SDK operation. Ownership,
staging, interruption recovery, and output-path checks still apply.

Keep exact `check` and explicit `update` responsibilities separate from review.
V1 adds `lgtmd update --candidate ID` to accept the already reviewed immutable
candidate without rerunning authoring. The new site-store contract composes the
existing lifecycle; it does not change the old Markdown SDK `update` operation.
Choosing a comparison revision does not change the acceptance/check baseline.

## Compiled site bundle

Design a versioned output contract from completed Rust and Node documents. The
existing ownership/inventory manifest and schema-v1 authoring input are not that
contract. The browser must not infer a full document model from file inventory.

Start with what the examples require: page identities and navigation, ordered
content, section anchors, resource references and bytes, audience-filtered note
attachments, and capture compatibility/provenance. Preserve authored Markdown
and typed resource relationships; specify escaping and safe rendering of links,
raw HTML, and code. Export a second audience without another application run.

Use page and resource identities for comparison. Section/block anchors serve
navigation and note attachment within a version. Automatic block IDs are
positional, so v1 provides page-level Previous/Current views without promising
semantic paragraph alignment. More granular highlighting is a later client
presentation over the same completed content.

Validate bundles on load. Unsupported schema versions, unsafe resource paths,
missing resources, and incompatible capture profiles need specific outcomes.
Reader projection applies before serialization, including both versions of any
comparison, navigation/search metadata, and unused private resources. A frontend
toggle never grants or protects access to contributor data.

## Git revisions and retained evidence

Git is the first-class revision source for this milestone. The CLI resolves
history and supplies completed bundles to a frontend that has no Git or GitHub
dependency. Site rendering, ordinary build, and preview still work without Git;
historical comparison requires the selected repository and recorded snapshots.

The initial storage path is project-configured, Git-tracked completed bundles
and their resources. Document the repository-size tradeoff. Remote artifact
stores and Git LFS-specific retrieval are later integrations; missing local
payloads must remain unavailable rather than being fetched or fabricated silently.

- Local review defaults to recorded docs at `HEAD` versus the latest completed
  working candidate. A selected ref means that exact resolved commit, not a
  hidden merge-base substitution. Display both selection and resolved identity.
- A future PR workflow can explicitly select the merge base with the target
  branch. Do not guess a branch named `main`, an `origin` remote, or a GitHub host.
- Read tracked bytes without changing branches, the working tree, or index.
  Do not execute old authoring scripts. A missing historical bundle, shallow
  history, absent resource, or incompatible schema must be explained separately.
- Git identity selects versions; comparison uses retained compiled content and
  resource bytes. Compare page/resource additions and removals explicitly.
  V1 shows previous/current text and before/after images, with optional client
  Regions boxes for compatible static screenshots. Further visualizations remain
  client work and never relax exact artifact checks.
- Keep revision selection and run metadata outside self-referential content
  hashes. A tracked bundle cannot embed the hash of the commit that will contain
  it. Label a dirty working candidate honestly; retain capture producer/profile
  separately from Git identity. Do not let timestamps or temporary paths make
  deterministic example content drift.

The accepted baseline remains project-owned. Review does not stage files,
commit, merge, accept output, or publish. A deployment contains selected exported
content, never a copy of `.git` or an unrestricted revision-reading endpoint.

## Use lgtmd to document lgtmd

Do this in the first complete review milestone. It exercises the SDK as a real
consumer and gives users a concrete visual explanation. Bound it to one level:

```text
controlled example versions A and B
              |
completed guide/resource snapshots in a disposable Git history
              |
real docs site displaying the Git-backed comparison
              |
Playwright actions + assertions + one captured review view
              |
lgtmd's user guide explaining the review feature
```

There is no dependency from that final guide or capture back to A or B. The
example's history must not follow live `main`, current commit counts, an external
repository, or the public website. Use a tiny public example with fixed page,
section, and resource identities, one wording change, and one visual change.

Generate its images through the ordinary maintained capture path and retain
them as fixture evidence. Do not hand-paint screenshots of a feature that does
not exist. Create a disposable Git repository from those fixture bundles to test
actual ref resolution, including missing-history cases, without mutating a
developer's repository. Keep variable Git IDs out of accepted screenshot regions
or fix fixture commit metadata; assert the IDs separately.

The self-doc scenario must select the real comparison, assert its revision
identities and expected text/resource changes, inspect the before/after views,
and capture that interaction with the same SDK/Playwright integration available
to consumers. Use only intentionally public contributor notes in public
screenshots: export filtering cannot redact private information already baked
into an image. Verify projection for both compared versions separately.

Independent comparison tests establish matching and change classification; a
screenshot of the review UI is additional visual evidence, not their substitute.
A UI change should require reviewing a bounded demonstration, not recapturing
every page or feeding screenshots of screenshots into successive baselines.

The user guide is authored in `docs/authoring/` and generated into `docs/guide/`.
Its executable narrative replaced the initial handwritten guide. Generated output
is excluded from prose formatting; do not keep two independently maintained versions. Frontend rendering and audience
exports consume completed evidence. A configured authoring run may regenerate
the demonstration; page navigation and subsequent exports reuse that result.

## Delivery sequence and acceptance

Follow the [complete v1 plan](../plans/docs-site-v1.md): bundle/collection,
CLI/reading, Git/snapshots/review, client image modes, executable own guides, and
installed-package verification. The approved implementation covers that full
usable workflow. The plan records concrete commands, ownership, acceptance tests
and boundaries.

The first complete feature is accepted when a user can develop a guide, see a
failed run accurately, inspect a known Git text/image change, view contributor
context, accept the exact reviewed candidate and preview a public static build.
Its own generated guide must demonstrate that workflow with real evidence.
Marketing website deployment and N3 dependency updates remain separate work.

## References and deferred scope

The references informed the interaction and history model; they are not runtime
dependencies or promises of feature parity:

- [Read the Docs Visual Diff](https://docs.readthedocs.com/platform/stable/visual-diff.html):
  changes highlighted within rendered documentation, with page/chunk navigation;
  its comparison covers HTML rather than screenshot pixels.
- [Mintlify review](https://www.mintlify.com/docs/editor/review#compare-changes-before-merging):
  visual/source review alongside a Git publishing workflow; images currently
  lack a diff view.
- [GitBook change requests](https://gitbook.com/docs/collaborate/change-requests):
  split/inline document review and navigation between changed blocks.
- [Chromatic revisions and baselines](https://www.chromatic.com/docs/branching-and-baselines/):
  Git ancestry and retained snapshots are distinct responsibilities; review and
  regression-test baselines have different selection semantics.
- [GitHub rich diffs](https://docs.github.com/en/repositories/working-with-files/using-files/working-with-non-code-files):
  rendered prose and before/after image inspection over tracked files.

Managed hosting, collaborative comments, a visual authoring editor, Git-provider
approval/merge automation, remote evidence storage, generic plugins, AI-assisted
execution, and additional image comparison modes remain separate decisions.
Interactive history in a public deployment is deferred from v1. Any later
export must contain only explicitly selected, audience-filtered revisions.

### Unified executable ownership

V1 ships one Rust-owned CLI. npm is a thin launcher, and the same executable
serves the internal SDK bridge and embedded React frontend. Configuration, Git,
flow execution, candidates, watching and HTTP have one implementation. The TS
SDK keeps native JS authoring and integrations. A Rust flow and the native docs
server do not require Node; contributor frontend builds do. This supersedes the
initial Node-hosted CLI choice.

### Presentation and customization

The bundled React frontend uses Tailwind with semantic `--lgtmd-*` tokens,
Light/Dark/System appearance, and a small stable `data-lgtmd-part` hook set.
Consumers can load an ordinary CSS override through optional
`theme: { css: "docs/theme.css" }` configuration without installing Tailwind or
rebuilding the frontend. This supplies branding and visual customization; full
component source customization remains a later, separate interface.

The native host reads CSS freshly in dev and copies it into static builds.
Preview serves built bytes. Theme edits do not rerun authoring, change candidate
identity or participate in exact content/evidence snapshots. The active theme
presents both Git versions. Only the configured file is copied; import and asset
resolution remain ordinary browser behavior. Default styling and override files
never provide audience access control.
