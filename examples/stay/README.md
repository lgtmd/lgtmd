# Stay

Stay is a small accommodation-request application with executable guides for
finding a stay with filters or chat, sending a request, and responding as a host.
Search, detailed filters and a scripted AI stay finder narrow the collection.
A guest requests Cedar House, the host drafts and
sends a reply and accepts the request, and the guest returns to the saved
conversation. Both roles use the same local HTTP service. The application is
fictional; its original branding and generated photorealistic imagery are
independent of Airbnb.

The example demonstrates a useful boundary: React and the server own the product;
ordinary Playwright fixtures own its state; lgtmd turns the completed run into
reviewable documentation. The browser application has no lgtmd imports.

The interface uses Tailwind CSS v4 through the Vite plugin. Component utilities
live beside the JSX; shared colors, typography, and native-control defaults live
in `src/styles.css`. Existing descriptive class names remain as browser-test and
capture hooks. Keep those hooks when changing utility classes.

## Start here

Use the repository's Rust 1.95.0, Node.js 24 ESM, Python 3.11+, and just setup.
From the repository root, explicitly install the pinned dependencies, build the
native compiler and SDK, and install Chromium:

```sh
just doc-web-setup
```

Start the interactive application:

```sh
just stay
```

Open <http://127.0.0.1:4300>. The API listens at <http://127.0.0.1:4191>;
Vite proxies `/api` requests to it. Use the guest/host switch to follow the same
conversation from both sides. Each browser session gets an isolated demo
workspace. These ports must be free: startup fails on collision rather than
attaching to an unrelated service.

In another terminal, open the executable guides:

```sh
just stay-docs
```

Open <http://127.0.0.1:4192>. The native docs CLI reads
[lgtmd.config.json](lgtmd.config.json), runs the example-owned collector, and
serves its fresh candidate. It does not reuse the interactive demo's workspace or
ports. Test collections serve the production application build on an independently
selected loopback port; ordinary development keeps Vite and hot reload.

The docs-site commands used here are included in the published `lgtmd@0.2.0`
npm package. Running this maintained example still requires a source checkout.

## Adopt the pattern

For a **new project**, start with a working app and a normal browser test that
owns API startup, fixture preparation, assertions, and cleanup. Stay's
[server](server/index.ts), [fixture API client](browser/fixture-api.ts), and
[application fixture](browser/application-test.ts) show that complete shape.
Once the journey works, extend the test with `withDocs(applicationTest)` and put
short instructions and meaningful captures beside the actions that support them.
The guest and host remain application roles; both guides belong to the Reader
audience.

For an **existing project**, keep its app server, test configuration, mocks,
seeds, and lifecycle. Extend the fixture you already use with `withDocs`; replace
Stay's fixture API with your existing preparation operations. If another runner
already supplies a sandbox, pass that context through instead of provisioning
another one. Neither a database nor Stay's directory structure is an SDK
requirement. Do not move application authorization or backend orchestration into
the documentation compiler.

Stay exercises both ownership paths through the same scenarios and page IDs:

| Mode             | Preparation and cleanup owner                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test` (default) | The ordinary Playwright fixture provisions an isolated workspace, closes its browser contexts, and deletes the workspace in `finally`. It asserts that the deleted workspace and credentials no longer work. |
| `supplied`       | The outer application runner provisions the workspaces. Browser fixtures consume them and close their own contexts; the outer runner deletes the workspaces before collection succeeds.                      |

Select a path for a docs development session:

```sh
STAY_MODE=supplied just stay-docs
```

[collect.ts](collect.ts) is the common collection boundary. It resolves only
after the guarded Playwright process and outer-owned cleanup succeed.
[run.ts](run.ts) awaits it before `completeRun`; [verify.ts](verify.ts) awaits it
before `compileSite`. A successful screenshot cannot bypass failed assertions or
cleanup. Contributor notes explain each mode's fixture conditions while Reader
instructions and evidence remain the same.

## Filter a collection

Search matches stay names and locations. **Filters** opens a draft panel for an
inclusive nightly budget, guest capacity, and amenities. Stays must include every
selected amenity. The button previews the match count; only **Show stays** applies
the draft. Cancel, the close button and Escape preserve the previous results.

Applied choices have removable chips and stay in the URL across reloads and
listing navigation. **Reset** clears the panel's draft while preserving search;
**Clear all** clears both. Invalid price ranges have inline feedback, and a zero
result has a recovery action. On mobile, the panel becomes a sheet with a
scrolling body and visible actions.

[filters.ts](src/filters.ts) holds the filtering and URL rules without fixture or
SDK imports. [The filter guide](browser/guides.spec.ts) exercises these controls,
navigation, validation and recovery alongside its explanations. Filtering uses
the three supplied listings in the browser; it does not query live availability,
taxes, fees, or dates.

## Find a stay through chat

Open **Ask Stay** in the guest menu. Describe your group, nightly budget,
location or amenities, then refine those preferences in follow-up messages. The
server streams each reply through the AI SDK mock, then returns links to matching
local listings. The fixed-height chat keeps its header and composer visible while
messages scroll. Partial replies are previews; only a completed reply is saved.
A failed or interrupted stream keeps the saved conversation and your draft intact.
Leaving the chat cancels an unfinished stream.
Opening a listing and returning, or reloading the page, keeps the chat while
the service is running. **New chat** clears its history and preferences without
changing stay requests.

[The assistant](server/assistant.ts) uses the same published AI SDK mock as the
host-reply example. A deliberately small parser recognizes the demo's supported
phrases; grounded replies describe the applied criteria and return only known
listing IDs. Unsupported prompts ask for supported preferences. This is a
scripted interaction example, not a general language-understanding system or a
live availability search. The interface identifies it as a scripted demo.

[The chat guide](browser/assistant.spec.ts) follows a changing plan: Cedar House
for three guests under $200 with a kitchen, Courtyard Loft after reducing the
group and budget, no matches after adding an ocean view, and Coast Cabin after
raising the budget. Backend checks cover permissions, isolation, validation and
failed generation; browser checks cover persistence, failed-request recovery,
mobile layout and leaving the chat during a pending response.

## Make an AI workflow repeatable

[The server provider](server/provider.ts) uses the published AI SDK testing mock
`MockLanguageModelV4` from the exactly pinned `ai@7.0.139` (see the
[official testing API](https://ai-sdk.dev/docs/ai-sdk-core/testing)). No live model, provider
URL, API key, or fallback call is configured. This tests the application's
streaming and recovery behavior; it does not test generated-answer quality.

The first generation fails after partial text. The conversation and any existing
manual draft stay intact. A retry streams the declared reply, which the host can
edit before sending. Sending a message leaves the request pending; accepting it
is a separate, idempotent action.

[Scenario fixtures](fixtures/scenario.ts) own the application clock, visible
domain IDs, dates, messages, and reply scripts. Opaque workspace/session IDs are
random for isolation and stay out of retained evidence. The successful stream
pauses at a project-owned gate so the browser can assert and capture a real
intermediate state, then explicitly release it. Captures wait for completion,
local fonts, and image decoding rather than sleeping for a guessed duration.

Script `A` and script `B` produce visibly different replies. Choose the alternate
script for a separate docs development session:

```sh
STAY_SCRIPT=B just stay-docs
```

The host edit preserves the distinguishing suggestion text. Verification compares
B with a disposable A snapshot and requires an exact failure; it never normalizes
away the change or silently accepts it. A real project can use this boundary for
its own provider mocks and controlled test scenarios, while separately testing
live integrations under its own policies.

## Verify and review

From the repository root:

```sh
just stay-test
```

This builds and typechecks the app, runs API/provider and filter-model checks,
then collects all four guides. It checks conversational search and recovery,
filter draft/apply/cancel behavior, URL
persistence, keyboard focus, mobile scrolling, server-side access and workspace
isolation, validation, message and acceptance transitions, failure integrity,
both fixture modes, exact repeatability, Reader privacy, and intentional A/B
drift. Test servers and fixtures belong to that run; the interactive demo may
stay open.

The broader repository gates also exercise the maintained example:

```sh
just doc-web-test --offline
just doc-web-smoke --offline
```

Run explicit setup first. The standalone gate copies portable sources into an
independent workspace; it must not rely on N3, a sibling checkout, credentials,
or an existing app service. Honor explicit Cargo, npm, and browser cache settings.

Review all four narratives in the docs viewer and inspect the app at
desktop and mobile widths. Browser captures use 1280 by 900, Chromium, UTC,
`en-US`, light appearance, reduced motion, and the pinned lossless WebP capture
helper. Exact image bytes depend on that declared capture environment; the
example makes no cross-platform pixel-identity claim.

Generated candidates, disposable comparison snapshots, and static output live
under ignored `.cache/`; Vite writes to ignored `dist/`. A fresh candidate is not
an accepted baseline. This dogfooding example does not update the repository's
tracked own-guide snapshots. Consult the
[archived dogfooding feedback](https://github.com/lgtmd/lgtmd/issues/13) for observed
friction, fixes, deferred ideas, and verification evidence.

## Demo limits and assets

The service stores workspaces in memory: reloads retain a conversation while its
server runs; a restart clears it. Demo sessions are a fixture convenience, not
production authentication. The server resolves the actor and workspace from an
opaque credential and enforces guest/host permissions and isolation itself.
Fixture provisioning, stream control, and cleanup are separate test operations.
After a restart, choose **Start a fresh demo** to replace the expired session;
the previous conversation cannot be recovered from this in-memory service.

Dates and guest counts are validated for this request workflow. There is no
availability engine, payment, real booking, cancellation, notification delivery,
or external messaging. All identities and conversations are fictional.

Images and their [provenance](public/ASSETS.md) live in `public/`. They are local assets;
documentation runs fetch neither remote imagery nor fonts. The AI SDK is
Apache-2.0 licensed, and its mock remains a server dependency. Preserve dependency
license notices when distributing the example.
The app build retains browser dependency notices in `dist/assets/licenses.txt`,
including Lucide's ISC and inherited Feather MIT notices.
