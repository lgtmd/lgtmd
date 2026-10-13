"""Prepare and verify release artifacts without publishing or creating tags."""

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import struct
import subprocess
import sys
import tarfile
import tomllib


ROOT = Path(__file__).resolve().parents[1]
TARGETS = {
    "darwin-arm64": "aarch64-apple-darwin",
    "linux-x64": "x86_64-unknown-linux-gnu",
}
REPOSITORY = "git+https://github.com/lgtmd/lgtmd.git"


class ReleaseError(Exception):
    pass


def run(command, *, root=ROOT, capture=False):
    command = [str(part) for part in command]
    print("Release check: " + " ".join(command), file=sys.stderr, flush=True)
    result = subprocess.run(
        command, cwd=root, check=False, text=True,
        stdout=subprocess.PIPE if capture else None,
    )
    if result.returncode:
        raise ReleaseError(f"Command failed with exit {result.returncode}: {command[0]}")
    return result.stdout if capture else None


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def source_sha(root=ROOT):
    actual = run(["git", "rev-parse", "HEAD"], root=root, capture=True).strip()
    expected = os.environ.get("GITHUB_SHA", actual)
    if not re.fullmatch(r"[0-9a-f]{40}", expected) or actual != expected:
        raise ReleaseError("Release checkout must match the complete GITHUB_SHA")
    if run(["git", "status", "--porcelain", "--untracked-files=all"], root=root, capture=True).strip():
        raise ReleaseError("Release artifacts require a clean source checkout; ignored build output is allowed")
    return actual


def version(root=ROOT):
    crate = tomllib.loads((root / "crates/lgtmd/Cargo.toml").read_text())
    npm = json.loads((root / "packages/lgtmd/package.json").read_text())
    value = crate["package"]["version"]
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", value):
        raise ReleaseError("Release requires an explicit semantic version")
    if npm["version"] != value:
        raise ReleaseError("Rust and npm SDK release versions must match")
    return value


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def native_bytes(data, tag):
    if tag == "darwin-arm64":
        valid = len(data) >= 8 and data[:4] == b"\xcf\xfa\xed\xfe" and struct.unpack("<I", data[4:8])[0] == 0x0100000C
    elif tag == "linux-x64":
        valid = len(data) >= 20 and data[:6] == b"\x7fELF\x02\x01" and struct.unpack("<H", data[18:20])[0] == 62
    else:
        valid = False
    if not valid:
        raise ReleaseError(f"Native binary does not match {tag}")


def native(out, *, root=ROOT):
    tag = {("darwin", "arm64"): "darwin-arm64", ("linux", "x86_64"): "linux-x64"}.get(
        (sys.platform, platform.machine().lower())
    )
    if tag is None:
        raise ReleaseError("Native release builds support macOS arm64 and Linux x64")
    sha, release_version = source_sha(root), version(root)
    target = TARGETS[tag]
    run(["cargo", "build", "-p", "lgtmd-node", "--release", "--locked", "--target", target], root=root)
    metadata = json.loads(run(["cargo", "metadata", "--locked", "--no-deps", "--format-version", "1"], root=root, capture=True))
    binary = Path(metadata["target_directory"]) / target / "release/lgtmd-node"
    native_bytes(binary.read_bytes(), tag)
    destination = out / tag
    destination.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(binary, destination / "lgtmd-node")
    (destination / "lgtmd-node").chmod(0o755)
    write_json(destination / "receipt.json", {
        "schema_version": 1, "source_sha": sha, "version": release_version,
        "tag": tag, "sha256": digest(destination / "lgtmd-node"),
    })


def native_receipts(directory, sha, release_version):
    if directory.is_symlink() or not directory.is_dir() or {p.name for p in directory.iterdir()} != set(TARGETS):
        raise ReleaseError("Native artifacts must contain exactly darwin-arm64 and linux-x64")
    checksums = {}
    for tag in TARGETS:
        folder = directory / tag
        if folder.is_symlink() or not folder.is_dir() or {p.name for p in folder.iterdir()} != {"lgtmd-node", "receipt.json"}:
            raise ReleaseError(f"Unexpected native artifact inventory for {tag}")
        binary, receipt_path = folder / "lgtmd-node", folder / "receipt.json"
        if binary.is_symlink() or receipt_path.is_symlink() or not binary.is_file() or not receipt_path.is_file():
            raise ReleaseError(f"Native artifact files must be ordinary files: {tag}")
        receipt = json.loads(receipt_path.read_text())
        checksum = digest(binary)
        expected = {"schema_version": 1, "source_sha": sha, "version": release_version, "tag": tag, "sha256": checksum}
        if not isinstance(receipt, dict) or type(receipt.get("schema_version")) is not int or receipt != expected:
            raise ReleaseError(f"Native receipt source, version, target or checksum mismatch: {tag}")
        native_bytes(binary.read_bytes(), tag)
        checksums[tag] = checksum
    return checksums


def archive_files(path, prefix):
    """Read ordinary archive files without extracting links or unsafe paths."""
    files, seen = {}, set()
    with tarfile.open(path, "r:gz") as archive:
        for member in archive:
            relative = PurePosixPath(member.name)
            if (not member.name or "\\" in member.name or relative.is_absolute()
                    or ".." in relative.parts or str(relative) != member.name.rstrip("/")
                    or not relative.parts or relative.parts[0] != prefix):
                raise ReleaseError(f"Unsafe archive path: {member.name}")
            if relative in seen:
                raise ReleaseError(f"Duplicate archive entry: {member.name}")
            seen.add(relative)
            if member.isdir():
                continue
            if not member.isfile() or len(relative.parts) < 2:
                raise ReleaseError(f"Archive entries must be ordinary files: {member.name}")
            content = archive.extractfile(member)
            if content is None:
                raise ReleaseError(f"Cannot read archive entry: {member.name}")
            files[str(PurePosixPath(*relative.parts[1:]))] = (content.read(), member.mode)
    return files


def npm_archive(path, release_version, native_checksums):
    files = archive_files(path, "package")
    required = {"package.json", "LICENSE", "README.md", "dist/src/index.js", "dist/src/index.d.ts", "dist/src/playwright/index.js", "dist/src/playwright/index.d.ts", "dist/src/playwright/reporter.js"}
    required.update(f"native/{tag}/lgtmd-node" for tag in TARGETS)
    if not required.issubset(files):
        raise ReleaseError(f"npm archive is missing required payload: {sorted(required.difference(files))}")
    for name in files:
        if name not in required and not (name.startswith("dist/src/") and (name.endswith(".js") or name.endswith(".d.ts"))):
            raise ReleaseError(f"Unexpected npm archive payload: {name}")
    package = json.loads(files["package.json"][0])
    if not isinstance(package, dict) or package.get("name") != "lgtmd" or package.get("version") != release_version or package.get("private") is True:
        raise ReleaseError("npm package name, version or publication metadata mismatch")
    if package.get("repository") != {"type": "git", "url": REPOSITORY, "directory": "packages/lgtmd"}:
        raise ReleaseError("npm package repository must identify lgtmd/lgtmd and packages/lgtmd")
    if package.get("type") != "module" or package.get("license") != "MIT":
        raise ReleaseError("npm package must retain ESM and MIT metadata")
    if set(package.get("scripts", {})).intersection({"preinstall", "install", "postinstall", "prepare"}):
        raise ReleaseError("Release package must not require an installation script")
    for tag in TARGETS:
        data, mode = files[f"native/{tag}/lgtmd-node"]
        native_bytes(data, tag)
        if mode & 0o777 != 0o755:
            raise ReleaseError(f"npm native executable permissions must be 0755: {tag}")
        if hashlib.sha256(data).hexdigest() != native_checksums[tag]:
            raise ReleaseError(f"npm native binary checksum mismatch: {tag}")


def crate_archive(path, release_version, sha):
    files = archive_files(path, f"lgtmd-{release_version}")
    required = {"Cargo.toml", "Cargo.toml.orig", "README.md", "LICENSE", "src/lib.rs", ".cargo_vcs_info.json"}
    if not required.issubset(files):
        raise ReleaseError(f"Cargo archive is missing required payload: {sorted(required.difference(files))}")
    for name in files:
        if name not in required and name not in {"Cargo.lock", ".gitignore"} and PurePosixPath(name).parts[0] not in {"src", "tests", "examples", "dev"}:
            raise ReleaseError(f"Unexpected Cargo archive payload: {name}")
    package = tomllib.loads(files["Cargo.toml"][0].decode())["package"]
    if package.get("name") != "lgtmd" or package.get("version") != release_version or package.get("publish") is False:
        raise ReleaseError("Cargo package name, version or publication metadata mismatch")
    if package.get("repository", "").removesuffix(".git") != "https://github.com/lgtmd/lgtmd" or package.get("license") != "MIT":
        raise ReleaseError("Cargo package must retain the lgtmd repository and MIT metadata")
    vcs = json.loads(files[".cargo_vcs_info.json"][0])
    if not isinstance(vcs, dict) or not isinstance(vcs.get("git"), dict) or vcs["git"].get("sha1") != sha or vcs["git"].get("dirty", False) is not False or vcs.get("path_in_vcs") != "crates/lgtmd":
        raise ReleaseError("Cargo archive must identify the clean release source revision")


def check(directory, release_version, sha):
    manifest_path = directory / "manifest.json"
    if directory.is_symlink() or manifest_path.is_symlink():
        raise ReleaseError("Release artifacts must be ordinary files and directories")
    manifest = json.loads(manifest_path.read_text())
    expected_files = {f"lgtmd-{release_version}.tgz", f"lgtmd-{release_version}.crate"}
    if (not isinstance(manifest, dict) or set(manifest) != {"schema_version", "source_sha", "version", "native_targets", "files"}
            or type(manifest["schema_version"]) is not int or manifest["schema_version"] != 1 or manifest["source_sha"] != sha or manifest["version"] != release_version
            or not isinstance(manifest["native_targets"], dict) or not isinstance(manifest["files"], dict)
            or set(manifest["native_targets"]) != set(TARGETS) or set(manifest["files"]) != expected_files):
        raise ReleaseError("Release manifest source, version, targets or inventory mismatch")
    if {p.name for p in directory.iterdir()} != expected_files | {"manifest.json"}:
        raise ReleaseError("Unexpected release directory inventory")
    for checksum in [*manifest["files"].values(), *manifest["native_targets"].values()]:
        if not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{64}", checksum):
            raise ReleaseError("Release checksums must be complete SHA256 values")
    for name, checksum in manifest["files"].items():
        artifact = directory / name
        if artifact.is_symlink() or not artifact.is_file() or digest(artifact) != checksum:
            raise ReleaseError(f"Release artifact checksum mismatch: {name}")
    npm_archive(directory / f"lgtmd-{release_version}.tgz", release_version, manifest["native_targets"])
    crate_archive(directory / f"lgtmd-{release_version}.crate", release_version, sha)
    return manifest


def assemble(native_root, out, *, root=ROOT):
    sha, release_version = source_sha(root), version(root)
    native_checksums = native_receipts(native_root, sha, release_version)
    out.mkdir(parents=True, exist_ok=True)
    if out.is_symlink() or any(out.iterdir()):
        raise ReleaseError("Assembly requires an empty ordinary output directory")
    for tag in TARGETS:
        destination = root / "packages/lgtmd/native" / tag
        destination.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(native_root / tag / "lgtmd-node", destination / "lgtmd-node")
        (destination / "lgtmd-node").chmod(0o755)
    run(["npm", "run", "build"], root=root)
    packed = json.loads(run(["npm", "pack", "--json", "--pack-destination", out], root=root / "packages/lgtmd", capture=True))
    if len(packed) != 1 or packed[0]["filename"] != f"lgtmd-{release_version}.tgz":
        raise ReleaseError("npm pack produced an unexpected archive")
    run(["cargo", "package", "-p", "lgtmd", "--locked"], root=root)
    metadata = json.loads(run(["cargo", "metadata", "--locked", "--no-deps", "--format-version", "1"], root=root, capture=True))
    crate_name = f"lgtmd-{release_version}.crate"
    shutil.copyfile(Path(metadata["target_directory"]) / "package" / crate_name, out / crate_name)
    write_json(out / "manifest.json", {
        "schema_version": 1, "source_sha": sha, "version": release_version,
        "native_targets": native_checksums,
        "files": {name: digest(out / name) for name in [f"lgtmd-{release_version}.tgz", crate_name]},
    })
    check(out, release_version, sha)


def smoke(archive, *, root=ROOT):
    spec = importlib.util.spec_from_file_location("lgtmd_web_verify", root / "packages/lgtmd/dev/verify.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    environment = module.environment_for(root)
    node, npm, _ = module.node_tools(root, environment)
    module.npm_consumer(root, node, npm, environment, False, archive=archive)


def main(arguments=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    build = commands.add_parser("native", help="build and receipt the current host's native bridge")
    build.add_argument("--out", type=Path, required=True)
    assembly = commands.add_parser("assemble", help="assemble both native targets and verified registry archives")
    assembly.add_argument("--native-root", type=Path, required=True)
    assembly.add_argument("--out", type=Path, required=True)
    verify = commands.add_parser("check", help="verify final artifact checksums, metadata and archive contents")
    verify.add_argument("--dir", type=Path, required=True)
    verify.add_argument("--version", required=True)
    consumer = commands.add_parser("smoke", help="install and execute an existing npm archive without Rust on PATH")
    consumer.add_argument("--archive", type=Path, required=True)
    options = parser.parse_args(arguments)
    try:
        if options.command == "native":
            native(options.out.absolute())
        elif options.command == "assemble":
            assemble(options.native_root.absolute(), options.out.absolute())
        elif options.command == "check":
            if version() != options.version:
                raise ReleaseError("Requested release version must match the checkout")
            check(options.dir.absolute(), options.version, source_sha())
        else:
            smoke(options.archive.absolute())
        print(f"Release {options.command} completed.", flush=True)
        return 0
    except (OSError, ValueError, KeyError, TypeError, tarfile.TarError, ReleaseError) as error:
        print(f"Release {options.command} failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
