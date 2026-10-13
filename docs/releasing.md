# Release packages

`.github/workflows/release.yml` prepares the Rust crate and one npm package with
both native compilers. It runs only through manual `workflow_dispatch`. The default
`verify` mode builds and tests candidates without requesting registry credentials.
A `publish` run requires a new version already committed on `main`, successful
`Verify` CI for that exact commit, and human approval through the protected
`release` environment.

The current `0.0.0` source version is a reservation, not a release candidate. This
workflow does not choose versions, bump manifests, create tags, or create GitHub
releases. Adding or verifying the workflow is not authorization to publish.

## One-time account setup

The GitHub `release` environment requires `softmarshmallow` as a human reviewer,
allows only the `main` branch, and disables administrator bypass. Self-review is
allowed so the sole maintainer can trigger a run and subsequently approve it.
Preparation checks these rules; publication checks them again and requires this
run's recorded approval. An absent or unprotected environment fails, rather than
relying on GitHub's automatic creation of unprotected environments.

Configure the existing `lgtmd` packages' trusted publishers separately on npm and
crates.io. GitHub organization ownership does not change registry ownership.
Both names already have reservation versions, so another bootstrap publish is
unnecessary.

| Setting           | npm           | crates.io     |
| ----------------- | ------------- | ------------- |
| GitHub owner      | `lgtmd`       | `lgtmd`       |
| Repository        | `lgtmd`       | `lgtmd`       |
| Workflow filename | `release.yml` | `release.yml` |
| Environment       | `release`     | `release`     |
| Package           | `lgtmd`       | `lgtmd`       |

Use the filename alone, with matching case. The npm publisher must explicitly
allow direct publication: a staging-only publisher cannot run `npm publish`.
The GitHub environment provides the human gate for both registries; npm staged
publication is a separate mechanism that this workflow does not use.

Configure npm trust shortly before the first authorized release. npm currently
expires a new publisher configuration if its first publication does not succeed
within two days. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
and [crates.io trusted publishing](https://crates.io/docs/trusted-publishing).
These registry account settings cannot be established by committing YAML.

The publishing job alone receives `id-token: write`. npm uses a pinned OIDC-capable
CLI with provenance; crates.io uses the official `rust-lang/crates-io-auth-action`
and its short-lived, automatically revoked token. No long-lived registry secrets
or token fallback are configured.

## Prepare an explicitly chosen version

Choose and authorize the exact version separately. Update these together:

- `crates/lgtmd/Cargo.toml`: Rust SDK version.
- `crates/lgtmd-node/Cargo.toml`: bridge version and its `lgtmd` dependency version.
- `packages/lgtmd/package.json`: Node SDK version.
- `examples/lgtmd-web/package.json`: development dependency on `lgtmd`.
- `Cargo.lock` and `package-lock.json`: regenerate using the ordinary tools.

The bridge, root npm workspace, and examples remain private. Only the Rust SDK and
Node SDK are publishable. Preserve their explicit registry and repository metadata.
The source guard rejects mismatched manifests, stale locks, dirty checkouts,
reservation versions in publish mode, and versions already present in a selected
registry. Network or API errors stop the run; only an explicit registry 404 means
that a version is absent.

Run `just verify`, commit the version preparation, and let `Verify` CI pass on
`main`. Release tooling requires Python 3.11 or newer; CI pins Python 3.13.

## Prepare and review candidates

Run **Release packages** from GitHub Actions on `main` with:

- `mode`: `verify`.
- `version`: the exact committed SDK version; `0.0.0` is allowed for packaging
  verification only.
- `target`: `both`, `npm`, or `crates`; candidates include both packages regardless.
- `dist_tag`: `next` or `latest`; only a later npm publication uses this value.

The workflow builds the native bridge separately on macOS 15 arm64 and Ubuntu
24.04 x64. Receipts identify the source commit, version, platform, and binary hash.
An assembly job verifies both receipts and packages TypeScript output, both
executables, license, and README into one npm archive. It also builds and verifies
the normalized Cargo archive.

Both hosts then install **the same assembled npm archive** into clean consumers.
The core runs with Rust absent from `PATH` and Playwright absent; the optional
Playwright adapter is installed and exercised separately. The ordinary `Verify`
workflow owns real-browser replay and screenshot checks; this package check does
not substitute for them.

Review the `release-candidates` artifact and workflow summary. They contain the
`.tgz`, `.crate`, and a manifest of exact checksums, source revision, version, and
native targets. Artifacts are retained for seven days. Hash, identity, executable
permission, archive path, or inventory mismatches fail verification.

The initial binary matrix is macOS 15 arm64 and Ubuntu 24.04 x64 with glibc. Other
Linux distributions, Alpine/musl, Windows, Intel macOS, signing/notarization, and
additional architectures require their own work and verification.

## Approve and publish

Only after explicit authorization for the exact version, run the workflow again
with `mode: publish`. It prepares fresh candidates from that immutable commit and
waits at the `release` environment after all package checks pass. Review that run's
artifacts, source revision, version, target, and npm tag before approving.

The publishing job rechecks approval, source CI, registry availability, and
artifact integrity before authentication. npm receives the verified archive
without rebuilding it. Cargo publishes from the same locked source revision; the
job first repackages it and requires byte identity with the reviewed `.crate`.
Cargo performs its ordinary package verification during publication.

Use `next` for an initial or prerelease npm release unless publishing to `latest`
is explicitly intended. Prerelease suffixes do not choose npm distribution tags
automatically.

npm and crates.io are independent transactions. For `target: both`, crates.io
publishes first. If npm then fails, the crate remains published. Inspect both
registries before retrying, then request a new approved run with `target: npm`.
Do not rerun `both` blindly or attempt to replace an existing registry version.
The equivalent recovery applies to any intentionally selected registry. Never
silently ignore an already published version.
