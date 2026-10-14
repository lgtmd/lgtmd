"""Verify lgtmd's web SDK, real browser example, and clean package consumers."""

import argparse
from contextlib import contextmanager
import json
import os
import selectors
import time
import re
from urllib.request import urlopen
from urllib.parse import urljoin
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tarfile
import tempfile


SDK = Path(__file__).resolve().parents[1]
SOURCES = (
    "crates/lgtmd",
    "crates/lgtmd-cli",
    "packages/lgtmd",
    "examples/lgtmd-web",
    "packages/viewer",
    "examples/review",
    "examples/stay",
    "docs/authoring",
    "docs/guide",
)
WORKSPACE = """[workspace]
members = ["crates/lgtmd", "crates/lgtmd-cli"]
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
                excluded.update((".cache", "target", "Cargo.lock", "node_modules", "dist", "native", "viewer"))
            if directory == source / "dev" or source / "dev" in directory.parents:
                excluded.add("__pycache__")
            return excluded.intersection(names)

        shutil.copytree(source, destination / relative, ignore=disposable)
    for filename in ("package.json", "package-lock.json", "lgtmd.config.json"):
        shutil.copyfile(root / filename, destination / filename)
    npm = json.loads((destination / "package.json").read_text(encoding="utf-8"))
    if npm.get("workspaces") != ["packages/lgtmd", "packages/viewer", "examples/lgtmd-web", "examples/review", "examples/stay"]:
        raise VerificationError("The portable npm manifest must contain only the SDK, viewer and maintained web examples")
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


@contextmanager
def isolated_target(environment, default):
    """Keep copied-source artifacts private to this disposable workspace.

    Cargo can reuse local-package fingerprints across copied trees with equal
    mtimes, including compiled CARGO_MANIFEST_DIR values from a deleted copy.
    Keep the caller's storage root, but never reuse its native build artifacts
    or a previous disposable copy's target directory.
    """
    root = Path(environment.get("CARGO_TARGET_DIR") or default)
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="lgtmd-isolated-", dir=root) as temporary:
        isolated = environment.copy()
        isolated["CARGO_TARGET_DIR"] = str(Path(temporary).resolve())
        yield isolated


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
            "  let documents = [doc.finish().unwrap()];\n"
            "  let files = Document::render_many(&documents, Audience::Reader).unwrap();\n"
            "  assert!(String::from_utf8_lossy(&files[\"packaged.md\"]).contains(\"3 records\"));\n"
            "  if std::env::var_os(\"LGTMD_OUTPUT\").is_some() { lgtmd::handoff::complete_run(&documents).unwrap(); }\n"
            "}\n",
            encoding="utf-8",
        )
        run([*cargo, "generate-lockfile", *(["--offline"] if offline else [])], cwd=consumer, environment=environment)
        run([*cargo, "run", *flags], cwd=consumer, environment=environment)
        # The same native CLI serves Rust-authored docs with no Node or Rust
        # toolchain on PATH. Build the application's flow first, then use its
        # ordinary executable as the project-owned command.
        installed = directory / "installed-cli"
        run([*cargo, "install", "--path", root / "crates/lgtmd-cli", "--root", installed, "--locked", *(["--offline"] if offline else [])], cwd=root, environment=environment)
        executable = installed / "bin/lgtmd"
        flow = Path(environment["CARGO_TARGET_DIR"]) / "debug/lgtmd-clean-consumer"
        (consumer / "lgtmd.config.json").write_text(json.dumps({"flow": {"command": [str(flow)]}, "basePath": "/docs/"}), encoding="utf-8")
        isolated = environment.copy()
        empty_path = directory / "empty-bin"
        empty_path.mkdir()
        isolated["PATH"] = str(empty_path)
        for tool in ("node", "npm", "cargo", "rustc"):
            if shutil.which(tool, path=isolated["PATH"]):
                raise VerificationError("Native runtime smoke must have no language toolchain on PATH")
        run([executable, "--help"], cwd=consumer, environment=isolated)
        run([executable, "build"], cwd=consumer, environment=isolated)
        native_preview(executable, consumer, isolated)



def native_preview(executable, cwd, environment):
    """Exercise embedded frontend delivery from a Cargo-installed native CLI."""
    child = subprocess.Popen([str(executable), "preview", "--port", "0"], cwd=cwd, env=environment,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    selector = selectors.DefaultSelector()
    selector.register(child.stdout, selectors.EVENT_READ)
    try:
        deadline = time.monotonic() + 15
        url = None
        while time.monotonic() < deadline:
            if child.poll() is not None:
                raise VerificationError("Native preview exited: " + child.stderr.read())
            if not selector.select(timeout=0.2):
                continue
            line = child.stdout.readline()
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("event") == "listening":
                url = event["url"]
                break
        if url is None:
            raise VerificationError("Native preview startup timed out")
        with urlopen(url, timeout=5) as response:
            html = response.read().decode()
        with urlopen(urljoin(url, "site.json"), timeout=5) as response:
            state = json.load(response)
        if state["audience"] != "reader" or state["current"]["pages"][0]["id"] != "packaged":
            raise VerificationError("Native preview served the wrong completed Rust guide")
        assets = re.findall(r'(?:src|href)="([^"#]+\.(?:js|css))"', html)
        if not assets:
            raise VerificationError("Native preview is missing embedded frontend assets")
        for asset in assets:
            with urlopen(urljoin(url, asset), timeout=5) as response:
                if not response.read():
                    raise VerificationError("Native frontend asset is empty")
    finally:
        selector.close()
        if child.poll() is None:
            child.terminate()
        try:
            child.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()
            child.communicate()
            raise VerificationError("Native preview did not shut down")


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

CLI_SMOKE = r"""import assert from 'node:assert/strict';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const cli = resolve('node_modules/lgtmd/dist/src/cli.js');
const executable = await realpath('node_modules/.bin/lgtmd');
assert.equal(executable, cli);
await writeFile('flow.mjs', `import { Doc, completeRun } from 'lgtmd';
import { appendFile } from 'node:fs/promises';
await appendFile('runs', 'x');
const doc = new Doc('installed', 'Installed documentation');
doc.md\`The installed CLI uses its bundled frontend.\`;
await completeRun([doc.finish()]);
`);
await writeFile('lgtmd.config.json', JSON.stringify({flow:{command:[process.execPath,resolve('flow.mjs')]},basePath:'/docs/'}));
function child(args) { return spawn(process.execPath,[cli,...args],{stdio:['ignore','pipe','pipe']}); }
async function exit(args) {
  const proc=child(args); let out='',err='';
  proc.stdout.on('data',b=>out+=b); proc.stderr.on('data',b=>err+=b);
  const code=await new Promise((done,reject)=>{proc.once('error',reject);proc.once('close',done);});
  assert.equal(code,0,err); return out;
}
assert.match(await exit(['--help']),/dev/);
await exit(['build']);
assert.equal(await readFile('runs','utf8'),'x');
async function serve(args) {
  const proc=child([...args,'--port','0']); let buffer=''; let stderr='';
  proc.stderr.on('data',b=>stderr+=b);
  try {
    const url=await new Promise((done,reject)=>{
      const timer=setTimeout(()=>reject(new Error('CLI startup timeout: '+stderr)),10000);
      proc.once('error',e=>{clearTimeout(timer);reject(e);});
      proc.once('close',code=>{clearTimeout(timer);reject(new Error('CLI exited '+code+stderr));});
      proc.stdout.on('data',b=>{buffer+=b; for(const line of buffer.split('\n')) {try {const event=JSON.parse(line);if(event.event==='listening'){clearTimeout(timer);done(event.url);}}catch{}}});
    });
    const html=await (await fetch(url)).text();
    assert.match(html,/LGTMD|lgtmd/);
    const script=html.match(/<script[^>]*src="([^"]+)"/)[1];
    assert.equal((await fetch(new URL(script,url))).status,200);
  } finally {
    if (proc.exitCode === null && proc.signalCode === null) {
      await new Promise(done=>{
        const timer=setTimeout(()=>proc.kill('SIGKILL'),5000);
        proc.once('close',()=>{clearTimeout(timer);done();});
        proc.kill('SIGTERM');
      });
    }
  }
}
await serve(['preview']);
await serve(['dev','--reuse']);
assert.equal(await readFile('runs','utf8'),'x','Preview and reuse must not execute flow');
console.log('Packed CLI and bundled frontend started without Rust, Playwright, or authoring during reuse/preview.');
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


def npm_consumer(root, node, npm, environment, offline, *, archive=None):
    with tempfile.TemporaryDirectory(prefix="lgtmd-npm-consumer-") as temporary:
        directory = Path(temporary).resolve()
        if archive is None:
            archives = directory / "archives"
            archives.mkdir()
            packed = json.loads(run(
                [npm, "pack", "--json", "--pack-destination", archives],
                cwd=root / "packages/lgtmd", environment=environment, capture=True,
            ))
            archive = archives / packed[0]["filename"]
        else:
            # Release hosts execute the identical assembled archive, never a repack.
            archive = Path(archive).resolve()
            if not archive.is_file():
                raise VerificationError(f"Prepared npm archive is missing: {archive}")
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
        (consumer / "cli.mjs").write_text(CLI_SMOKE, encoding="utf-8")
        run([node, "cli.mjs"], cwd=consumer, environment=isolated)
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


def stage_viewer(root):
    """Stage only the prepared frontend into the private CLI crate for embedding."""
    source = root / "packages/lgtmd/viewer"
    target = root / "crates/lgtmd-cli/viewer"
    if source.is_symlink() or not (source / "index.html").is_file() or not (source / "manifest.json").is_file():
        raise VerificationError("Prepare the complete viewer before building the native CLI")
    if any(path.is_symlink() for path in source.rglob("*")) or target.is_symlink():
        raise VerificationError("Embedded viewer staging must not contain symlinks")
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(source, target)


def stage_native(binary, native):
    """Replace the executable without mutating an inode a running CLI may map.

    On macOS, overwriting a signed executable in place can leave the kernel's
    cached code signature attached to changed pages and kill subsequent launches.
    Staging beside the destination keeps replacement atomic on the same volume.
    """
    native.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=f".{native.name}.", suffix=".tmp", dir=native.parent)
    os.close(descriptor)
    temporary = Path(name)
    try:
        shutil.copy2(binary, temporary)
        os.replace(temporary, native)
    finally:
        temporary.unlink(missing_ok=True)


def prepare(root, cargo, environment, offline, npm, tag):
    flags = ["--locked", *(["--offline"] if offline else [])]
    run([npm, "ci", "--no-audit", "--no-fund", *(["--offline"] if offline else [])], cwd=root, environment=environment)
    run([npm, "run", "build"], cwd=root, environment=environment)
    stage_viewer(root)
    run([*cargo, "build", "-p", "lgtmd-cli", "--release", *flags], cwd=root, environment=environment)
    executable = "lgtmd.exe" if tag.startswith("win32-") else "lgtmd"
    binary = Path(environment["CARGO_TARGET_DIR"]) / "release" / executable
    native = root / "packages/lgtmd/native" / tag / executable
    stage_native(binary, native)
    old_bridge = native.parent / ("lgtmd-node.exe" if tag.startswith("win32-") else "lgtmd-node")
    if old_bridge.is_file():
        old_bridge.unlink()


def retain_browser_diagnostics(root, candidate, destination, error):
    """Keep the baseline and the same failed run's project-owned captures."""
    try:
        destination.mkdir(parents=True, exist_ok=True)
        retained = Path(tempfile.mkdtemp(prefix="browser-", dir=destination))
        (retained / "failure.txt").write_text(f"{type(error).__name__}: {error}\n", encoding="utf-8")
        if candidate.is_dir():
            shutil.copytree(candidate, retained / "baseline")
        output = root / "examples/lgtmd-web/.cache/playwright"
        if output.is_dir():
            shutil.copytree(output, retained / "playwright")
        print(f"Browser verification diagnostics retained: {retained}", file=sys.stderr)
    except OSError as diagnostic_error:
        # Diagnostic retention must never replace the verification failure.
        print(f"Could not retain browser diagnostics: {diagnostic_error}", file=sys.stderr)


def browser_example(root, node, environment, diagnostics_root):
    with tempfile.TemporaryDirectory(prefix="lgtmd-web-review-") as temporary:
        candidate = Path(temporary).resolve() / "candidate"
        command = [node, "examples/lgtmd-web/run.ts"]
        try:
            run([*command, "build", candidate], cwd=root, environment=environment)
            # Every fresh browser run must match; a failure is never retried.
            for _ in range(3):
                run([*command, "check", candidate], cwd=root, environment=environment)
        except (OSError, VerificationError, KeyboardInterrupt) as error:
            retain_browser_diagnostics(root, candidate, diagnostics_root, error)
            raise


def stay_example(root, node, environment, diagnostics_root):
    try:
        run([node, "examples/stay/verify.ts"], cwd=root, environment=environment)
    except (OSError, VerificationError, KeyboardInterrupt) as error:
        try:
            diagnostics_root.mkdir(parents=True, exist_ok=True)
            retained = Path(tempfile.mkdtemp(prefix="stay-", dir=diagnostics_root))
            (retained / "failure.txt").write_text(f"{type(error).__name__}: {error}\n", encoding="utf-8")
            for name in ("diagnostics", "playwright"):
                output = root / "examples/stay/.cache" / name
                if output.is_dir():
                    shutil.copytree(output, retained / name)
            print(f"Stay verification diagnostics retained: {retained}", file=sys.stderr)
        except OSError as diagnostic_error:
            print(f"Could not retain Stay diagnostics: {diagnostic_error}", file=sys.stderr)
        raise


def checks(root, cargo, environment, offline, install_browser, *, diagnostics_root=None):
    node, npm, tag = node_tools(root, environment)
    environment = environment.copy()
    environment["LGTMD_CONFORMANCE_FIXTURE"] = str(root / "crates/lgtmd/tests/fixtures/portable.json")
    selection = ["-p", "lgtmd", "-p", "lgtmd-cli"]
    flags = ["--locked", *(["--offline"] if offline else [])]
    run([sys.executable, "-m", "unittest", "discover", "-s", root / "packages/lgtmd/dev/tests"], cwd=root, environment=environment)
    prepare(root, cargo, environment, offline, npm, tag)
    run([*cargo, "fmt", *selection, "--check"], cwd=root, environment=environment)
    run([*cargo, "clippy", *selection, *flags, "--all-targets", "--", "-D", "warnings"], cwd=root, environment=environment)
    run([*cargo, "test", *selection, *flags, "--all-targets"], cwd=root, environment=environment)
    if install_browser:
        run([npm, "exec", "--", "playwright", "install", "chromium"], cwd=root, environment=environment)
    run([npm, "test"], cwd=root, environment=environment)
    run([npm, "run", "typecheck"], cwd=root, environment=environment)
    browser_example(
        root, node, environment,
        diagnostics_root or root / ".cache/lgtmd-web/diagnostics",
    )
    run([node, "--test", "examples/review/fixture.test.mjs"], cwd=root, environment=environment)
    run([npm, "run", "test:api", "--workspace", "@lgtmd/example-stay"], cwd=root, environment=environment)
    run([npm, "run", "test:filters", "--workspace", "@lgtmd/example-stay"], cwd=root, environment=environment)
    stay_example(root, node, environment, diagnostics_root or root / ".cache/lgtmd-web/diagnostics")
    run([node, "packages/viewer/tests/browser.mjs"], cwd=root, environment=environment)
    run([node, "examples/review/showcase/verify.mjs"], cwd=root, environment=environment)
    run([node, "docs/authoring/verify.mjs", "verify"], cwd=root, environment=environment)
    cargo_consumer(root, cargo, environment, offline)
    npm_consumer(root, node, npm, environment, offline)


def main(arguments=None, *, sdk=SDK):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--standalone", action="store_true", help="copy portable sources to a temporary workspace with a private Cargo target")
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
            with tempfile.TemporaryDirectory(prefix="lgtmd-web-standalone-") as temporary, isolated_target(
                environment, root / ".cache/lgtmd-web/target",
            ) as environment:
                isolated = payload(root, Path(temporary).resolve())
                run([*cargo, "generate-lockfile", *(["--offline"] if options.offline else [])], cwd=isolated, environment=environment)
                if options.prepare:
                    _, npm, tag = node_tools(isolated, environment)
                    prepare(isolated, cargo, environment, options.offline, npm, tag)
                else:
                    checks(
                        isolated, cargo, environment, options.offline, options.install_browser,
                        diagnostics_root=root / ".cache/lgtmd-web/diagnostics",
                    )
        else:
            if options.prepare:
                _, npm, tag = node_tools(root, environment)
                prepare(root, cargo, environment, options.offline, npm, tag)
            else:
                checks(
                    root, cargo, environment, options.offline, options.install_browser,
                    diagnostics_root=root / ".cache/lgtmd-web/diagnostics",
                )
        print("Web SDK prepared." if options.prepare else "Portable web verification passed.", flush=True)
        return 0
    except (OSError, ValueError, KeyError, VerificationError) as error:
        print(f"Portable web verification failed: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
