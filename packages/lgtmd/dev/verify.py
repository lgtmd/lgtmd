"""Verify lgtmd's web SDK, real browser example, and clean package consumers."""

import argparse
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tarfile
import tempfile


SDK = Path(__file__).resolve().parents[1]
SOURCES = (
    "crates/lgtmd",
    "crates/lgtmd-node",
    "packages/lgtmd",
    "examples/lgtmd-web",
)
WORKSPACE = """[workspace]
members = ["crates/lgtmd", "crates/lgtmd-node"]
resolver = "3"
"""


class VerificationError(Exception):
    pass


def run(command, *, cwd, environment, capture=False):
    command = [str(part) for part in command]
    print("Web check: " + " ".join(command), flush=True)
    result = subprocess.run(
        command, cwd=cwd, env=environment, check=False,
        stdout=subprocess.PIPE if capture else None,
        text=True,
    )
    if result.returncode:
        if capture and result.stdout:
            print(result.stdout, file=sys.stderr)
        raise VerificationError(f"Command failed with exit {result.returncode}: {command[0]}")
    return result.stdout if capture else None


def payload(root, destination):
    """Copy portable maintained sources; never copy N3 or prebuilt binaries."""
    for relative in SOURCES:
        source = root / relative
        if not source.is_dir():
            raise OSError(f"Portable web payload is missing {source}")

        def disposable(directory, names):
            directory = Path(directory)
            excluded = set()
            if directory == source:
                excluded.update((".cache", "target", "Cargo.lock", "node_modules", "dist", "native"))
            if directory == source / "dev" or source / "dev" in directory.parents:
                excluded.add("__pycache__")
            return excluded.intersection(names)

        shutil.copytree(source, destination / relative, ignore=disposable)
    for filename in ("package.json", "package-lock.json"):
        shutil.copyfile(root / filename, destination / filename)
    npm = json.loads((destination / "package.json").read_text(encoding="utf-8"))
    if npm.get("workspaces") != ["packages/lgtmd", "examples/lgtmd-web"]:
        raise VerificationError("The portable npm manifest must contain only the SDK and web example")
    (destination / "Cargo.toml").write_text(WORKSPACE, encoding="utf-8")
    return destination


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


def environment_for(root, toolchain=None):
    environment = os.environ.copy()
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    invocation = Path.cwd()
    for name, default in (
        ("CARGO_HOME", root / ".cache/cargo"),
        ("CARGO_TARGET_DIR", root / ".cache/lgtmd-web/target"),
        ("npm_config_cache", root / ".cache/npm"),
    ):
        inherited = environment.get(name)
        if name == "npm_config_cache":
            inherited = inherited or environment.get("NPM_CONFIG_CACHE")
        value = Path(inherited or str(default))
        environment[name] = str(value if value.is_absolute() else invocation / value)
        if name == "npm_config_cache" and "NPM_CONFIG_CACHE" in environment:
            environment["NPM_CONFIG_CACHE"] = environment[name]
    preserve_toolchain(environment, root, toolchain)
    return environment


def extract_package(archive, destination, package_name):
    """Extract ordinary Cargo files without accepting links or traversal paths."""
    with tarfile.open(archive, "r:gz") as contents:
        for member in contents:
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or path.parts[0] != package_name:
                raise VerificationError(f"Unexpected Cargo archive path: {member.name}")
            output = destination.joinpath(*path.parts)
            if member.isdir():
                output.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                output.parent.mkdir(parents=True, exist_ok=True)
                with contents.extractfile(member) as source, output.open("wb") as target:
                    shutil.copyfileobj(source, target)
            else:
                raise VerificationError(f"Cargo archive contains a non-file entry: {member.name}")
    return destination / package_name


def cargo_consumer(root, cargo, environment, offline):
    flags = ["--locked", *(["--offline"] if offline else [])]
    # Cargo's default package verification builds the actual normalized archive.
    run([*cargo, "package", "-p", "lgtmd", "--allow-dirty", *flags], cwd=root, environment=environment)
    metadata = json.loads(run(
        [*cargo, "metadata", "--no-deps", "--format-version", "1", *flags],
        cwd=root, environment=environment, capture=True,
    ))
    package = next(package for package in metadata["packages"] if package["name"] == "lgtmd")
    name = f"lgtmd-{package['version']}"
    archive = Path(metadata["target_directory"]) / "package" / f"{name}.crate"
    with tempfile.TemporaryDirectory(prefix="lgtmd-cargo-consumer-") as temporary:
        directory = Path(temporary).resolve()
        extracted = extract_package(archive, directory / "extracted", name)
        consumer = directory / "consumer"
        (consumer / "src").mkdir(parents=True)
        dependency_path = json.dumps(str(extracted), ensure_ascii=False)
        (consumer / "Cargo.toml").write_text(
            "[package]\nname = \"lgtmd-clean-consumer\"\nversion = \"0.0.0\"\nedition = \"2024\"\n"
            f"[dependencies]\nlgtmd = {{ path = {dependency_path} }}\n",
            encoding="utf-8",
        )
        (consumer / "src/main.rs").write_text(
            "use lgtmd::{Audience, Doc, Document};\n"
            "fn main() {\n"
            "  let mut doc = Doc::new(\"packaged\", \"Packaged SDK\").unwrap();\n"
            "  let value = doc.observe(\"count\", 3).unwrap();\n"
            "  doc.paragraph((\"There are \", &value, \" records.\")).unwrap();\n"
            "  let files = Document::render_many(&[doc.finish().unwrap()], Audience::Reader).unwrap();\n"
            "  assert!(String::from_utf8_lossy(&files[\"packaged.md\"]).contains(\"3 records\"));\n"
            "}\n",
            encoding="utf-8",
        )
        run([*cargo, "generate-lockfile", *(["--offline"] if offline else [])], cwd=consumer, environment=environment)
        run([*cargo, "run", *flags], cwd=consumer, environment=environment)


CORE_SMOKE = """import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Doc, compile, publish } from 'lgtmd';
const require = createRequire(import.meta.url);
assert.throws(() => require.resolve('@playwright/test'), { code: 'MODULE_NOT_FOUND' });
const doc = new Doc('packaged', 'Packaged SDK');
const count = doc.observe('count', 3);
const data = doc.assets.json('data', { count: 3 });
const passage = doc.md`There are ${count} records.

${data.code()}

${data.link('Download JSON')}`;
doc.noteOn(passage)`This package runs without Rust on PATH.`;
const document = doc.finish();
const exports = await compile([document]);
assert.match(new TextDecoder().decode(exports.reader['packaged.md']), /3 records/);
assert.ok(exports.reader['assets/packaged/data.json']);
const options = { reader: resolve('output/reader'), contributor: resolve('output/contributor') };
await publish([document], { ...options, command: 'build' });
await publish([document], { ...options, command: 'check' });
console.log('Packaged core compiled and published with Rust absent from PATH and Playwright not installed.');
"""

PLAYWRIGHT_SMOKE = """import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from '@playwright/test';
import { withDocs, docsReporter, runPlaywright } from 'lgtmd/playwright';
const extended = withDocs(test);
assert.equal(typeof extended.extend, 'function');
assert.equal(typeof runPlaywright, 'function');
assert.equal(docsReporter().length, 1);
const options = {
  config: new URL('./playwright.config.mjs', import.meta.url),
  reader: resolve('playwright-output/reader'),
  contributor: resolve('playwright-output/contributor'),
};
await runPlaywright({ ...options, command: 'build' });
await runPlaywright({ ...options, command: 'check' });
assert.match(await readFile('playwright-output/reader/packaged-runner.md', 'utf8'), /The installed runner executed/);
console.log('Packaged optional Playwright fixture, reporter, finalizer, and publication passed.');
"""

PLAYWRIGHT_TEST = """import assert from 'node:assert/strict';
import { test as base } from '@playwright/test';
import { withDocs } from 'lgtmd/playwright';
const test = withDocs(base);
test('document an ordinary Node result', async ({ doc }) => {
  doc.page({ id: 'packaged-runner', title: 'Packaged runner' });
  await doc.check('sum', () => { assert.equal(1 + 1, 2); });
  doc.md`The installed runner executed the documented assertion.`;
});
"""

PLAYWRIGHT_CONFIG = """import { docsReporter } from 'lgtmd/playwright';
export default {
  testDir: '.', testMatch: 'packaged.spec.mjs',
  outputDir: '.cache/playwright',
  workers: 1, retries: 0, timeout: 5000,
  reporter: docsReporter(),
};
"""


def npm_consumer(root, node, npm, environment, offline):
    with tempfile.TemporaryDirectory(prefix="lgtmd-npm-consumer-") as temporary:
        directory = Path(temporary).resolve()
        archives = directory / "archives"
        archives.mkdir()
        packed = json.loads(run(
            [npm, "pack", "--json", "--pack-destination", archives],
            cwd=root / "packages/lgtmd", environment=environment, capture=True,
        ))
        archive = archives / packed[0]["filename"]
        consumer = directory / "consumer"
        consumer.mkdir()
        (consumer / "package.json").write_text(json.dumps({
            "name": "lgtmd-clean-consumer", "version": "0.0.0", "private": True,
            "type": "module", "dependencies": {"lgtmd": f"file:{archive}"},
        }), encoding="utf-8")
        only_node = directory / "node-only-bin"
        only_node.mkdir()
        (only_node / "node").symlink_to(Path(node).resolve())
        isolated = environment.copy()
        isolated["PATH"] = str(only_node)
        isolated.pop("LGTMD_CONFORMANCE_FIXTURE", None)
        isolated.pop("NODE_PATH", None)
        isolated.pop("NODE_OPTIONS", None)
        if shutil.which("cargo", path=isolated["PATH"]) or shutil.which("rustc", path=isolated["PATH"]):
            raise VerificationError("The npm consumer must have no Rust toolchain on PATH")
        install = [npm, "install", "--global=false", "--prefix", consumer, "--no-audit", "--no-fund", *(["--offline"] if offline else [])]
        # Installation itself has only Node on PATH; no ignored install scripts
        # or local source paths can conceal a build-time Rust requirement.
        run(install, cwd=consumer, environment=isolated)
        (consumer / "core.mjs").write_text(CORE_SMOKE, encoding="utf-8")
        run([node, "core.mjs"], cwd=consumer, environment=isolated)
        version = json.loads((root / "package.json").read_text(encoding="utf-8"))["devDependencies"]["@playwright/test"]
        run([*install, f"@playwright/test@{version}"], cwd=consumer, environment=isolated)
        (consumer / "playwright.mjs").write_text(PLAYWRIGHT_SMOKE, encoding="utf-8")
        (consumer / "playwright.config.mjs").write_text(PLAYWRIGHT_CONFIG, encoding="utf-8")
        (consumer / "packaged.spec.mjs").write_text(PLAYWRIGHT_TEST, encoding="utf-8")
        run([node, "playwright.mjs"], cwd=consumer, environment=isolated)


def node_tools(root, environment):
    node = shutil.which("node", path=environment.get("PATH"))
    npm = shutil.which("npm", path=environment.get("PATH"))
    if not node or not npm:
        raise VerificationError("Web verification requires Node.js 24 and npm")
    version = run([node, "-p", "process.versions.node"], cwd=root, environment=environment, capture=True).strip()
    if version.split(".")[0] != "24":
        raise VerificationError(f"Web verification requires Node.js 24; found {version}")
    tag = run([node, "-p", "process.platform + '-' + process.arch"], cwd=root, environment=environment, capture=True).strip()
    return node, npm, tag


def prepare(root, cargo, environment, offline, npm, tag):
    flags = ["--locked", *(["--offline"] if offline else [])]
    run([*cargo, "build", "-p", "lgtmd-node", "--release", *flags], cwd=root, environment=environment)
    executable = "lgtmd-node.exe" if tag.startswith("win32-") else "lgtmd-node"
    binary = Path(environment["CARGO_TARGET_DIR"]) / "release" / executable
    native = root / "packages/lgtmd/native" / tag / executable
    native.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(binary, native)
    run([npm, "ci", "--no-audit", "--no-fund", *(["--offline"] if offline else [])], cwd=root, environment=environment)
    run([npm, "run", "build"], cwd=root, environment=environment)


def checks(root, cargo, environment, offline, install_browser):
    node, npm, tag = node_tools(root, environment)
    environment = environment.copy()
    environment["LGTMD_CONFORMANCE_FIXTURE"] = str(root / "crates/lgtmd/tests/fixtures/portable.json")
    selection = ["-p", "lgtmd", "-p", "lgtmd-node"]
    flags = ["--locked", *(["--offline"] if offline else [])]
    run([sys.executable, "-m", "unittest", "discover", "-s", root / "packages/lgtmd/dev/tests"], cwd=root, environment=environment)
    run([*cargo, "fmt", *selection, "--check"], cwd=root, environment=environment)
    run([*cargo, "clippy", *selection, *flags, "--all-targets", "--", "-D", "warnings"], cwd=root, environment=environment)
    run([*cargo, "test", *selection, *flags, "--all-targets"], cwd=root, environment=environment)
    prepare(root, cargo, environment, offline, npm, tag)
    if install_browser:
        run([npm, "exec", "--", "playwright", "install", "chromium"], cwd=root, environment=environment)
    run([npm, "test"], cwd=root, environment=environment)
    run([npm, "run", "typecheck"], cwd=root, environment=environment)
    with tempfile.TemporaryDirectory(prefix="lgtmd-web-review-") as temporary:
        candidate = Path(temporary).resolve() / "candidate"
        command = [node, "examples/lgtmd-web/run.ts"]
        run([*command, "build", candidate], cwd=root, environment=environment)
        run([*command, "check", candidate], cwd=root, environment=environment)
    cargo_consumer(root, cargo, environment, offline)
    npm_consumer(root, node, npm, environment, offline)


def main(arguments=None, *, sdk=SDK):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--standalone", action="store_true", help="copy only portable sources to a minimal temporary workspace")
    parser.add_argument("--prepare", action="store_true", help="install npm dependencies and build the local binding without verification or browser installation")
    parser.add_argument("--toolchain", help="select an installed Rust toolchain, e.g. 1.95.0")
    parser.add_argument("--offline", action="store_true", help="use warm Cargo and npm caches; Chromium must already be installed")
    parser.add_argument("--install-browser", action="store_true", help="explicitly install the pinned Chromium browser before real browser checks")
    options = parser.parse_args(arguments)
    if options.offline and options.install_browser:
        parser.error("--offline cannot install a browser; run the explicit browser setup separately")
    if options.prepare and options.install_browser:
        parser.error("--prepare does not install a browser; run the explicit browser setup separately")
    cargo = ["cargo", *([f"+{options.toolchain}"] if options.toolchain else [])]
    try:
        root = Path(sdk).resolve().parents[1]
        environment = environment_for(root, options.toolchain)
        if options.standalone:
            with tempfile.TemporaryDirectory(prefix="lgtmd-web-standalone-") as temporary:
                isolated = payload(root, Path(temporary).resolve())
                run([*cargo, "generate-lockfile", *(["--offline"] if options.offline else [])], cwd=isolated, environment=environment)
                if options.prepare:
                    _, npm, tag = node_tools(isolated, environment)
                    prepare(isolated, cargo, environment, options.offline, npm, tag)
                else:
                    checks(isolated, cargo, environment, options.offline, options.install_browser)
        else:
            if options.prepare:
                _, npm, tag = node_tools(root, environment)
                prepare(root, cargo, environment, options.offline, npm, tag)
            else:
                checks(root, cargo, environment, options.offline, options.install_browser)
        print("Web SDK prepared." if options.prepare else "Portable web verification passed.", flush=True)
        return 0
    except (OSError, ValueError, KeyError, VerificationError) as error:
        print(f"Portable web verification failed: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
