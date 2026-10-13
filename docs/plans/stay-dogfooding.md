# Stay example and dogfooding execution plan

Date: 2026-10-14

Status: **Deferred at the user's request; plan retained and example implementation has not started.**

This plan fixes the ordinary implementation choices for a five-hour work session.
The main deliverable is a polished accommodation-request example and its useful,
executable documentation. It also permits bounded corrections to demonstrated
lgtmd problems. Work remains local; the session does not include commits,
publication, release preparation, or acceptance of tracked documentation baselines.

## 1. Definition of done

Build `examples/stay/`, named **Stay**, with original branding and fictional
content. Use Airbnb's guest/host concepts as an interaction reference. Its host
inbox also covers the AI-assisted reply workflow considered for a separate
Intercom-style example. Only this one application is required.

A guest opens a property, chooses dates and a guest count, and submits a request
with a message. A host reads that request, generates a scripted AI reply, edits
and sends it, and accepts the request. The guest reloads and sees the saved reply
and accepted status. Both interfaces use the same real local HTTP service.

Completion requires a working browser demonstration, readable guest and host
guides, deterministic evidence, meaningful negative checks, and successful
standalone verification. A screenshot or passing build alone is insufficient.
The five hours are a work budget, not a reason to expand scope or conceal an
unfinished gate. Finish early if all gates pass.

## 2. Product decisions

| Area         | Fixed choice                                                                                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack        | Existing React/Vite/TypeScript versions, ordinary CSS, existing Lucide icons, Node HTTP server. No new UI framework or router dependency is needed.                           |
| Surfaces     | Listing cards and shared detail view, guest request/conversation, host inbox and request/conversation.                                                                        |
| Content      | Three seeded listings reuse one component/template. One listing drives the executable journey. Use believable names, amenities, nightly prices, and short conversations.      |
| Requests     | `pending` to `accepted`. Sending a message does not accept a request. Accepting preserves history; repeating acceptance returns the same state without another effect.        |
| Dates        | Fixed scenario dates; require a valid ordered date range and a guest count within the listing capacity. No availability, overlap, pricing, tax, or cancellation engine.       |
| Identities   | One guest and one host per isolated workspace, plus separate test actors/workspaces for access checks. Explicit demo identity selection, without a production sign-in system. |
| AI           | Server-side AI SDK mock model with scripted chunks, error-then-success behavior, and an alternate reply fixture. No live provider, credentials, or fallback model calls.      |
| Persistence  | In-memory server store. Reloads preserve state while the server runs; restart persistence is not promised.                                                                    |
| Viewports    | Desktop capture at 1280 by 900 and mobile inspection at 390 by 844. One Chromium project; change viewport within tests where needed.                                          |
| Motion       | Minimal native CSS, with reduced motion respected. Meaningful loading and error states are still visible.                                                                     |
| Out of scope | Payments, maps, live inventory, reviews, host property editing, uploads, realtime collaboration, notification delivery, React Native, and unrelated viewer refinements.       |

Use native accessible controls for dates and counts before adding custom widgets.
The desktop inbox has a conversation list and readable detail pane. Mobile uses
one pane at a time with an obvious back action. Buttons, labels, focus, spacing,
image proportions, and empty/error states receive rendered inspection.

Prefer three license-compatible accommodation photos retained locally, with
source and license attribution. Asset research is limited to 20 minutes. If
suitable assets cannot be verified, use original local SVG accommodation
illustrations with a consistent visual treatment. Never depend on remote images
or fonts during a documentation run. This fallback must still receive visual
review; broken or generic placeholder boxes are not an acceptable completion.

## 3. Application and harness boundaries

Keep the records example intact. Add the new maintained npm workspace
`@lgtmd/example-stay` under `examples/stay/`. Its browser application must not
import lgtmd. The application owns HTTP, state, sessions, fixture preparation,
provider selection, and cleanup. lgtmd receives completed documents/resources.

Suggested file ownership:

- `src/`: React views, domain types, route selection, and styles.
- `server/`: HTTP routes, workspace/session store, validation, and mock AI adapter.
- `fixtures/`: listings, actors, dates, messages, and provider scripts.
- `public/`: retained imagery and its attribution.
- `browser/`: application fixtures, shared scenario functions, and authored guides.
- `collect.ts`, `run.ts`, `verify.ts`: one collection path, native CLI handoff,
  and example acceptance checks.
- `lgtmd.config.json`: example-owned navigation, cache, static build, and snapshot paths.
- `README.md`, `feedbacks.md`: launch/integration instructions and dogfooding evidence.

The server resolves workspace and actor from opaque demo session credentials.
It scopes request/message reads and writes on the server; a client-supplied role
or request ID alone is not authorization. The host owns the seeded listings;
the guest owns their request. A guest cannot accept requests or generate a
host reply, and another workspace cannot read or mutate the conversation.
Document the demo session mechanism as a fixture convenience, not production
authentication. Session credentials must not enter prose, screenshots, or exports.

Keep the API small: list/read listings, create/list/read requests, append messages,
generate a reply stream, and accept a request. Validate the fields used by this
workflow and return actionable errors. Fixture provisioning and cleanup are
explicitly separate from ordinary application operations. No generic backend,
database, provider, or fixture framework belongs in the SDK.

Host and guest are application roles. Both have Reader guides. Contributor
notes explain fixture conditions and verification limits; audience filtering
must not substitute for application authorization.

## 4. Determinism and AI behavior

Use the AI SDK's published testing helpers at the server model boundary. Select
a compatible stable version during setup, pin it exactly in the example, and
retain no floating dependency ranges. Inspect its API and license before use.
If installation or the mock adapter is unavailable, retain the ordinary message
workflow and report the AI gate incomplete rather than silently substituting a
pretend successful integration.

The host's generated suggestion remains a draft until the host edits and sends
it. Stream failure must preserve the conversation and any existing manual draft.
Retry uses the next explicitly declared provider response. The mock records the
request so tests can verify that the selected listing and guest message reach
the provider boundary. Exact fixture text tests the integration, not AI quality.

Use a fixed application clock and stable visible domain IDs in the scenario.
Random workspace/session identifiers are permitted for isolation, but stay out
of retained content. Do not normalize arbitrary real evidence or globally patch
randomness to hide output changes.

Assert both streaming and completed states. When observing an intermediate state,
use a project-owned pause/release gate for the stream. Never rely on arbitrary
sleeps or capture a racing animation. Final screenshots wait for application
completion, local font readiness, and image decoding. Use the existing pinned
lossless WebP helper and actual image MIME/profile metadata.

Two declared provider scripts, A and B, produce different visible replies.
Changing A to B must change the expected evidence and fail exact comparison.
The host's edit appends a fixed sentence or narrowly edits the suggestion while
preserving its A/B-distinguishing text; replacing both suggestions with one
identical fixed reply would erase the intended difference.
This deliberately exercises variability without adding randomness to CI.

## 5. Documentation and fixture ownership

Write two concise end-user guides alongside the browser scenarios:

1. **Request a stay:** inspect the property, supply dates/guests/message, submit,
   and return to the conversation to read the outcome.
2. **Respond to a stay request:** read the request, attempt generation, recover
   from a scripted failure, edit and send the successful suggestion, then accept
   the request.

Organize prose around outcomes and decisions. Several assertions may support one
passage. Capture meaningful milestones, not every click. Keep test setup out of
Reader prose; preserve honest sample/demo context where readers need it.

Exercise two preparation modes through shared scenario/authoring functions:

| Mode                 | Owner and required behavior                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Test-owned lifecycle | An ordinary Playwright fixture provisions a workspace, yields its application context, and deletes it in `finally`. Deletion is asserted. `withDocs` extends that fixture without taking over the app. |
| Supplied sandbox     | The outer application runner provisions contexts and passes them to the same scenarios. Browser fixtures consume rather than acquire/delete them. The outer owner cleans up before `completeRun`.      |

Run these as separate collections with the same page IDs; do not publish duplicate
copies of the same guide. Verify both ownership paths. The shared `collectStay()`
function resolves only after its outer-owned cleanup succeeds. Both `run.ts` and
`verify.ts` await that gated function before `completeRun` or `compileSite`; no
verification path may compile documents from a failed cleanup.

Require exact repeatability within each mode and equal Reader output across
modes. Contributor notes may intentionally explain their different ownership
conditions, so cross-mode full candidate IDs need not match. Temporary
workspace/session identities must not create artificial output differences.

Add an adoption explanation in the example README showing startup, client-to-API
routing, fixture ownership, mock boundaries, local/CI commands, and the two modes.
Include short new-project and existing-project entry paths. Broad rewrites of
lgtmd's own guides are not required for this milestone; record any remaining
adoption work honestly in TODO.

## 6. Acceptance gates

| Gate                       | Required evidence                                                                                                                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guest to host to guest     | Two independent browser contexts exercise the complete journey. The host reads the guest's real submitted fields; the guest reloads and sees the edited sent reply and accepted status.                                                              |
| Validation and transitions | Invalid date order/count fails visibly; sending a reply leaves the request pending; acceptance preserves messages and is idempotent.                                                                                                                 |
| Access and isolation       | Guest host-only actions fail. A second workspace cannot read or change the request. Tests check server responses, not just hidden buttons.                                                                                                           |
| AI success and recovery    | Real local HTTP streaming uses the mock model; correct context reaches it; partial/error state cannot silently become a sent message; a scripted retry succeeds. No external provider calls occur.                                                   |
| Fixture ownership          | Both modes work; test-owned cleanup removes its workspace; supplied-context cleanup remains with the outer owner. Partial setup cleans resources it already acquired.                                                                                |
| Failure integrity          | An example-specific failing assertion and a failing cleanup reject collection/handoff. Neither produces a successful new documentation candidate. Reuse existing SDK coverage for other adapter failures.                                            |
| Repeatability              | Run two fresh complete A collections in each fixture mode. Candidate identities and bytes match within each mode; Reader output also matches across modes. Use the declared capture environment. No fuzzy image tolerance or retry-based acceptance. |
| Deliberate drift           | Compare B against a disposable A snapshot using existing `compareSite`/`storeSite` APIs. Check fails for the intended reply/document change and leaves A unchanged.                                                                                  |
| Audience boundaries        | Reader exports omit Contributor notes and exclusively private resources/metadata before delivery. Guest and host guides remain available as Reader content.                                                                                          |
| Visual and writing quality | Inspect the app and generated guides at desktop/mobile widths, including focus, overflow, streaming, errors, and final state. Save review screenshots. Every guide reads as product documentation.                                                   |
| Independent use            | The example and its verification run from the portable source copy without N3, sibling files, inherited app services, credentials, or undocumented preparation.                                                                                      |

Temporary A snapshots are test fixtures under ignored cache directories. They do
not authorize updating `docs/guide/`, `docs/snapshots/reader/`, or another tracked
baseline. Inspect drift before classifying its cause.

## 7. Integration and verification commands

Update root `package.json`/lockfile and relevant build/typecheck scripts. Update
`packages/lgtmd/dev/verify.py` in all three places: portable `SOURCES`, the exact
workspace-list validation, and the maintained example check invocation. Update
the expected manifest in `packages/lgtmd/dev/tests/test_verify.py`. Ensure the
new example's local assets and configuration are in the portable payload.

Add these proposed entry points and document their actual resulting URLs:

- `just stay`: start the interactive demo app and its API on loopback.
- `just stay-docs`: open the native docs CLI for the example configuration.
- `just stay-test`: run focused API/provider checks and complete example
  evidence/negative/repeatability verification.

Use separate ignored `.cache/` and `dist/` paths under the example. Prefer
ephemeral test ports selected by the application harness and passed explicitly
to Vite/Playwright. Interactive defaults may be 4190/4191, but must fail clearly
on collision rather than attach to or kill another server. Test app servers use
the production build; ordinary interactive development retains Vite.

Run checks in this order, fixing genuine failures before proceeding:

1. Example typecheck/build and focused API/provider tests.
2. Complete browser journey, fixture modes, negative gates, and exact repeatability.
3. Desktop/mobile app and generated-guide inspection.
4. Formatting, portable-payload Python tests, and `git diff --check`.
5. `just doc-web-test --offline` and `just doc-web-smoke --offline` after explicit
   dependency setup. These include real browser and installed native/npm consumer gates.
6. If Rust contracts are touched by a bounded fix, run the applicable Rust tests,
   warnings-denied lint, doctests, and documentation checks as repository rules require.

Today's viewer changes intentionally have unaccepted own-guide output. The
additional tracked-baseline check in `just verify` may therefore differ from
repeatability. Record its precise status separately; do not describe a baseline
mismatch as a fully passing umbrella gate or accept it to obtain green results.

Preserve explicit Cargo/npm/browser cache and target overrides. Dependency
installation must finish before parallel builds. Never run collectors sharing
one Playwright output directory concurrently. In particular, own-guide collection
and `docs-playground` both use the existing review fixture's temporary paths.

## 8. Five-hour execution budget

| Elapsed time | Work and checkpoint                                                                                                                                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:25    | Record starting Git state and existing dirty-file inventory; preserve a recoverable copy of existing edits, including untracked files, in ignored local storage. Confirm setup, freeze shared domain/API types, choose local assets, and scaffold the workspace. |
| 0:25–1:40    | Build app and API together. Complete guest request, host ordinary reply/acceptance, and guest reload with usable desktop/mobile styling.                                                                                                                         |
| 1:40–2:25    | Add server mock provider, streaming/edit/send, scripted failure/retry, and API isolation/transition checks.                                                                                                                                                      |
| 2:25–3:15    | Finish the two authored guides and both fixture modes. Connect the native docs CLI; write the adoption/launch explanation.                                                                                                                                       |
| 3:15–4:35    | Run acceptance gates and portable verification. Inspect rendering and fix reproducible defects. No new product surface begins in this window.                                                                                                                    |
| 4:35–5:00    | Resolve bounded remaining defects, review feedback/TODO, save screenshots and commands, and report exact completion and limitations.                                                                                                                             |

Parallelize after the shared API/domain contract is settled: one agent owns app
presentation, one owns API/provider/fixtures, and the lead owns integration,
guides, and verification. Each has named files; only the lead changes root
manifests, lockfile, justfile, and portable harness. Run final stateful gates
serially. No agent may broaden the product contract independently.

## 9. Autonomous decisions and scope control

Routine naming, component structure, styling within the chosen product reference,
fixture wording, dependency pinning, and bug fixes do not need user decisions.
Use the existing project conventions and this plan as the default.

Keep the primary workflow, both roles, real HTTP integration, mocked AI recovery,
natural guides, and evidence integrity as mandatory. Every Section 6 gate remains
required, including both fixture modes, A/B drift, and portable verification.
Drop enhancements first:
search/filtering beyond the small listing set, extra listing content, inbox
counters, response variants beyond required A/B and failure/retry, cancellation,
keyboard shortcuts, and
visual embellishment. Do not drop a failed mandatory check or disguise an
unimplemented step as successful evidence.

Limit lgtmd product fixes to 45 minutes total within the budget. Each must have a
reproduction from this example, a narrow correction, and appropriate regression
verification. Preserve existing public contracts and output bytes unless a
demonstrated existing-behavior bug requires a separately explained correction.
New protocol/resource primitives, generalized adapters, text diff, component
replacement, and ambiguous API designs go into `feedbacks.md` and TODO.

The feedback log records encountered friction, source location, consequence,
workaround, fixed/deferred status, and verification. Keep workaround costs visible.
Do not invent findings or erase resolved ones. If a foundational blocker cannot
be repaired within the boundary, complete independent deliverables and report
the exact failed gate without requesting a design decision during the session.

Preserve today's viewer work and the user's running previews. No reset, staging,
commit, push, tracked-baseline acceptance, registry publication, release tag,
workflow dispatch, paid service, or real external message is included.

## 10. Morning handoff

Provide working local app/docs links, commands to restart and verify them, and
desktop/mobile screenshots. Identify the example sources, guide candidates, and
feedback log. Report passed checks, any failed or unrun gate, exact repeatability
results, and important limits of the mocks and in-memory service. State which
existing lgtmd issues were fixed and which need a later decision. Keep generated
candidate output separate from accepted baselines.

References: [existing web example](../../examples/lgtmd-web/README.md),
[Node authoring and Playwright contracts](../../packages/lgtmd/README.md),
[architecture](../architecture/executable-documents.md),
[AI SDK testing](https://ai-sdk.dev/docs/ai-sdk-core/testing), and
[Airbnb host/guest messaging reference](https://www.airbnb.com/help/topic/1664).
