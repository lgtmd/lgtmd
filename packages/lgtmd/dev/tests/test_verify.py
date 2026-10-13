import importlib.util
import json
import os
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location("lgtmd_web_verify", Path(__file__).resolve().parents[1] / "verify.py")
VERIFY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFY)


class PortablePayloadTests(unittest.TestCase):
    def test_copy_has_only_portable_sources_and_preserves_fixture_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "source"
            destination = Path(temporary) / "copy"
            root.mkdir()
            (root / "src").mkdir()
            (root / "src/private-n3.rs").write_text("not portable", encoding="utf-8")
            (root / "Cargo.lock").write_text("host lock", encoding="utf-8")
            (root / "package.json").write_text(json.dumps({"workspaces": ["packages/lgtmd", "examples/lgtmd-web"]}), encoding="utf-8")
            (root / "package-lock.json").write_text("{}", encoding="utf-8")
            for relative in VERIFY.SOURCES:
                package = root / relative
                package.mkdir(parents=True)
                (package / "LICENSE").write_text("license", encoding="utf-8")
                for disposable in (".cache", "target", "node_modules", "dist", "native"):
                    (package / disposable).mkdir()
                    (package / disposable / "stale").write_text("do not copy", encoding="utf-8")
            fixture = root / "crates/lgtmd/tests/fixtures/target/.ownership.json"
            fixture.parent.mkdir(parents=True)
            fixture.write_text("fixture bytes", encoding="utf-8")
            VERIFY.payload(root, destination)
            self.assertEqual((destination / "Cargo.toml").read_text(encoding="utf-8"), VERIFY.WORKSPACE)
            self.assertFalse((destination / "Cargo.lock").exists())
            self.assertFalse((destination / "src").exists())
            self.assertEqual((destination / "crates/lgtmd/tests/fixtures/target/.ownership.json").read_text(encoding="utf-8"), "fixture bytes")
            for relative in VERIFY.SOURCES:
                self.assertTrue((destination / relative / "LICENSE").exists())
                for disposable in (".cache", "target", "node_modules", "dist", "native"):
                    self.assertFalse((destination / relative / disposable).exists())

    def test_relative_explicit_cargo_overrides_keep_the_invocation_base(self):
        with tempfile.TemporaryDirectory() as temporary, mock.patch.dict(os.environ, {"CARGO_HOME": "cache/cargo", "CARGO_TARGET_DIR": "cache/target", "npm_config_cache": "cache/npm"}):
            environment = VERIFY.environment_for(Path(temporary))
            self.assertEqual(environment["CARGO_HOME"], str(Path.cwd() / "cache/cargo"))
            self.assertEqual(environment["CARGO_TARGET_DIR"], str(Path.cwd() / "cache/target"))
            self.assertEqual(environment["npm_config_cache"], str(Path.cwd() / "cache/npm"))

    def test_main_preserves_source_toolchain_for_disposable_cargo_consumer(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve() / "source with spaces"
            sdk = root / "packages/lgtmd"
            sdk.mkdir(parents=True)
            commands = root / "commands"
            commands.mkdir()
            rustup = commands / "rustup"
            rustup.write_text(
                '#!/bin/sh\n'
                'test "$PWD" = "$LGTMD_TEST_SOURCE" || exit 9\n'
                'printf "%s\\n" "1.95.0-test (directory override)"\n'
            )
            rustup.chmod(0o755)
            cargo = commands / "cargo"
            cargo.write_text('#!/bin/sh\nprintf "%s\\n" "${RUSTUP_TOOLCHAIN:-1.92.0-fallback}"\n')
            cargo.chmod(0o755)
            captured = []

            def consumer_check(source, cargo_command, environment, offline, install_browser):
                self.assertEqual(source, root)
                with tempfile.TemporaryDirectory() as consumer:
                    captured.append(VERIFY.run(cargo_command, cwd=consumer, environment=environment, capture=True))

            environment = {"PATH": str(commands), "LGTMD_TEST_SOURCE": str(root)}
            with mock.patch.dict(os.environ, environment, clear=True), mock.patch.object(VERIFY, "checks", side_effect=consumer_check):
                self.assertEqual(VERIFY.main([], sdk=sdk), 0)
                self.assertNotIn("RUSTUP_TOOLCHAIN", os.environ)
            self.assertEqual(captured, ["1.95.0-test\n"])

    def test_explicit_toolchain_precedes_environment_without_rustup_discovery(self):
        with mock.patch.dict(os.environ, {"RUSTUP_TOOLCHAIN": "nightly-custom"}, clear=True), mock.patch.object(VERIFY.shutil, "which") as which:
            prepared = VERIFY.environment_for(Path.cwd(), "1.95.0")
            self.assertEqual(prepared["RUSTUP_TOOLCHAIN"], "1.95.0")
            self.assertEqual(os.environ["RUSTUP_TOOLCHAIN"], "nightly-custom")
            self.assertEqual(VERIFY.environment_for(Path.cwd())["RUSTUP_TOOLCHAIN"], "nightly-custom")
            which.assert_not_called()

    def test_system_cargo_needs_no_available_or_configured_rustup(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with mock.patch.object(VERIFY.shutil, "which", return_value=None):
                self.assertNotIn("RUSTUP_TOOLCHAIN", VERIFY.environment_for(Path.cwd()))
            with mock.patch.object(VERIFY.shutil, "which", return_value="/optional/rustup"), mock.patch.object(VERIFY.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, stdout="")):
                self.assertNotIn("RUSTUP_TOOLCHAIN", VERIFY.environment_for(Path.cwd()))


if __name__ == "__main__":
    unittest.main()
