# Executable documentation consumers

This package exercises the documentation SDK as a development dependency through
two concrete consumers:

- A small configuration library and its real `config-demo` executable. Its guide
  demonstrates saving valid input, rejecting an invalid replacement without
  changing the output, and recovering after correction.
- The independently existing `serde_json` library. Its guide calls public APIs
  to parse a typed list, inspect a type mismatch, correct the input, and serialize
  the recovered values.

The second consumer is our integration of an existing library. It does not
represent adoption or approval by the `serde_json` maintainers, and it changes no
upstream repository.

Both guides are ordinary Rust programs containing multiline Markdown, typed
checked values, assertions, and captured resources. Each execution produces one
frozen document that can render into reader and contributor views. The contributor
view adds notes and private evidence to the same authored narrative.

## Run the examples

Use Rust 1.95 or later; the portable standalone gate verifies Rust 1.95.0. Keep
this package next to the SDK so the relative development dependency resolves:

```text
crates/
  lgtmd/
  doc-example-config/
```

No application renderer, graphics dependencies, service, or provider account is
required. From the `doc-example-config` directory:

```sh
cargo build --bin config-demo
cargo run --example docs -- check --audience both
cargo run --example serde_json -- check --audience both
cargo test --all-targets
cargo clippy --all-targets -- -D warnings
```

The config guide finds `config-demo` beside the built example. For a separately
built executable, set `CONFIG_DEMO_BIN` to its path. Fixture files and subprocess
working directories are isolated temporary directories. The serde_json guide
needs no subprocess or fixture directory.
The configuration guide resolves the supplied CLI path before creating fixtures
or changing the subprocess directory. A missing executable fails with a useful
error even on emulated hosts that otherwise report only a child exit status.

When a Cargo workspace supplies the lockfile, add `--locked` to these Cargo
commands. After dependencies are cached, `--offline` can verify both consumers
without network access.

For the combined SDK and consumer development gate, run
`python3 ../lgtmd/dev/verify.py`. Its standalone mode copies both packages
and these retained baselines into a temporary workspace, independently resolving
only their dependencies. See the SDK's
[development instructions](../lgtmd/README.md#develop-and-verify-the-portable-packages)
for the minimum-toolchain check, caches, and formatting scope.

## Review intentional documentation changes

Generate a candidate into a new output directory, read both views and their
resources, then update the retained baseline only when the changes are intended:

```sh
cargo run --example docs -- build --out .cache/config-review --audience both
cargo run --example serde_json -- build --out .cache/json-review --audience both

cargo run --example docs -- update --audience both
cargo run --example serde_json -- update --audience both

cargo run --example docs -- check --audience both
cargo run --example serde_json -- check --audience both
```

Choose a new candidate directory for each review; `build` preserves an existing
candidate by refusing to overwrite it. `check` is read-only. Each guide has its
own package-local baseline:

| Guide             | Authored source                                                                          | Baseline                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Configuration CLI | [Runner](examples/docs.rs) and [complete narrative and helpers](examples/support/mod.rs) | [Reader](baseline/config/reader/configure-a-port.md), [contributor](baseline/config/contributor/configure-a-port.md)             |
| Typed JSON list   | [Single example source](examples/serde_json.rs)                                          | [Reader](baseline/serde-json/reader/parse-a-typed-list.md), [contributor](baseline/serde-json/contributor/parse-a-typed-list.md) |

The configuration baseline was carried forward from the reviewed implementation
without changing its document or resource bytes. The tests check both retained
views for both consumers, repeat generation for determinism, and ensure private
contributor evidence stays out of the reader output.

## Authoring cost and boundaries

Measured after Rust formatting, including blank lines and comments:

| Consumer          |                                                       Complete executable authoring |      Tests kept in the example |
| ----------------- | ----------------------------------------------------------------------------------: | -----------------------------: |
| Configuration CLI | 241 lines: 19 runner + 222 narrative, fixture, subprocess, and capture helper lines |  0; separate integration tests |
| serde_json        |           147 lines: runner, narrative, real API calls, checks, and capture helpers | 32 additional lines; 179 total |

There are no separate Markdown templates or hidden scenario files. The complete
example source total is 420 lines including the serde_json example's tests. The
configuration application's implementation and its separate tests are additional
code, not part of those authoring counts.

The CLI consumer has more setup because it runs an executable and checks actual
filesystem effects. The library consumer calls existing APIs directly and needs
less infrastructure. This comparison demonstrates two integration shapes; it is
not a study of outside developers' onboarding effort.

`Doc::resource_code` combines resource registration and placement when they occur
together. Reused resources keep a typed handle. Captured library output retains
its original bytes and producer profile; input fixtures use a distinct producer.
The diagnostic record created by `Doc::json` belongs only to contributor notes.

The framework checks the encoded claims and retained output. These examples do
not prove that every possible input works or that every sentence is automatically
verified. Review the explanation as well as the assertions and resource changes.

## Library provenance

The serde_json example uses the pinned `serde_json` 1.0.151 dependency through
its public API. Its behavior is grounded in the library's official documentation:

- [`from_str`](https://docs.rs/serde_json/1.0.151/serde_json/fn.from_str.html)
  deserializes text into the requested Rust type and reports incompatible input.
- [`Error`](https://docs.rs/serde_json/1.0.151/serde_json/struct.Error.html)
  exposes error categories and source locations. The guide observes a `Data`
  error from a string where `u32` is expected.
- [`to_string_pretty`](https://docs.rs/serde_json/1.0.151/serde_json/fn.to_string_pretty.html)
  serializes the recovered vector into formatted JSON. The guide reparses that
  actual output and checks that the values are preserved.

All narrative and integration code in these examples is authored here. The guide
captures the library's actual error message and formatted result; no upstream
guide or example source was copied.

This package's code and documentation use the repository's MIT license, copied
verbatim into [LICENSE](LICENSE) with the original `Copyright (c) 2026 Grida`
notice. Dependency code is not vendored, and upstream dependency terms remain
unchanged.
