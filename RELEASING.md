# Releasing lgtmd

[`.github/workflows/release.yml`](.github/workflows/release.yml) prepares the Rust
crate and one npm package with both native executables. It runs only through manual `workflow_dispatch`. The default
`verify` mode builds and tests candidates without requesting registry credentials.
A `publish` run requires a new version already committed on `main`, successful
`Verify` CI for that exact commit, and human approval through the protected
`release` environment.

Reservation versions such as `0.0.0` cannot be published by this workflow. It
does not choose versions, bump manifests, create tags, or create GitHub releases.
Adding or verifying the workflow is not authorization to publish.

## One-time account setup

The GitHub `release` environment requires `softmarshmallow` as a human reviewer,
allows only the `main` branch, and disables administrator bypass. Self-review is
allowed so the sole maintainer can trigger a run and subsequently approve it.
Preparation checks that human reviewers are required, only `main` is allowed,
and administrator bypass is disabled. Publication repeats those checks and
requires this run's recorded approval from a configured reviewer. An absent or
unprotected environment fails, rather than relying on GitHub's automatic
creation of unprotected environments.

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
- `crates/lgtmd-cli/Cargo.toml`: CLI version and its `lgtmd` dependency version.
- `packages/lgtmd/package.json`: Node SDK version.
- `examples/lgtmd-web/package.json` and `examples/stay/package.json`:
  development dependency on `lgtmd`.
- `examples/review/package.json`: dependency on `lgtmd`.
- `Cargo.lock` and `package-lock.json`: regenerate using the ordinary tools.

The CLI crate, root npm workspace, and examples remain private. Only the Rust SDK and
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

The workflow builds the shared native CLI separately on macOS 15 arm64 and Ubuntu
24.04 x64. Receipts identify the source commit, version, platform, and binary hash.
An assembly job verifies both receipts and packages TypeScript output, both
executables with embedded viewer/worker assets, thin CLI launcher, license, and README into one npm archive. It also builds and verifies
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

## Verify registry delivery

A successful publish step confirms the registry accepted the upload. npm may
still be processing the package before its metadata and archive become public.
Wait for availability; do not republish an accepted version because an immediate
lookup returns 404.

- Confirm the exact version on each selected registry and the intended npm
  distribution tag. Publishing under `next` does not change `latest`.
- Download the public archives and compare their SHA-256 hashes with the
  reviewed `release-candidates/manifest.json` values.
- Run clean consumers against the published packages. Verify the npm core with
  Rust and Playwright absent, then its optional Playwright integration. Verify
  the Rust consumer resolves the exact crates.io version, rather than a local
  path or Git dependency.
- Update installation and availability documentation after publication is
  confirmed. Preserve the experimental API status and verified platform limits.

The first completed release was **0.1.0**, published to crates.io and npm's
`next` tag on October 13, 2026. Its
[release run](https://github.com/lgtmd/lgtmd/actions/runs/38416118632) exercised
both native builds, the shared npm archive, installed consumers, the protected
approval gate, OIDC publication, and npm provenance. Registry downloads matched
the reviewed archives and passed subsequent consumer checks.

Version **0.2.0** was published to crates.io and npm's `next` tag on October 14,
2026 from source `6ff4b727aaf0641771262ebb4119e21b8e70207e`. Its
[release run](https://github.com/lgtmd/lgtmd/actions/runs/38516229314) passed both
native builds and installed npm consumers before protected human approval and
OIDC publication. npm includes the docs-site CLI and embedded frontend; the
Rust crate remains the SDK library. At that release, npm's `latest` tag remained `0.0.0`.

Public downloads matched the reviewed candidate SHA-256 values:

- `lgtmd-0.2.0.crate`: `fbb5c4f032a148a6135e583ca83da5579ee77f6550a08a8b467ea4311df9dfe8`
- `lgtmd-0.2.0.tgz`: `8b3cab7eb258405b405b70792caeed5272ee6fddc62a9f4762bc2676ad921a21`

Fresh macOS arm64 consumers passed against these public packages: npm core and
CLI with Rust absent from `PATH` and Playwright not installed, followed by the
optional Playwright integration, and a Rust 1.95.0 consumer resolving exactly `lgtmd = "=0.2.0"`
from crates.io with the reviewed checksum. APIs and schema-v1 input remain
experimental; verified native targets remain macOS 15 arm64 and Ubuntu 24.04 x64.

Version **0.3.0** was published to crates.io and npm's **`latest`** tag on
October 14, 2026 from source `dfaf7c2c2d4df0f9c75be422004040e1cf66eeb6`.
The [release run](https://github.com/lgtmd/lgtmd/actions/runs/38553022571)
passed both native builds and installed consumers before the protected approval
and OIDC publication. The maintainer explicitly authorized this version selection,
`latest` publication and approval of the CI release run. npm's `next` tag remains
at `0.2.0`.

The npm viewer includes commit history in the Versions sheet and rendered
word/line text review. The source repository also includes the Git-free evergreen
showcase and expanded Stay example. The Rust crate remains the SDK library.

Public downloads matched the reviewed candidate SHA-256 values:

- `lgtmd-0.3.0.crate`: `ee5b340735ed1ab1c7f689894b9a2b452169f4110598db5b0952f2972203d806`
- `lgtmd-0.3.0.tgz`: `f477b044b8382c9ead7cadfdfbaeb1bd7e1b68728add4b5671e99a4838edd1f2`

Fresh macOS arm64 consumers passed against both public packages: npm core and
CLI with Rust and Playwright absent, followed by the optional Playwright
integration, and a Rust 1.95.0 consumer resolving exactly `lgtmd = "=0.3.0"`
from crates.io with the reviewed checksum. APIs and schema-v1 input remain
experimental; verified native targets remain macOS 15 arm64 and Ubuntu 24.04 x64.
