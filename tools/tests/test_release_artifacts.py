"""Release gates reject incomplete, mismatched, tampered and unsafe artifacts."""

import hashlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("release_artifacts", ROOT / "tools/release_artifacts.py")
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)
SHA = "a" * 40
VERSION = "0.1.0-alpha.1"


def binary(tag):
    if tag == "darwin-arm64":
        return b"\xcf\xfa\xed\xfe" + struct.pack("<I", 0x0100000C) + bytes(56)
    data = bytearray(64)
    data[:6] = b"\x7fELF\x02\x01"
    data[18:20] = struct.pack("<H", 62)
    return bytes(data)


def archive(path, prefix, files):
    with tarfile.open(path, "w:gz") as target:
        for name, (data, mode) in files.items():
            member = tarfile.TarInfo(f"{prefix}/{name}")
            member.size, member.mode = len(data), mode
            target.addfile(member, io.BytesIO(data))


class Artifacts(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.output = self.root / "release"
        self.output.mkdir()
        self.npm = self.output / f"lgtmd-{VERSION}.tgz"
        self.crate = self.output / f"lgtmd-{VERSION}.crate"
        package = {
            "name": "lgtmd", "version": VERSION, "type": "module", "license": "MIT",
            "bin": {"lgtmd": "./dist/src/cli.js"},
            "repository": {"type": "git", "url": release.REPOSITORY, "directory": "packages/lgtmd"},
        }
        self.npm_files = {name: (b"content", 0o644) for name in [
            "LICENSE", "README.md", "dist/src/index.js", "dist/src/index.d.ts",
            "dist/src/playwright/index.js", "dist/src/playwright/index.d.ts", "dist/src/playwright/reporter.js",
        ]}
        self.npm_files.update({
            "dist/src/cli.js": (b"#!/usr/bin/env node\n", 0o755),
        })
        self.npm_files["package.json"] = (json.dumps(package).encode(), 0o644)
        self.native = {tag: binary(tag) for tag in release.TARGETS}
        self.npm_files.update({f"native/{tag}/lgtmd": (data, 0o755) for tag, data in self.native.items()})
        self.crate_files = {name: (b"content", 0o644) for name in ["LICENSE", "README.md", "src/lib.rs", "Cargo.toml.orig"]}
        self.crate_files["Cargo.toml"] = ((
            f'[package]\nname = "lgtmd"\nversion = "{VERSION}"\nlicense = "MIT"\n'
            'repository = "https://github.com/lgtmd/lgtmd"\n'
        ).encode(), 0o644)
        self.crate_files[".cargo_vcs_info.json"] = (
            json.dumps({"git": {"sha1": SHA}, "path_in_vcs": "crates/lgtmd"}).encode(), 0o644,
        )
        self.write_archives()

    def write_archives(self):
        archive(self.npm, "package", self.npm_files)
        archive(self.crate, f"lgtmd-{VERSION}", self.crate_files)
        self.manifest = {
            "schema_version": 1, "source_sha": SHA, "version": VERSION,
            "native_targets": {tag: hashlib.sha256(data).hexdigest() for tag, data in self.native.items()},
            "files": {path.name: release.digest(path) for path in [self.npm, self.crate]},
        }
        self.write_manifest()

    def write_manifest(self):
        release.write_json(self.output / "manifest.json", self.manifest)

    def assert_invalid(self, message=None):
        with self.assertRaisesRegex(release.ReleaseError, message or ".+"):
            release.check(self.output, VERSION, SHA)

    def test_complete_release_has_two_native_targets(self):
        self.assertEqual(release.check(self.output, VERSION, SHA), self.manifest)

    def test_source_receipt_requires_clean_maintained_source(self):
        with patch.dict(release.os.environ, {"GITHUB_SHA": SHA}, clear=True):
            with patch.object(release, "run", side_effect=[SHA + "\n", ""]):
                self.assertEqual(release.source_sha(self.root), SHA)
            for status in [" M crates/lgtmd/src/lib.rs\n", "?? untracked-source.rs\n"]:
                with self.subTest(status=status), patch.object(release, "run", side_effect=[SHA + "\n", status]):
                    with self.assertRaisesRegex(release.ReleaseError, "clean source checkout"):
                        release.source_sha(self.root)

    def test_cargo_archive_retains_its_maintained_ignore_file(self):
        self.crate_files[".gitignore"] = (b"/target/\n/.cache/\n", 0o644)
        self.write_archives()
        self.assertEqual(release.check(self.output, VERSION, SHA), self.manifest)

    def test_changed_archive_bytes_fail_before_installation(self):
        self.npm.write_bytes(self.npm.read_bytes() + b"tampered")
        self.assert_invalid("checksum mismatch")

    def test_changed_embedded_binary_fails_even_if_archive_receipt_is_updated(self):
        name = "native/linux-x64/lgtmd"
        data, mode = self.npm_files[name]
        self.npm_files[name] = (data + b"tampered", mode)
        self.write_archives()
        self.assert_invalid("native binary checksum mismatch")

    def test_missing_native_and_permissions_are_rejected(self):
        name = "native/darwin-arm64/lgtmd"
        original = self.npm_files.pop(name)
        self.write_archives()
        self.assert_invalid("missing required payload")
        self.npm_files[name] = (original[0], 0o644)
        self.write_archives()
        self.assert_invalid("permissions")

    def test_wrong_native_architecture_is_rejected(self):
        name = "native/darwin-arm64/lgtmd"
        self.npm_files[name] = (self.native["linux-x64"], 0o755)
        self.write_archives()
        self.assert_invalid("does not match darwin-arm64")

    def test_npm_version_repository_and_install_scripts_are_checked(self):
        original = json.loads(self.npm_files["package.json"][0])
        variants = [
            {**original, "version": "9.0.0"},
            {**original, "private": True},
            {**original, "repository": {"url": "https://github.com/another/repository"}},
            {**original, "scripts": {"postinstall": "cargo build"}},
        ]
        for package in variants:
            with self.subTest(package=package):
                self.npm_files["package.json"] = (json.dumps(package).encode(), 0o644)
                self.write_archives()
                self.assert_invalid()

    def test_crate_version_revision_and_dirty_source_are_checked(self):
        original_manifest = self.crate_files["Cargo.toml"]
        self.crate_files["Cargo.toml"] = (original_manifest[0].replace(VERSION.encode(), b"9.0.0"), 0o644)
        self.write_archives()
        self.assert_invalid("Cargo package")
        self.crate_files["Cargo.toml"] = original_manifest
        for vcs in [
            {"git": {"sha1": "b" * 40}, "path_in_vcs": "crates/lgtmd"},
            {"git": {"sha1": SHA, "dirty": True}, "path_in_vcs": "crates/lgtmd"},
        ]:
            with self.subTest(vcs=vcs):
                self.crate_files[".cargo_vcs_info.json"] = (json.dumps(vcs).encode(), 0o644)
                self.write_archives()
                self.assert_invalid("clean release source")

    def test_manifest_revision_version_targets_and_types_are_checked(self):
        original = self.manifest.copy()
        for change in [
            {"source_sha": "b" * 40}, {"version": "9.0.0"},
            {"native_targets": {"darwin-arm64": "a" * 64}},
            {"native_targets": []}, {"files": []}, {"schema_version": True},
        ]:
            with self.subTest(change=change):
                self.manifest = {**original, **change}
                self.write_manifest()
                self.assert_invalid("manifest")

    def test_unintended_payload_is_rejected(self):
        self.npm_files["src/private.ts"] = (b"unintended", 0o644)
        self.write_archives()
        self.assert_invalid("Unexpected npm archive payload")

    def test_cli_and_native_inventory_are_complete(self):
        original = self.npm_files.copy()
        for missing in ("native/linux-x64/lgtmd", "native/darwin-arm64/lgtmd", "dist/src/cli.js"):
            self.npm_files = original.copy()
            del self.npm_files[missing]
            self.write_archives()
            self.assert_invalid()
        self.npm_files = original.copy()
        self.npm_files["viewer/private.json"] = (b"private", 0o644)
        self.write_archives()
        self.assert_invalid("Unexpected npm archive payload")

    def test_cli_permissions_and_loose_viewer_are_rejected(self):
        self.npm_files["dist/src/cli.js"] = (b"#!/usr/bin/env node\n", 0o644)
        self.write_archives()
        self.assert_invalid("CLI")
        self.npm_files["dist/src/cli.js"] = (b"#!/usr/bin/env node\n", 0o755)
        self.npm_files["viewer/manifest.json"] = (json.dumps({"index.html": {"file": "assets/../private.js"}}).encode(), 0o644)
        self.write_archives()
        self.assert_invalid("Unexpected npm archive payload")

    def test_retired_typescript_host_cannot_reenter_archive(self):
        self.npm_files["dist/src/cli/server.js"] = (b"stale host", 0o644)
        self.write_archives()
        self.assert_invalid("Unexpected npm archive payload")

    def test_archive_traversal_links_and_duplicates_are_rejected(self):
        for name, kind in [
            ("package/../escape", tarfile.REGTYPE), ("/package/absolute", tarfile.REGTYPE),
            ("package/./dot", tarfile.REGTYPE), ("package\\windows", tarfile.REGTYPE),
            ("package/link", tarfile.SYMTYPE), ("package/link", tarfile.LNKTYPE),
        ]:
            with self.subTest(name=name, kind=kind):
                path = self.root / "unsafe.tgz"
                with tarfile.open(path, "w:gz") as target:
                    member = tarfile.TarInfo(name)
                    member.type, member.linkname = kind, "/outside"
                    target.addfile(member, io.BytesIO())
                with self.assertRaises(release.ReleaseError):
                    release.archive_files(path, "package")
        with tarfile.open(path, "w:gz") as target:
            for _ in range(2):
                target.addfile(tarfile.TarInfo("package/duplicate"), io.BytesIO())
        with self.assertRaisesRegex(release.ReleaseError, "Duplicate"):
            release.archive_files(path, "package")

    def test_native_receipts_require_complete_matching_untampered_pair(self):
        directory = self.root / "native"
        directory.mkdir()
        for tag, data in self.native.items():
            folder = directory / tag
            folder.mkdir()
            (folder / "lgtmd").write_bytes(data)
            release.write_json(folder / "receipt.json", {
                "schema_version": 1, "source_sha": SHA, "version": VERSION,
                "tag": tag, "sha256": hashlib.sha256(data).hexdigest(),
            })
        self.assertEqual(release.native_receipts(directory, SHA, VERSION), self.manifest["native_targets"])
        with self.assertRaisesRegex(release.ReleaseError, "receipt"):
            release.native_receipts(directory, "b" * 40, VERSION)
        with self.assertRaisesRegex(release.ReleaseError, "receipt"):
            release.native_receipts(directory, SHA, "9.0.0")
        binary_path = directory / "linux-x64/lgtmd"
        binary_path.write_bytes(binary_path.read_bytes() + b"tampered")
        with self.assertRaisesRegex(release.ReleaseError, "receipt"):
            release.native_receipts(directory, SHA, VERSION)
        (directory / "linux-x64/receipt.json").unlink()
        with self.assertRaisesRegex(release.ReleaseError, "inventory"):
            release.native_receipts(directory, SHA, VERSION)


class ExistingArchiveConsumer(unittest.TestCase):
    def test_supplied_archive_is_installed_without_repacking_or_rust(self):
        spec = importlib.util.spec_from_file_location("web_verify", ROOT / "packages/lgtmd/dev/verify.py")
        verify = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(verify)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "package.json").write_text(json.dumps({"devDependencies": {"@playwright/test": "1.64.0"}}))
            archive_path = root / "prepared.tgz"
            archive_path.write_bytes(b"already assembled")
            calls = []

            def run(command, *, cwd, environment, **kwargs):
                calls.append(command)
                self.assertIsNone(verify.shutil.which("cargo", path=environment["PATH"]))
                self.assertIsNone(verify.shutil.which("rustc", path=environment["PATH"]))
                if command[1] == "install":
                    package = json.loads((cwd / "package.json").read_text())
                    self.assertEqual(package["dependencies"]["lgtmd"], f"file:{archive_path.resolve()}")

            with patch.object(verify, "run", side_effect=run):
                verify.npm_consumer(root, sys.executable, "npm", {}, False, archive=archive_path)
            self.assertFalse(any("pack" in call for call in calls))
            self.assertEqual(sum("install" in call for call in calls), 2)


if __name__ == "__main__":
    unittest.main()
