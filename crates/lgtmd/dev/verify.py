"""Verify the portable Rust SDK and its real consumers without application replay."""

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


SDK = Path(__file__).resolve().parents[1]
PACKAGES = ("lgtmd", "doc-example-config")
WORKSPACE = """[workspace]
members = ["crates/lgtmd", "crates/doc-example-config"]
resolver = "3"
"""


def status(returncode):
    return returncode if returncode >= 0 else 128 - returncode


def run(command, *, cwd, environment):
    # Argument lists preserve paths and toolchain names as data, including spaces.
    print("Portable check: " + " ".join(command), flush=True)
    return status(subprocess.run(command, cwd=cwd, env=environment, check=False).returncode)


def payload(sdk, destination):
    """Copy the maintained packages, without the host workspace or disposable output."""
    for source in (sdk, sdk.parent / "doc-example-config"):
        for required in ("Cargo.toml", "README.md", "LICENSE", "src"):
            if not (source / required).exists():
                raise OSError(f"Portable payload is missing {source / required}")
        def disposable(directory, names):
            directory = Path(directory)
            excluded = set()
            if directory == source:
                excluded.update((".cache", "target", "Cargo.lock", "__pycache__"))
            if directory == source / "dev" or source / "dev" in directory.parents:
                excluded.add("__pycache__")
            return excluded.intersection(names)

        shutil.copytree(
            source,
            destination / "crates" / source.name,
            ignore=disposable,
        )
    (destination / "Cargo.toml").write_text(WORKSPACE, encoding="utf-8")
    return destination / "crates/lgtmd"


def preserve_toolchain(environment, cwd, toolchain):
    """Keep rustup selection when package checks leave the source directory."""
    if toolchain is not None:
        environment["RUSTUP_TOOLCHAIN"] = toolchain
        return
    if "RUSTUP_TOOLCHAIN" in environment:
        return
    rustup = shutil.which("rustup", path=environment.get("PATH"))
    if rustup is None:
        return
    try:
        selected = subprocess.run(
            [rustup, "show", "active-toolchain"], cwd=cwd, env=environment,
            check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
    except OSError:
        # Rustup is optional: a system Cargo installation needs no rustup setup.
        return
    if selected.returncode == 0 and selected.stdout.strip():
        environment["RUSTUP_TOOLCHAIN"] = selected.stdout.split()[0]


def environment_for(sdk, standalone, toolchain=None):
    environment = os.environ.copy()
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    invocation = Path.cwd()
    for variable in ("CARGO_HOME", "CARGO_TARGET_DIR"):
        value = environment.get(variable)
        if value and not Path(value).is_absolute():
            # Cargo interprets these against its working directory. Capture the
            # caller's location before native/standalone checks change that cwd.
            environment[variable] = str(invocation / value)
    if standalone:
        # Keep rebuilds cheap while preserving explicit native/container overrides.
        environment.setdefault("CARGO_TARGET_DIR", str(sdk / ".cache/standalone-target"))
    preserve_toolchain(environment, sdk, toolchain)
    return environment


def checks(sdk, cargo, environment, offline):
    selection = [part for package in PACKAGES for part in ("-p", package)]
    locked = ["--locked", *(["--offline"] if offline else [])]
    commands = [
        [sys.executable, "-m", "unittest", "discover", "-s", str(sdk / "dev/tests"), "-p", "test_*.py"],
        [*cargo, "fmt", *selection, "--check"],
        [*cargo, "clippy", *locked, *selection, "--all-targets", "--", "-D", "warnings"],
        [*cargo, "test", *locked, *selection, "--all-targets"],
        [*cargo, "test", *locked, *selection, "--doc"],
        [*cargo, "doc", *locked, *selection, "--no-deps"],
    ]
    for command in commands:
        command_environment = environment
        if command[:len(cargo) + 1] == [*cargo, "doc"]:
            command_environment = environment.copy()
            command_environment["RUSTDOCFLAGS"] = environment.get("RUSTDOCFLAGS", "") + " -D warnings"
        result = run(command, cwd=sdk, environment=command_environment)
        if result:
            return result
    return 0


def main(arguments=None, *, sdk=SDK):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--standalone", action="store_true", help="copy both packages to a disposable minimal workspace")
    parser.add_argument("--toolchain", help="select an installed rustup toolchain, e.g. 1.95.0")
    parser.add_argument("--offline", action="store_true", help="resolve and verify using cached Cargo dependencies")
    options = parser.parse_args(arguments)
    cargo = ["cargo", *([f"+{options.toolchain}"] if options.toolchain else [])]
    try:
        sdk = Path(sdk).resolve()
        environment = environment_for(sdk, options.standalone, options.toolchain)
        if not options.standalone:
            return checks(sdk, cargo, environment, options.offline)
        with tempfile.TemporaryDirectory(prefix="lgtmd-") as temporary:
            isolated = payload(sdk, Path(temporary))
            # Resolve only portable dependencies into a temporary lockfile. Never
            # copy or modify the application's lockfile, patches, or toolchain pin.
            result = run(
                [*cargo, "generate-lockfile", *(["--offline"] if options.offline else [])],
                cwd=isolated, environment=environment,
            )
            if result:
                return result
            return checks(isolated, cargo, environment, options.offline)
    except OSError as error:
        print(f"Portable verification failed: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
