# Stay dogfooding feedback

This log records observed integration costs and demonstrated problems. Proposals
are not implementation or release promises.

## Guarded runner diagnostics

**Observed:** The first incomplete browser collection failed an image decode and
an unmatched control query. The guarded reporter printed test titles and outcomes;
the assertion details were in Playwright's retained `error-context.md` and trace.

**Location:** `packages/lgtmd/src/playwright/reporter.ts`, example
`.cache/playwright/` output.

**Consequence:** The failure remains honest and blocks publication, but finding
the concrete cause requires opening a second artifact.

**Workaround:** Read the original failed run's error context and trace. Keep these
paths separate from candidate exports.

**Status:** Deferred small diagnostic improvement: print the first test error and
the retained diagnostic location without dumping credentials or private fixtures.
No runner contract or success criteria need to change.

**Verification:** Both incomplete tests were rejected; no completed handoff was
written. The missing assets and query mismatches are corrected in the example.

## Application-owned state remains visible work

**Observed:** The app needs scoped session credentials, isolated workspace
provisioning, stable visible IDs/time, two browser contexts, and explicit stream
release. None is supplied by adding `withDocs`.

**Location:** `server/`, `fixtures/`, `browser/application-test.ts`, `collect.ts`.

**Consequence:** A realistic example has more fixture code than a filtering demo.
Hiding it would misrepresent adoption effort.

**Workaround:** Share the application journey and authoring between test-owned
and supplied-context collections. Put setup in project fixtures and the outer
runner, with checked cleanup before compilation or native handoff.

**Status:** Implemented example boundary; no generic SDK fixture layer proposed.

**Verification:** See `.cache/verification.json` after `just stay-test` for the
executed fixture modes, exact repeatability, drift, and negative outcomes.

## Temporary output paths on macOS

**Observed:** After four successful browser collections, the disposable A snapshot
was rejected with `Symlinks are forbidden in output paths: /var`. Node's temporary
directory used macOS's `/var` alias rather than its `/private/var` physical path.

**Location:** `verify.ts`, `storeSite("build", ...)`.

**Consequence:** Application success does not make an unsafe output destination
eligible for publication. The store correctly stopped before writing the snapshot.

**Fix:** Resolve the newly acquired temporary directory with `realpath` before
using it as the output root. Keep the SDK's path-safety policy unchanged.

**Status:** Fixed in the example. The complete acceptance gate verifies the
canonical destination and unchanged A snapshot on deliberate B drift.

## The meaning of `site_changed`

**Observed:** A/B reply candidates had different digests, changed pages and
changed image resources, but `compareSite().site_changed` was false.

**Location:** `crates/lgtmd/src/review.rs`, `packages/lgtmd/src/site.ts`.

**Consequence:** The field name can be mistaken for an aggregate content-change
verdict. It actually describes changes to the site title or navigation.

**Fix:** Clarify that existing meaning in the exported TypeScript interface. The
example asserts page/resource statuses and different digests, then requires the
exact store check to reject B. No comparison semantics or output bytes changed.

**Status:** Documentation clarified. A protocol rename or aggregate field is a
future design decision, not part of this example.

## Capture the task, not the whole desktop

**Observed:** Capturing the entire 1280-pixel inbox made conversation text small
when the image appeared in the guide's reading column.

**Location:** `browser/guides.spec.ts` image registration.

**Fix:** Capture the conversation surface for reply/error/streaming/outcome
milestones, retaining the same declared desktop viewport. Keep the full property
view where the listing and request form matter together. Full app desktop/mobile
captures remain separate review evidence.

**Status:** Fixed in the authored example; no SDK capture abstraction needed.

## Page navigation inherits the previous scroll position

**Observed:** In the actual Stay docs viewer, scroll the guest guide to its saved
reply, then choose the host guide in the sidebar. It opens partway through the
host guide instead of at its beginning.

**Location:** `packages/viewer/src/main.tsx` route handling.

**Consequence:** Readers miss the new page's introduction. This differs from
preserving position while comparing two versions of the same page.

**Status:** Fixed: different-page navigation goes
to the top; explicit section anchors remain honored; same-page diff/version,
theme and refreshed-evidence changes retain scroll. Real-browser regressions pass
at `/` and `/docs/`, including direct anchor loads and same-page reruns.

## Small-screen image detail

**Observed:** At 390 pixels, the guide prose remains readable and has no
horizontal overflow, while a desktop conversation capture shrinks enough that
its small UI text is hard to read.

**Location:** Built-in viewer image presentation, observed on the host guide.

**Workaround:** The prose names every control and explains the result; the saved
reply also appears as text. Task-surface crops improve desktop readability.

**Status:** Deferred proposal: accessible image enlargement or original-size
inspection. Do not add responsive resource protocols or a gallery framework for
this example. The existing screenshots remain overview evidence on mobile.

## Application corrections during the build

These stay in the example rather than becoming SDK responsibilities:

- A delayed guest refresh could overwrite a newer host view. The app now rejects
  stale refresh generations and invalidates them after local mutations. The
  acceptance test pauses an old response, switches roles, and releases it after
  the newer host state arrives.
- Closing a paused provider stream could wait roughly five seconds for the peer
  to drain. The server now aborts streams, stops its listener, closes owned
  connections and awaits stream finalizers. Disconnected and paused shutdowns
  pass bounded regressions without a client drain requirement.
- Restarting the service expires the old demo credentials. An explicit
  **Start a fresh demo** action recovers instead of retrying the same expired
  session. A real HTTP/browser check verifies the 401, new session and empty trips.

**Status:** Fixed and verified in the application. Backend checks pass 12/12;
focused browser acceptance and both full web gates pass. No production
authentication, persistence or generic lifecycle framework is implied.

## Retained photographic assets

**Observed:** The user preferred photo-like property imagery over the initial
vector fallback. The generated photographic treatment gives the listing cards
and property view a more practical accommodation-app appearance.

**Location:** `public/images/`, `fixtures/scenario.ts`, `public/ASSETS.md`.

**Fix:** Generate three fictional property assets once, retain local WebP bytes,
update descriptive alt text, and declare the images as flow-watch inputs. Keep
generation prompts and provenance beside the assets. Normal docs collection
does not regenerate them or call an external image service.

**Status:** Updated at the user's request. Desktop/mobile crops are inspected;
both fixture modes still repeat exactly and agree on Reader output. The new
image bytes intentionally change candidate identities. No baseline was accepted.

## Detailed filter workflow

**Observed:** The user requested fine filter interactions as a more practical
example. A draft panel exposes useful distinctions between previewing choices,
applying them, cancelling, and clearing the existing search.

**Location:** `src/filters.ts`, `src/listing-filters.tsx`,
`browser/guides.spec.ts`, `browser/acceptance.ts`.

**Fix:** Add project-owned search and filters with an inclusive budget, guest
capacity and all-selected amenities. Keep changes in a draft until applied;
preserve the external search when Reset clears panel choices. Retain applied
choices in the URL across listing navigation and reloads. A native dialog owns
modal focus and Escape, with a scrolling mobile body and visible actions.

Review caught two real edge cases: native number fields initially rejected
fractional prices accepted by the model, and partial input such as `-` looked
empty to ordinary value handling. The panel now supports fractions, reports
native invalid input, and clears that editor state on Reset or reopening. The
URL parser also accepts finite decimal exponents emitted by numeric
serialization, so very small or large price bounds survive a round trip.
Unsafe guest counts are rejected. Filtering preserves each listing's original
image tag rather than selecting a tag by its new result index.

**Status:** Implemented locally with a third Reader guide. Model regressions,
browser draft/cancel/reset, reload/back navigation, invalid input, zero-match
recovery, mobile overflow and focus checks pass. All three guides repeat exactly
within both fixture modes, and Reader output matches between modes. Filtering
adds no SDK contract, backend endpoint, availability engine or provider call.

## Guest stay-finder chat

**Observed:** The user requested a guest-facing chat for finding a stay, in
addition to the host's reply assistant. This makes follow-up preferences and
grounded recommendations another complete documentation workflow.

**Location:** `server/assistant.ts`, `src/stay-assistant.tsx`,
`browser/assistant.spec.ts` and `browser/acceptance.ts`.

**Fix:** Add **Ask Stay** to the guest menu. A scoped server conversation uses
the published AI SDK mock, a small declared preference parser and the existing
listing filter model. Follow-ups retain preferences, recommendations reference
only known listings, unsupported prompts ask for supported criteria, and real
zero matches have a recovery explanation. The app labels the interaction as a
scripted demo. History survives navigation/reload within the service lifetime;
New chat clears it without touching stay requests.

The browser checks exercise initial-load retry, failed-message draft retention,
pending-response role changes, mobile layout, and keeping the whole composer
visible after a reply. Independent review caught a minimum-price parser matching
guest counts such as **at least 3 guests**; a narrower price context and actual
conversation regressions now distinguish price, guest and night counts.

**Status:** Implemented with a fourth executable Reader guide. API/model and
browser checks pass, both fixture modes repeat exactly, and their Reader output
matches. Host reply A/B changes leave the stay-finder guide unchanged. No live
model quality, unrestricted language understanding or availability claim is made.

## Navigation fallback and release integration review

**Observed:** If a rerun removed the current docs page, the viewer could display
its fallback document at the removed page's scroll position. The navigation
effect tracked the raw hash rather than the page actually rendered.

**Fix:** Track the resolved page and disregard an anchor belonging to the
removed page. Browser regressions cover that fallback at `/` and `/docs/`, while
retaining same-page review/theme/rerun scroll preservation.

Adding Stay also exposed the release guard's exact four-workspace inventory.
The guard now checks all five workspaces and matching private example manifests
and locks. Archive tests keep example fixtures/photos out of the SDK package.
All 42 release-tool tests pass. Version selection and publication remain separate
from these integration fixes.
