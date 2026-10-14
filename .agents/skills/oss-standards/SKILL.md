---
name: oss-standards
description: >
  Review lgtmd repository changes for public readiness before a commit, push,
  or pull request. Check disclosure, reader context, scope, evidence, and
  accurate claims beyond the mechanical checks in CI.
license: Apache-2.0
metadata:
  internal: true
---

# OSS standards for lgtmd

Modified and adapted for lgtmd from Grida's
[oss-standards skill](https://github.com/gridaco/grida/blob/c82c990545f0843fa3db2b2d205a00076dcb5734/.agents/skills/oss-standards/SKILL.md).
The upstream Apache-2.0 license is retained in [LICENSE](LICENSE); adaptation
details are in [NOTICE](NOTICE).

Use this as a focused review pass alongside [AGENTS.md](../../../AGENTS.md) and
[CONTRIBUTING.md](../../../CONTRIBUTING.md). It does not grant permission to
commit, push, publish, accept evidence, or expand the task.

## Public artifacts

Treat source, fixtures, screenshots, commit messages, issue bodies, and PR
descriptions as material an unfamiliar reader may see. `wg/` is internal in
purpose, not private in visibility.

- Inspect the actual diff and intended attachments for credentials, private
  data, account identifiers, internal URLs, and machine-specific paths. Use
  synthetic fixtures and portable examples. Avoid printing discovered secrets.
- A branch push exposes its contents before merge. If a credential was already
  exposed, removing it from the latest diff is insufficient; report the exposure
  and need for revocation or rotation through an authorized channel.
- Preserve license notices and provenance for copied or adapted material.
- Local edits, commits, pushes, release tags, and package publication remain
  distinct actions. A push is not release authorization. Follow
  [RELEASING.md](../../../RELEASING.md) for release work.

## Scope and contracts

- Make the change understandable through a complete example, including required
  setup and cleanup. Avoid new public helpers or abstractions without a concrete
  use in the agreed scope.
- Keep unrelated work out of the proposed change. Preserve existing user work;
  do not split, rebase, or discard it without appropriate scope and authorization.
- Public APIs and compiler input are experimental, but compatibility changes
  still need explicit review and meaningful regressions. Do not invent a stable
  support promise or treat experimental status as permission for accidental drift.
- Explain bug fixes with the observed failure, its cause, and the check that
  demonstrates the corrected behavior. Do not describe passing compilation as
  successful host execution or visual acceptance.

## Documentation and evidence

Identify the intended reader before writing. Use [REPOSITORY.md](../../../REPOSITORY.md)
to find the canonical home rather than copying another layout or explanation.

- Keep the root README short and useful to prospective users. Put user narrative
  in `docs/authoring/`, API contracts beside the SDK, and engineering rationale,
  proposals, and development guidance in `wg/`.
- Explain claims without private conversation context. Use tracked relative
  links or accessible source permalinks, not local checkout paths or scratch files.
- Separate implemented behavior, proposals, and release availability. A plan,
  issue, accepted proposal, or passing test is not implementation or release proof.
- Review generated prose and resources at their owning workflow. Never hand-edit
  `docs/guide/`, `docs/snapshots/reader/`, or retained consumer baselines to make
  checks pass. Investigate drift before explicitly accepting intentional evidence.
- Inspect Reader exports for contributor-only prose, resources, and private
  metadata. Hidden viewer elements do not establish audience isolation.
- Keep individual follow-up work in GitHub Issues and epic outcomes in
  [TODO.md](../../../TODO.md). Replace personal shorthand with enough context for
  another contributor; creating an issue still requires task authorization.

## Final review and handoff

For every changed artifact, assess whether a reader can understand its purpose,
status, and evidence without this chat. Clarify missing context within the task.
Remove only task-owned disposable material or otherwise authorized removals;
confusion alone is not permission to delete existing files or retained evidence.

Run the relevant checks from [CONTRIBUTING.md](../../../CONTRIBUTING.md) and the
[development guide](../../../wg/development.md). State completed checks and
their limits; do not silently skip unavailable checks or manufacture acceptance.

Write commit messages and PR descriptions around the concrete problem, resulting
behavior, relevant verification, and remaining limitations. Keep reported states
precise: edited, committed, pushed, merged, and released mean different things.
