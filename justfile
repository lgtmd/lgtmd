# Independent development commands for the Rust and Node SDKs.
set positional-arguments

# List development commands.
default:
    @just --list

# Explicit dependency, compiler binding, formatter and browser preparation.
setup: doc-web-setup
    python3 tools/format_docs.py --prepare

fmt:
    cargo fmt --all
    python3 tools/format_docs.py --write

fmt-check:
    cargo fmt --all --check
    python3 tools/format_docs.py --check

# Verify SDK/consumer tests, doctests and Rust documentation.
doc-framework-test *args:
    python3 crates/lgtmd/dev/verify.py "$@"

# Verify a disposable Rust workspace against the declared minimum.
doc-framework-smoke *args:
    python3 crates/lgtmd/dev/verify.py --standalone --toolchain 1.95.0 "$@"

# Explicitly install the pinned browser; checks never download one implicitly.
doc-web-setup:
    python3 packages/lgtmd/dev/verify.py --prepare
    npm exec -- playwright install chromium

# Real browser replay, exact export checks and installed Cargo/npm consumers.
doc-web-test *args:
    python3 packages/lgtmd/dev/verify.py "$@"

# Run the same web gate in an independent source-only workspace.
doc-web-smoke *args:
    python3 packages/lgtmd/dev/verify.py --standalone --toolchain 1.95.0 "$@"

# Check release package integrity and fail-closed approval guards.
release-test:
    python3 -m unittest discover -s tools/tests -p 'test_release_*.py'

# Both language gates are required; forward --offline after explicit setup.
verify *args: fmt-check release-test
    python3 crates/lgtmd/dev/verify.py "$@"
    python3 packages/lgtmd/dev/verify.py "$@"
