# lgtmd

Author a document while executing the behavior it explains. Ordinary Rust code
supplies the actions and checks; the document collects prose, frozen observations,
resources, and contributor notes. The same completed document can produce Reader
and Contributor exports without executing the application again.

This package is maintained in the standalone lgtmd repository, with independent
Rust and web consumers. Its API and manifest are experimental. It does not depend
on N3, egui, wgpu, a renderer, an agent skill, or a documentation website.

## Start with an executable paragraph

The example below is also a Rust documentation test. It needs only this crate:

```rust
use lgtmd::{Audience, Doc, Document};

let mut doc = Doc::new("trim-text", "Trim surrounding whitespace")?;
doc.heading(2, "Normalize a string")?;

let normalized = "  hello\n".trim();
let result = doc.expect_eq("trimmed-value", normalized, "hello")?;
doc.paragraph(("Trimming the input produces ", &result, "."))?;

let output = doc.text_code("output", normalized, "text")?;
doc.note_on(&output, "The fixture includes spaces and a trailing newline.")?;

let document = doc.finish()?;
let reader = Document::render_many(std::slice::from_ref(&document), Audience::Reader)?;
let contributor = Document::render_many(&[document], Audience::Contributor)?;
assert_eq!(reader["assets/trim-text/output.txt"], b"hello");
assert!(!String::from_utf8_lossy(&reader["trim-text.md"]).contains("fixture"));
assert!(String::from_utf8_lossy(&contributor["trim-text.md"]).contains("fixture"));
# Ok::<(), String>(())
```

Add a published version as a development dependency:

```sh
cargo add --dev lgtmd@0.1.0
```

Source consumers can use a local path instead. A standalone copy of this directory
retains explicit Cargo dependency versions, this README, tests, and its license;
no workspace-inherited package fields are required.

## Authoring and evidence

- `heading`, `paragraph`, and `markdown` append document blocks. Paragraph tuples
  combine literal text with typed references without a separate template or
  placeholder registry. Plain paragraph text is escaped, while `markdown` accepts
  CommonMark with tables and strikethrough.
- `heading_with_id(id, level, text)` assigns a stable section anchor when that
  section needs durable references. `Block::link(label)` gives those references
  reader-facing labels; the returned block also accepts attached notes. Named
  sections share the checked evidence namespace, so collisions fail explicitly.
- `markdown_parts` combines authored Markdown with typed references and preserves
  the supplied whitespace, including the absence of a trailing newline. Use it
  when an existing document needs exact composition. `binding` freezes a host's
  observed text, code label, or key sequence; its typed handle emits escaped text,
  `<code>`, or `<kbd>` markup. The host must validate control witnesses and
  canonical key mappings. A binding is not a behavioral assertion.
- `expect_eq(id, actual, expected)` executes an equality check and freezes its
  serialized observation. Its returned value handle can appear in prose.
  `require(id, condition)` records a predicate check. Meaningful checks remain the
  author's responsibility; the framework cannot prove arbitrary prose.
- `observe(id, value)` freezes a serialized value without recording a check.
  Its `Observed<T>` handle supports the same prose and note targets as checked
  values. Explanation-only and observation-only documents are valid; successful
  completion does not imply their prose was verified.
- `resource(id, artifact)` registers owned bytes. `code` or `embed` places an
  existing resource. `resource_code` registers and places text while retaining its
  custom MIME, producer and comparison profile. The same handle can be reused in
  prose, placed again, or annotated without rerunning its producer.
  `Resource::image(alt)` and `Resource::link(label)` provide inline views;
  `Resource::code(language)` places text/JSON within `markdown_parts`, occupying
  its own blank-line-separated block. Code views cannot nest in code syntax or notes.
  image views require a declared image MIME type. `resource_at` preserves an
  existing safe artifact path, while complete exports reject duplicate owners
  across documents and generated pages.
- `text`, `json`, `text_code`, and `json_code` are conveniences for the built-in
  UTF-8 and deterministic JSON encoders. Their producer labels identify those
  encoders. Use `Artifact::new` or `Artifact::from_file` when application or external
  producer attribution matters. File bytes are read immediately, not at export.
- `note` appends contributor commentary; `note_on` attaches it to a block, check,
  checked value, or resource. Notes have their own block counter, so adding notes
  cannot renumber reader blocks. Reader exports omit notes, their exclusive
  resources, and their relations and producer profiles.

Handles belong to one document run. Duplicate evidence IDs, foreign handles,
wrong text types, unreferenced resources, and failed checks fail explicitly.
Ignoring a failed builder operation does not make the document valid: it remains
tainted and `finish()` rejects it. Checks are optional, and recorded checks must
succeed. Public block IDs are currently positional; inserting public
content can change later block anchors. Check and resource IDs are author-owned.

The built-in encoder IDs remain `executable-docs/text` and `executable-docs/json`
for compatibility with retained evidence receipts. These serialized producer IDs
are independent of the `lgtmd` package and Rust import name.

`finish()` freezes and validates the authored document independently of its future
file layout. Export then validates resource use, page and artifact paths, local
links, and the complete selected audience. A finished document alone is not a
publishable bundle; every export performs those remaining checks before returning
bytes, and the runner prepares every requested export before publication begins.

## Shared compiler and Node authoring

[`transport`](src/transport.rs) exposes schema-v1 frozen document input and a
coarse `compile(input, layout)` operation returning both audience exports.
`Input::from_documents` and `Input::thaw` preserve native document semantics,
including literal Markdown, typed parts, observations, checks, bindings, and owned
resource bytes. Process-local handle owners are never serialized. This input is
an interoperability contract, separate from the inventory manifest and a future
viewer format. Unknown fields, unsupported versions, invalid identities and
references, failed checks, and invalid resource paths fail explicitly.

Portable JSON accepts null, booleans, strings, finite numbers, arrays and objects;
integers must fit JavaScript's safe range. JavaScript rejects unsupported values
before freezing, including undefined, cycles, getters, nonplain objects, negative
zero, and nonfinite numbers. Native Rust authoring retains serde_json's existing
serialization behavior (including normalization of nonfinite floats to null);
the transport cannot recover information already normalized by a serializer.
The built-in JSON resource encoder is shared Rust code, including for frozen
Node JSON values; integer-like object keys and fractional numbers have the same
encoding from the same portable input. Custom producers own their byte encoding.

The [Node SDK](../../packages/lgtmd/README.md) offers TypeScript tagged
Markdown, optional native assertions, async preparation/cleanup, and an optional
Playwright adapter. Its thin native bridge uses this compiler and the existing
Rust runner/store. The [web example](../../examples/lgtmd-web/README.md) supplies
three complete documents without application-specific engine behavior.

For readable inline sentences, the optional named form of `prose!` keeps the
text together and inserts typed handles. It returns a result because missing,
duplicate, unused, or malformed bindings fail rather than silently dropping text
or evidence. Use `{{` and `}}` for literal braces; format specifiers are not
supported. Each binding expression runs once, even when its name appears more
than once. This composition lives in the scenario, without a separate template.

```rust
use lgtmd::{prose, Doc};

let mut doc = Doc::new("retry", "Retry an operation")?;
let section = doc.heading_with_id("retry-limit", 2, "Choose a retry limit")?;
let count = doc.expect_eq("attempts", 3, 3)?;
doc.paragraph(prose!("The operation takes {count} attempts.", count = &count)?)?;
doc.paragraph(("See ", section.link("the retry limit"), "."))?;
doc.note_on(&section, "Keep the section ID when moving this explanation.")?;
let document = doc.finish()?;
# Ok::<(), String>(())
```

The expression-list form of `prose!` accepts any number of ordinary Rust
expressions and works with `paragraph`, `markdown_parts`, and notes. Tuples remain
convenient for shorter sequences. Prefer ordinary blocks for new documents;
`markdown_parts` preserves exact Markdown bytes for an existing host format.

```rust
use lgtmd::{prose, Doc};

let mut doc = Doc::new("retry-limit", "Retry limit")?;
let count = doc.expect_eq("attempts", 3, 3)?;
doc.markdown_parts(prose!["The operation takes **", &count, "** attempts.\n"])?;
let document = doc.finish()?;
# Ok::<(), String>(())
```

Markdown references are parsed with `pulldown-cmark`, including reference-style
links, escaping, inline code and fenced code. Definitions resolve within each
`markdown` or `markdown_parts` block. Literal raw HTML and unresolved references
fail; typed code/key bindings generate only their escaped, predefined HTML.
The completed page is parsed again: generated tags must remain tags, authored
HTML must remain excluded, and code fences or other containers must not swallow
later document blocks. Place captured code with `code`/`resource_code`; do not
wrap typed bindings in Markdown code delimiters. Typed artifact destinations are
URL-encoded without changing their owned filesystem names.
Local links must resolve
within the actual audience's exported bundle; fragments refer to generated block
IDs, not downstream website heading slugs. HTTP(S) and `mailto:` links are allowed
without checking remote availability. An artifact's declared MIME type does not
validate its binary contents, and producer metadata is attribution rather than
cryptographic proof of origin.

JSON resources and frozen equality observations recursively sort object keys,
including when a consumer enables `serde_json/preserve_order`. Array order is
preserved. Final manifests use the same canonical object ordering.

## Exports, comparison and publication

`Document::render_many` returns a sorted map of relative paths to bytes: Markdown
pages, resources under `assets/<document>/<resource>.<extension>`, and
`manifest.json`. It freezes no additional application state and performs no
filesystem publication. The package's small `runner` module accepts a generation
callback and exposes `check`, `build --out PATH`, and `update`, with Reader,
Contributor, or both audiences. The `store` module owns those filesystem effects.

### Configure your project's layout

The SDK does not discover a repository, read Cargo metadata, or prescribe where
document functions, fixtures, skills, or application binaries live. Your callback
supplies completed documents. Configure export paths separately from authoring:

```rust,no_run
use lgtmd::{Audience, Doc, ExportLayout, runner::RunnerConfig};
# let project_root = std::env::current_dir().unwrap();

let layout = ExportLayout::default()
    .pages_under("reference")?
    .resources_under("downloads")?
    .page("setup", "manual/getting-started/index.md")?;

let config = RunnerConfig::new(&project_root)?
    .output(Audience::Reader, "website/generated", "public")?
    .output(Audience::Contributor, "review/evidence", "internal")?
    .layout(layout);

lgtmd::runner::run_cli_with(std::env::args().skip(1), &config, || {
    let mut doc = Doc::new("setup", "Set up the application")?;
    let value = doc.expect_eq("trimmed", "  ready ".trim(), "ready")?;
    doc.paragraph(("The normalized value is ", &value, "."))?;
    Ok(vec![doc.finish()?])
})?;
# Ok::<(), String>(())
```

`project_root` is a path chosen by your host. `RunnerConfig::new` captures that
base once; relative baseline paths and CLI `--out` paths resolve against it.
Absolute destinations may be outside the project. The base need not contain a
Cargo manifest or Git repository, and the runner never changes the working
directory. Fixture paths and process working directories remain the callback's
responsibility.

Each `output` selects an audience, its retained baseline, and its relative
directory inside a fresh build destination. In this example, `update` writes
`website/generated` and `review/evidence` beneath the chosen base;
`build --out candidate` writes `candidate/public` and `candidate/internal`.
An empty build directory name exports a single selected audience directly at
the build root. Configured CLI runs select all configured audiences by default;
`default_audiences` or `--audience` can narrow that selection. Call
`runner::run(&config, RunMode::Check, &[Audience::Reader], generate)` to integrate
with a test, build tool, or your own CLI parser. The convenience `run_cli` keeps
its original `reader`/`contributor` directories and reader-only default.

`pages_under` and `resources_under` accept an empty prefix for the bundle root.
Per-document `page` overrides are exact bundle-relative paths; they do not inherit
the page prefix. `Doc::resource_at` paths are also exact and do not inherit the
resource prefix. Page contents remain Markdown regardless of the chosen filename.
Typed resource links are calculated relative to the actual page location.
Authored Markdown links use that same page-relative convention: `..` may reach
another location within the bundle but cannot escape it. Missing targets, unknown
page overrides, duplicate paths, and file/directory collisions fail, including
collisions with contributor-only resources.

For in-memory integration, use `Document::render_many_with(documents, audience,
&layout)` or `document.render_with(audience, &layout)`. No filesystem runner is
required. The configurable layout belongs to full exports; fragment adapters keep
their existing explicit resource paths and host-owned page assembly.

The [configured example](examples/configured.rs) demonstrates host-owned fixtures,
external baselines, nested pages, renamed audience directories, and private
resources. Its positional arguments are `PROJECT_ROOT BASELINE_ROOT`, followed by
the standard SDK commands. The fixture convention in that example belongs to its
host, not the framework.

Configuration does not weaken the evidence contract. The manifest filename
`manifest.json`, store metadata `.ownership.json`, audience rules, exact comparison,
and path-safety checks remain fixed. Retained audience trees must be separate, and
build output must not overlap any configured baseline. Moving an owned page is an
explicit retirement of its previous path, not silent deletion.
Each output also reserves adjacent `.NAME.lock`, `.NAME.staging`, and
`.NAME.backup` paths. The runner rejects configurations that place another output
inside those transaction paths before generation, including fresh build roots.
Artifact inventory keys always use `/`, independently of host path separators.

Before creating audience trees, the runner also rejects paths that could alias on
a case-insensitive or Unicode-normalizing filesystem. Existing directories are
compared by filesystem identity. Where separation depends on missing directory
names, use distinct ASCII names such as `public` and `internal`; case alone is not
a distinction. Unicode roots and suffixes are supported, but if Unicode names are
the only distinction, create the separate directories first so their identities
can be checked. Missing names ending in dots or spaces, or containing `~`, also
cannot establish separation because some filesystems treat them as aliases.
This conservative preflight is read-only and does not guess the
filesystem's normalization policy. It builds on `lifecycle::ensure_separate_paths`,
which checks ancestry and existing directory identities. These checks assume a
cooperative filesystem; they do not reserve paths against another process changing
them after preflight.

Checking compares the complete owned tree without writing. Building requires a
fresh destination separate from the retained baseline. Updating is explicit and
stages the complete candidate before replacing a compatible owned destination.
Ordinary publication failures preserve or restore a backup; this is not a
crash-atomic transaction. Multiple audiences publish independently. A successful
update records candidate bytes; it does not establish human review or approve a
release. Sites, navigation, styling, review policy, and application drivers belong
to each consumer.

An existing host can use `Document::render_fragment` to retain its page title,
artifact paths and formatting. A fragment adds no title or block anchors, and
rejects typed block links that would point to omitted anchors. The host owns
whole-bundle link validation for that export. Handle ownership, image kinds,
resource accounting, and audience exclusions still apply. This adapter seam
does not weaken ordinary `render_many` bundle checking.
`Document::resource_files(audience)` returns only that audience's frozen resource
paths and bytes, without a page or manifest. Fragment adapters must apply the same
audience to both text and copied files so contributor-only resources stay private.

The lower-level `lifecycle` module shares preparation, complete tree comparison,
path validation, staging, publication, and recovery with hosts that retain their
own manifest format. `Ownership::Dedicated` adds no metadata to a host-owned tree
and refuses unowned preexisting files; `Ownership::Recorded` retains explicit
ownership metadata for SDK exports. Host compatibility rules are explicit
callbacks. The structured `store` wrapper validates the SDK schema, identities,
references, complete artifact inventory, byte lengths and hashes, audience, and
producer/profile metadata before publication. Checks and recovery also validate
the retained tree. Updating permits an explicitly removed obsolete artifact only
when the complete candidate also omits that path; retained bytes must still match
their receipt. The generic lifecycle does not interpret application evidence or
claim that every byte is reproducible across different environments.

Manifest schema version 1 records:

| Field                        | Meaning                                                                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema_version`, `audience` | Interpretation and visibility policy for this export.                                                                                                      |
| `profiles`                   | Sorted producer/profile pairs for exported resources.                                                                                                      |
| `documents`                  | Document IDs, titles, visible block IDs and reference relations, executed checks, and any visible typed bindings.                                          |
| `artifacts`                  | Every exported page and resource except the manifest itself, including byte length and SHA-256; resources also identify owner, MIME, producer and profile. |

Check records contain their ID, kind, and passed status. Contributor records also
contain observed and expected values. Reader records include those payloads only
when a public typed reference uses the value; check IDs and status are still
public. Treat evidence IDs as public metadata. Profiles describe the producer's
comparison conditions and must be chosen honestly by the adapter; they are not a
complete environment fingerprint. The manifest contains no run timestamp,
absolute source path, or process ID. Full tree comparison checks the manifest's
bytes as well as artifact bytes; a manifest cannot contain its own final hash.

The initial schema is not a cross-language execution protocol or a promised
long-term compatibility standard. See the source and tests for its current
failure semantics. No crate release, registry publication, or repository split is
implied by this maintained local package.

### Review exported documents

The `preview` example renders a valid SDK export into a new disposable HTML tree.
It validates the source's complete receipt and ownership, then uses artifact
identities to convert pages, resolve page links, and preserve download bytes.
Custom page extensions work; a Markdown resource remains a download. Tables and
strikethrough use the same options as compilation. Page/resource output collisions
fail before writing. Reader previews contain only Reader-exported resources.

After generating the [consumer example's candidate](../doc-example-config/README.md#review-intentional-documentation-changes),
run from this package directory:

```sh
cargo run --example preview -- ../doc-example-config/.cache/config-review/reader .cache/config-reader-preview
cargo run --example preview -- ../doc-example-config/.cache/config-review/contributor .cache/config-contributor-preview
```

Open the resulting HTML pages in a browser and inspect both audiences and their
resources before explicitly accepting a baseline. The preview requires a new
destination and omits receipt metadata because its HTML differs from the exported
Markdown. It does not update the export or accept a baseline.

## Develop and verify the portable packages

From this package directory, run the package-owned GPU-free gate:

```sh
python3 dev/verify.py
python3 dev/verify.py --standalone --toolchain 1.95.0 --offline
```

The first command uses the containing workspace's existing lockfile and host
toolchain. It checks Rust formatting for only the SDK and consumer packages,
warnings-denied Clippy, all targets including examples and exact Reader/Contributor
baselines, both packages' doctests, and warnings-denied API documentation. It also
runs the development harness's Python regressions. Python 3 and Rust with rustfmt
and Clippy are required; no N3 setup command or graphics adapter is involved.
The repository's `just doc-framework-test` invokes this same gate.

The standalone command copies both sibling packages, tests, examples, baselines,
and license notices into a disposable minimal workspace. It resolves a temporary
lockfile independently of the containing workspace's lockfile and dependencies, then
runs the same gate on the explicitly selected installed toolchain. Rust 1.95.0
is the declared and verified minimum. `just doc-framework-smoke --offline` runs
this check from the repository root. Omit `--offline` to allow dependency resolution when caches
are cold. Temporary resolution can select different compatible transitive
versions from the repository lockfile; the temporary lockfile is deleted with its workspace.

Explicit `CARGO_HOME`, `CARGO_TARGET_DIR`, and offline environment settings are
preserved. Relative cache paths retain their meaning from the invocation directory
when checks change their working directory; absolute paths and empty overrides
are passed through. Without a target override, standalone builds reuse the ignored
package-local `.cache/standalone-target` directory. Omitting `--toolchain` uses
the installed Cargo toolchain selected in the temporary workspace; it does not
inherit the repository's toolchain pin.

Authored documentation consists of the two package READMEs and Rust documentation
comments. Rust formatting belongs to this gate. The authored READMEs use
`just fmt`; the Rust-only portable gate adds no Node.js requirement. Generated example
baselines, guide pages, manifests, and resources are excluded from prose
formatting and change only through explicit candidate review and baseline update.
This independent repository retains both packages and their development harness.

## License and provenance

The package originates in N3's executable documentation harness and its local
framework experiment. Its MIT license was preserved on extraction and is included
verbatim in the packaged `LICENSE` file so a standalone copy retains its notice.
The notice retains `Copyright (c) 2026 Grida`. Dependency licenses remain those of
their respective packages; no dependency code is vendored here.
The pinned direct dependency manifests declare MIT for `pulldown-cmark`,
`Unlicense/MIT` for `same-file`, and
MIT OR Apache-2.0 for `serde`, `serde_json`, `sha2`, and the `tempfile` development
dependency. This records the current source metadata rather than changing any
upstream terms.
