# Proposals and decisions

Use this directory for durable design questions, alternatives, and decision
rationale. [GitHub Issues](https://github.com/lgtmd/lgtmd/issues) hold feedback,
bugs, feature requests, and work tracking. A proposal can link several issues;
an issue does not need a proposal just to report a problem.

This is a record format and review aid. It does not establish a committee,
decision authority, quorum, or project priorities. Those governance choices
still need the project owner's input. A document's presence does not authorize
implementation or publication.

## Records

| Record                                   | Subject                                      |
| ---------------------------------------- | -------------------------------------------- |
| [0001](0001-native-node-bridge.md)       | Coarse native compiler/store bridge for Node |
| [0002](0002-docs-site-and-git-review.md) | Docs site and Git-backed change review       |

Existing records retain their historical context and evidence. Use the
[template](TEMPLATE.md) for new proposals, named `NNNN-short-topic.md` with the
next available number. Keep this index current.

## Preparing a proposal

Start with the problem and a complete usage example, including setup and
cleanup. Compare alternatives, including leaving the project unchanged. Explain
the smallest useful scope, what can be removed or deferred, and the maintenance
cost. Separate observed evidence from assumptions and proposed behavior.

An ordinary fix within an existing contract can use its issue and PR directly.
A durable record is useful when changing a shared boundary, introducing a new
contract, or choosing between consequential alternatives.

Keep discussion and work tracking in linked issues or PRs. Capture the resulting
reasoning here rather than copying the whole discussion. Execution details belong
in [plans](../plans/); implemented contracts belong in
[architecture](../architecture/). User instructions belong in `docs/`.

## Recording outcomes

Keep the decision status separate from delivery evidence:

| Decision status | Meaning                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| Draft           | The proposal is being developed.                                            |
| Review          | The proposal is ready for discussion; no decision is recorded.              |
| Accepted        | An explicit decision is recorded, with who decided and supporting evidence. |
| Deferred        | The decision is postponed, with a reason and conditions for revisiting.     |
| Rejected        | The proposal was declined, with a reason and conditions for revisiting.     |
| Superseded      | A linked later decision replaces this one.                                  |

Record acceptance only when there is explicit decision evidence; do not infer
agreement from silence, an implementation, or passing tests. Preserve rejected
and superseded records so later proposals can understand the tradeoffs.

Record implementation, verification, and release separately, with links and
scope. Acceptance does not mean the work is built, verified, or released, and
release evidence does not grant authorization for another release.
