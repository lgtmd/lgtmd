# Canonical viewer showcase

From a prepared checkout, run `just docs-demo`. No Git history, application
server, browser capture or external service is needed at launch. The command
validates the retained Original/Revised bundles, compares them with the public
Rust-backed SDK, assembles the prepared shared viewer, and serves it through the
native `lgtmd preview` command. It prints its URL and owns only a temporary build;
Ctrl-C stops preview and removes that build.

```sh
just setup
just docs-demo
just docs-demo --port 4194 --audience reader
```

The default Contributor audience contains intentionally public sample notes.
Reader output is filtered before serving, including both comparison versions.
Versions names the two fixtures honestly: no commit hashes, fake dates, history
requests or disabled live-run controls. This is a fixed pair, not a new general
revision-provider API. A static build can also be produced with `buildShowcase`
from `build.mjs`; the same files can be served under a declared base path.

## Pages

| Page                        | Demonstrates                                                     |
| --------------------------- | ---------------------------------------------------------------- |
| Start here                  | How to use the viewer and fixture boundaries                     |
| Text and code               | Words, a typo, Unicode, code lines and an inserted paragraph     |
| A full page                 | Meaningful changes across a complete desktop application surface |
| Four pixels                 | Exactly four changed pixels in otherwise identical captures      |
| Different dimensions        | Side-by-side fallback and an explicit alignment explanation      |
| Structured content          | Tables, lists, changed link URLs, indentation and repeated prose |
| Contributor notes           | Attached comments and note-only changes                          |
| Nothing changed             | Identical content and identical retained image bytes             |
| A new page / A retired page | Added/removed pages and explicit missing-side views              |

All screenshots capture the entire page at 1280px or 1100px width and 885px
content height (800px viewport height). None is a component crop. The dashboard
is an original deterministic HTML fixture, with no remote assets, fonts, time,
randomness or model calls. Capture profiles record the viewport and encoder.

## Maintain and verify

Edit `author.mjs` for documentation and `capture-page.mjs` for the captured app
surface. Never edit `snapshots/` manually. With the pinned development browser
and Sharp installed:

```sh
node examples/review/showcase/generate.mjs --record
node examples/review/showcase/generate.mjs --check
node examples/review/showcase/verify.mjs
```

Recording explicitly replaces this example's retained Reader and Contributor
snapshots. Review the source, prose and screenshots first. Generation verifies
repeatable full-page PNG captures, lossless WebP pixel preservation, and the
four-pixel fixture. Exact regeneration is capture-environment-specific; the
retained showcase itself works independently of that environment. The recorded
captures were produced on macOS arm64 with Playwright 1.64.0 and the profile's
pinned Sharp/libwebp. Normal launch never regenerates or accepts snapshots.

`verify.mjs` exercises the real native preview with Git absent from PATH, both
audiences, the shared text/image controls, pixel count, fallback states, dark
mode, narrow layout and a deployment subpath. Existing Git integration remains
separate: `just docs-git-demo` uses `../fixture.mjs` and disposable real history.
