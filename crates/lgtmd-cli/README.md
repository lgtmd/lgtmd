# lgtmd CLI

One native `lgtmd` executable owns commands, configuration, flow execution, Git review,
watching, and local serving. The frontend is compiled into the executable. npm ships
this same executable through a thin launcher; no separate JavaScript CLI exists.

The `lgtmd` library remains independent of the CLI and its host dependencies.
Application callbacks execute in the configured flow's own runtime. Rust-authored
flows and static preview do not require Node at runtime.

Prepare the frontend and native executable with `just docs-prepare` from a source
checkout. Then `cargo install --path crates/lgtmd-cli --locked` installs the native
CLI. Contributor asset preparation requires Node; using the resulting executable
does not. This crate is not yet published to crates.io.

The internal `__bridge` entry point carries the Node SDK's coarse JSON requests.
It is an internal protocol, not a second CLI or an authoring language.
