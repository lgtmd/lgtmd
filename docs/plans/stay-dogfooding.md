# Stay example and dogfooding execution plan

Date: 2026-10-14

Status: **Completed locally on 2026-10-14 following the user's explicit GO. All required acceptance gates passed on macOS arm64; changes remain uncommitted.**

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

The preceding viewer work and reviewed own-guide output were committed at
`61c0e6e` before this session. Keep tracked-baseline acceptance separate from
repeatability; do not accept a baseline to obtain green results.

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

## 11. Execution receipt

Completed within the five-hour budget, starting from clean `main` at
`61c0e6e035b1f94c0d5df84d2770b692d0a775dd`. HEAD and the index remain unchanged.
The local [Stay example](../../examples/stay/README.md) delivers all Section 6
gates: three fictional properties with original local SVGs, responsive guest and
host interfaces, real HTTP state and scoped demo sessions, AI SDK 7.0.139 mock
streaming/failure/retry, and two natural Reader guides. Browser builds retain
complete dependency licenses. No live model or paid service is configured.

Verification passed on macOS arm64:

- `just stay-test`: 12 API/provider tests, full guest → host → guest journey,
  validation, role/ownership/isolation, idempotent acceptance, exact provider
  context, interrupted drafts, mobile panes/back/focus, stale refreshes and
  expired-session recovery.
- Two fresh A collections in each fixture mode have identical candidate IDs and
  bytes. Reader bundles and Markdown also match across modes. No fuzzy image
  tolerance or retries were used.
- B changes the documented reply and images; exact check rejects it without
  changing any A snapshot file. Assertion, fixture cleanup, outer cleanup and
  partial-setup failures reject collection. Failed host runs write no successful
  native handoff. Reader files exclude private notes, receipts and identities.
- `just doc-web-test --offline` and `just doc-web-smoke --offline`: native
  warnings-denied lint/tests, actual Chromium, source-only independence,
  installed Cargo/npm consumers, and npm execution without Rust.
- `just docs-check`: the existing tracked guide still matches candidate
  `a33ba617576ef9f7c4b89a49e61d36e3d8a4551c7a0667e3d177232537e4ef94` exactly.
- All 15 portable-harness Python tests, formatting and `git diff --check` pass.
- Desktop/mobile app and rendered-guide review is complete. Fresh final review
  screenshots reproduce the exact verified A candidate.

Exact Stay identities in this capture environment:

| Collection   | Candidate                                                          |
| ------------ | ------------------------------------------------------------------ |
| Test-owned A | `1a194ed6988ae7a3adc698a39990c98ad681aa56d856e99554366f6d669ff302` |
| Supplied A   | `c8871057788961645c843883595ac3ad52278df12bb4cf682e5aceacfc0bbd48` |
| Test-owned B | `fff7638473b87c4c4624abc8b6a0fcfd7a601cbf4d8e6a87acb024c7377ac7d8` |

The shared A Reader digest is
`7ded1e36836da5c0fff9b6ab6595f7583b246826b630fedbb3b7e77cc21cc88e`.
One overlapping preliminary standalone run was stopped before its fixed-port
browser stage; the complete final stateful gates then ran serially.

Dogfooding fixed viewer page navigation: new pages open at the top, explicit
anchors work, and same-page diff/version/theme/reruns preserve scroll. Browser
regressions pass at `/` and `/docs/`. The `site_changed` TypeScript documentation
now clarifies its existing title/navigation meaning; comparison semantics and
output bytes are unchanged. The [feedback log](../../examples/stay/feedbacks.md)
retains diagnostic and mobile image-enlargement proposals. No generic fixture
framework or new protocol was added.

Live review and restart:

- [App](http://127.0.0.1:4190/): `just stay` (API 4191).
- [Guest guide](http://127.0.0.1:4192/#/request-a-stay) and
  [host guide](http://127.0.0.1:4192/#/respond-to-a-request): `just stay-docs`.
- Verify with `just stay-test`.

Review evidence lives in `examples/stay/.cache/`: `verification.json`,
`candidates/a-test/`, `candidates/a-supplied/`, `candidates/b-test/`, and
`review/*-desktop.png` / `review/*-mobile.png`. These are fresh review candidates,
not accepted tracked baselines. Desktop capture text is still small on mobile;
the prose remains readable, and enlargement is recorded as follow-up work.

The mock tests integration, not AI quality. The in-memory service persists only
until restart; there is no payment, availability engine, production authentication
or real reservation. Linux CI was not run for these uncommitted changes. Existing
previews and tracked guides were preserved; N3 was not edited. No commit, push,
baseline acceptance, publication, release tag, workflow dispatch or paid call
occurred.

## 12. Photorealistic asset refinement

At the user's request on 2026-10-14, the original SVG fallback was replaced with
three generated photorealistic listing images. The built-in image-generation
tool created each asset once; local WebP files are now the app's retained input.
[Provenance, exact prompts and checksums](../../examples/stay/public/ASSETS.md)
distinguish generated imagery from camera photographs of real properties. This
asset-authoring step is separate from normal application and documentation runs,
which still make no model or image-service calls.

All images are 1536 × 1024; the three retained WebPs total 1,512,304 bytes.
Source PNGs and superseded SVGs remain in ignored local review storage.
Application frames, proportions and responsive layouts are unchanged. The
interactive API was restarted to load the new listing paths, resetting its
temporary demo state. The native guide preview was refreshed without accepting
any tracked baseline. Asset paths are now declared flow-watch inputs.

`just stay-test` passes with the new imagery: 12 API/provider tests, the complete
browser journey, exact repeatability in both fixture modes, cross-mode Reader
equality, A/B drift and failure integrity. All 15 portable-harness tests pass,
including byte-preserving copy of binary WebP assets. Desktop/mobile listing
and detail captures are inspected; the new browse captures are
`examples/stay/.cache/review/acceptance-explore-desktop.png` and
`acceptance-explore-mobile.png`. These asset-only changes do not require another
native compiler or installed-package gate.

The earlier Section 11 identities describe the SVG-era candidates. Current
photorealistic-image candidates are:

| Collection   | Candidate                                                          |
| ------------ | ------------------------------------------------------------------ |
| Test-owned A | `ae384c32095d77a820ac879fb6f28a3994fc03f578e9bf680e1afb4c5074b4eb` |
| Supplied A   | `01a796c079f0fe04eb67cab94db1e5a90b6b035c4799bf7b7e2e3f176690fd6d` |
| Test-owned B | `6707b2efc44a6156066618424b391dbaa21a330ed5837e277eb483099800d1c6` |

The shared A Reader digest is
`340c2818a6caebe72d6b8c5f41c92628c8bf631e597605fb710a227ad0b2a390`.
Updated review candidates remain separate from accepted baselines. No commit,
push, package publication or release is part of this refinement.

## 13. Detailed filters follow-up

The user's 2026-10-14 request for fine filter interactions adds a bounded
collection workflow to the completed milestone. Stay now has title/location
search, inclusive nightly price bounds, guest capacity and all-selected
amenities. Draft choices preview a result count, and apply/cancel/reset remain
distinct. Applied chips remove individual constraints; the URL preserves choices
across reload and listing navigation. An empty state offers recovery.

The panel uses a native dialog, Lucide icons and a short CSS transition with a
reduced-motion alternative. On mobile it becomes a sheet with a scrolling body
and visible header/actions. Browser checks cover modal keyboard focus, restored
focus and body scrolling, invalid ranges, partial native number input, Reset,
fractional prices and persistence. Review fixed native number validity and a
finite-price serialization edge; no new backend or SDK protocol was introduced.

`Find a stay with filters` is the third executable Reader guide. Both fixture
ownership modes collect it alongside the guest and host guides. Private receipt
notes remain Contributor-only. The filter document and images stay unchanged
when switching the mocked AI reply from A to B.

`just stay-test`, `just doc-web-test --offline` and
`just doc-web-smoke --offline` pass, including 12 API/provider tests, 10
filter-model tests, browser acceptance, exact repeated collections, cross-mode
Reader equality and failure integrity. All 15 portable-harness tests pass.
Desktop/mobile app captures, generated prose/resources and the live rendered
guide were inspected. The refreshed native preview matches the verified
test-owned A candidate exactly. Formatting and `git diff --check` pass.

The three-guide identities supersede Section 12:

| Collection   | Candidate                                                          |
| ------------ | ------------------------------------------------------------------ |
| Test-owned A | `e16149f2315b9e83564213ddfe1032bba93f5f1a9189de60dad04a28bb7ed8de` |
| Supplied A   | `e89831999ad7f64771e3ed71e0d3a8b3a87cae3e0288dc301ca0abb1cfb8c283` |
| Test-owned B | `f24b50be4c29cbb0a1d44e73ef8b5a5f14e1eb7f215e1dbd2bf0c1d1ea87b1fd` |

The shared A Reader digest is
`a09ce3959254ff7b2c62e5462171a486468ae42148d48d6a6bf2d93faad0dad7`.

Review the [application](http://127.0.0.1:4190/#/) and
[filter guide](http://127.0.0.1:4192/#/find-a-stay). Captures and candidates remain
under ignored `examples/stay/.cache/`. All changes remain local; HEAD, the index,
tracked own-guide baselines and N3 are unchanged.

## 14. Guest AI stay finder and delivery review

The guest menu now includes **Ask Stay**, a conversational alternative to
filtering. A project-owned HTTP conversation uses the published AI SDK mock and
the existing listing filter model. Follow-up messages retain and revise budgets,
guest counts, locations and amenities. Replies enumerate the applied criteria
and link only to known listings. Unsupported prompts ask for supported criteria;
zero matches are distinct from that clarification. **New chat** clears history
and preferences without changing stay requests. The UI identifies the scripted
demo; no live model call, availability or subjective-quality check is implied.

The fourth Reader guide, `Find a stay with AI`, moves from Cedar House to
Courtyard Loft, reaches a no-match state, and recovers to Coast Cabin by changing
the nightly budget. Native API assertions check the actual saved conversation
and listing IDs. Navigation and reload preserve it within the service lifetime.
Browser acceptance checks initial-load retry, failed-message draft retention,
pending-response role changes, mobile overflow and a visible composer after
replies. Screenshots remain lossless WebP in the declared capture environment.

Independent review fixed two issues before delivery: a minimum-price expression
could misread **at least 3 guests**, and a viewer rerun removing the current page
could retain that page's scroll position. Actual conversation and root/`/docs/`
browser regressions cover them. Release source validation now includes all five
workspaces and all private example dependency/lock versions, with archive
exclusion tests for Stay fixtures and photos. The 42 release-tool tests pass.

The four-guide candidates supersede Section 13:

| Collection   | Candidate                                                          |
| ------------ | ------------------------------------------------------------------ |
| Test-owned A | `cb6b0858f73361281c0b19d4239da1933a27ab067bd2022fd5fab9a8df91abd3` |
| Supplied A   | `54e3ebc34fd19f31678db4085c5f2aac65905b2a2a78c4ef2cf1010c15603916` |
| Test-owned B | `d0cf253194c2829506709e6844d939d8ba48642f2aca8d9a650c1402e0c934f1` |

The shared A Reader digest is
`de66d5cb2b582352f6d773ff4c5f1b428b7d155a266eda1c8ac046937021ebca`.
All four guides repeat exactly within each fixture mode, and Reader output
matches across modes. A/B host reply changes leave the stay-finder guide
unchanged. Reader privacy and failed-run/cleanup handoff checks pass.

Review [Ask Stay](http://127.0.0.1:4190/#/assistant) and its
[guide](http://127.0.0.1:4192/#/find-with-ai). The application service was
restarted to load the new endpoints, clearing its temporary demo state.
The local and source-only web gates pass, including all 23 API/provider tests,
10 filter-model tests and the rebuilt viewer's fallback regression at both
base paths. Formatting and the 42 release-tool tests pass. Publication still follows the exact-version
and protected-run approval process in [RELEASING.md](../../RELEASING.md).
