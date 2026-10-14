---
name: lgtmd
description: Adopt lgtmd in a consumer project and author, run, or review code-authored documentation with executable evidence. Use for lgtmd guides, docs-site configuration, snapshots, and optional Playwright integration; not for developing the lgtmd SDK itself.
license: MIT
---

# Document a project with lgtmd

Keep explanations beside the code that produces their evidence. Start with one
useful user flow and reuse the project's application code, fixtures, assertions,
package manager, and documentation commands.

## Choose the integration

Inspect existing lgtmd dependencies, configuration, runners, and accepted output
before creating new ones. Modify the established workflow when there is one.
Keep package changes within the user's requested adoption or maintenance work.

- **Node:** use `guide`, `runGuide`, and `completeRun` for a CLI-managed docs site.
  Read the [small complete example](references/node-guide.md) for a first setup.
  The current npm package supports Node 24 ESM on macOS arm64 and Linux x64 and
  includes its native compiler; a prepared package needs no Rust installation.
  Check the installed version's API before adapting examples: these APIs remain
  experimental.
- **Rust:** retain the project's Rust runner and use the
  [Rust SDK reference](https://github.com/lgtmd/lgtmd/blob/main/crates/lgtmd/README.md).
  A CLI-managed runner finishes with `lgtmd::handoff::complete_run`. Do not add a
  Node authoring layer merely to document a Rust application.
- **Browser:** use the optional Playwright adapter only when browser behavior is
  part of the flow. Read the [Node SDK integration](https://github.com/lgtmd/lgtmd/blob/main/packages/lgtmd/README.md#playwright)
  and [complete web example](https://github.com/lgtmd/lgtmd/blob/main/examples/lgtmd-web/README.md)
  before wiring `withDocs`, `docsReporter`, and `collectPlaywright`.

## Author useful evidence

- Explain an actual user task with concrete inputs and results. Replace example
  implementations with the consumer's real functions or application operations.
- `observe` freezes a value; it does not verify a claim. Use meaningful native
  assertions inside awaited `doc.check` calls when recording named checks.
  Preserve failed checks and host errors; catching them does not create success.
- Register resources where they are produced and place their typed code, link,
  or image views in the explanation. Resource registration alone adds no prose.
  Supply the actual MIME type for images. A screenshot illustrates behavior; it
  does not assert it.
- Keep document, section, check, and resource IDs stable. Handles belong to one
  document run; capture once and reuse its frozen evidence for both audiences.
- Use contributor notes for internal explanation. Reader output removes those
  notes and exclusively private resources before delivery. It cannot remove
  secrets already captured in a public image or resource.

Your project owns preparation, services, credentials, and cleanup. A guide may
use `prepare` returning `{ context, cleanup }`; it must clean up its own partial
preparation failure. `runGuide` waits for acquired cleanup. With an existing host
runner, finish its cleanup before `completeRun`. Never manufacture the CLI's
handoff environment or receipt to bypass an incomplete run.

The Playwright adapter needs its guarded reporter and successful runner,
fixtures, teardown, and reporter completion. Use a dedicated docs configuration
with one project, `retries: 0`, `repeatEach: 1`, no shards or dependency/teardown
projects, and `docsReporter()` as the sole reporter. Preserve the application's
normal test configuration. Collect through `collectPlaywright` before calling
`completeRun`; ordinary `playwright test` does not publish documentation.

## Run, inspect, and accept separately

Use existing package scripts or the installed CLI. The
[development and recording guide](https://github.com/lgtmd/lgtmd/blob/main/docs/guide/develop-and-record.md)
documents configuration and the full workflow.

1. Run `lgtmd dev` for local authoring, or `lgtmd build` for a fresh static site.
   `completeRun` belongs inside this CLI-managed flow, after successful cleanup.
2. Read the output and inspect its actual resources. Verify the claimed behavior,
   readable explanations, and any relevant browser presentation. Compilation
   alone does not establish these outcomes.
3. Use `lgtmd update --candidate CANDIDATE_ID` only for the exact reviewed candidate
   when baseline acceptance is in the user's scope. It records without rerunning
   or committing. Never accept drift just to make a failing check pass.
4. Run `lgtmd check` for a fresh exact comparison. Investigate differing bytes,
   missing output, or execution failures. Stabilize clocks, fixtures, fonts,
   viewport, and capture environment where applicable; do not weaken comparisons.

`preview` serves built output without executing the flow. `dev --reuse` shows a
retained candidate, not a fresh verification. Generated pages, snapshots, and
resources are outputs: edit their authoring source rather than patching them.
Committing snapshots, deploying a site, and publishing a package remain separate
actions. Ordinary authoring and checks require no model calls or paid services.

Report the flow exercised, output location, checks completed, baseline changes,
and any execution or presentation that remains unverified.
