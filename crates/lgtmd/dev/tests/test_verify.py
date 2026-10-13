import contextlib
import importlib.util
import io
import os
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("portable_verify", Path(__file__).resolve().parents[1] / "verify.py")
verify = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verify)


class PortableVerificationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name) / "host with spaces $(not-a-command)"
        self.sdk = self.root / "crates/lgtmd"
        self.example = self.root / "crates/doc-example-config"
        for package in (self.sdk, self.example):
            (package / "src").mkdir(parents=True)
            (package / "src/lib.rs").write_text("// Portable source.\n")
            (package / "Cargo.toml").write_text('[package]\nlicense = "MIT"\n')
            (package / "README.md").write_text("# Package\n")
            (package / "LICENSE").write_text("MIT License\nCopyright notice\n")

    def test_copy_preserves_baselines_and_license_without_host_dependencies_or_output(self):
        (self.root / "Cargo.toml").write_text("host patches and graphics dependencies\n")
        (self.root / "Cargo.lock").write_text("host lockfile\n")
        (self.root / "rust-toolchain.toml").write_text("host toolchain pin\n")
        baseline = self.example / "baseline/reader"
        baseline.mkdir(parents=True)
        (baseline / "manifest.json").write_bytes(b'{"exact":"baseline"}\n')
        (baseline / ".ownership.json").write_bytes(b'{"owned":"receipt"}\n')
        download = baseline / "assets/target/Cargo.lock"
        download.parent.mkdir(parents=True)
        download.write_bytes(b"An owned download, not a build lockfile.\n")
        private_download = baseline / "assets/.cache/__pycache__/receipt.txt"
        private_download.parent.mkdir(parents=True)
        private_download.write_bytes(b"Owned bytes also survive cache-like names.\n")
        for excluded in (".cache", "target", "__pycache__"):
            (self.sdk / excluded).mkdir()
            (self.sdk / excluded / "disposable").write_text("ignored\n")
        (self.sdk / "Cargo.lock").write_text("package lockfile is not portable input\n")
        destination = self.root.parent / "isolated"
        copied = verify.payload(self.sdk, destination)
        self.assertEqual(copied, destination / "crates/lgtmd")
        self.assertNotIn("host", (destination / "Cargo.toml").read_text())
        self.assertFalse((destination / "Cargo.lock").exists())
        self.assertFalse((destination / "rust-toolchain.toml").exists())
        for excluded in (".cache", "target", "__pycache__", "Cargo.lock"):
            self.assertFalse((copied / excluded).exists())
        for package in ("lgtmd", "doc-example-config"):
            self.assertEqual((destination / "crates" / package / "LICENSE").read_bytes(), b"MIT License\nCopyright notice\n")
        copied_baseline = destination / "crates/doc-example-config/baseline/reader"
        for name in ("manifest.json", ".ownership.json"):
            self.assertEqual((copied_baseline / name).read_bytes(), (baseline / name).read_bytes())
        self.assertEqual((copied_baseline / "assets/target/Cargo.lock").read_bytes(), download.read_bytes())
        self.assertEqual((copied_baseline / "assets/.cache/__pycache__/receipt.txt").read_bytes(), private_download.read_bytes())

    def test_copy_fails_if_provenance_is_missing(self):
        (self.example / "LICENSE").unlink()
        with self.assertRaisesRegex(OSError, "LICENSE"):
            verify.payload(self.sdk, self.root.parent / "isolated")

    def test_standalone_resolves_a_temporary_lock_and_failure_stops_the_gate(self):
        calls = []

        def fail_resolution(command, *, cwd, environment):
            calls.append((command, cwd, environment))
            self.assertTrue((cwd.parent.parent / "Cargo.toml").exists())
            self.assertFalse((cwd.parent.parent / "Cargo.lock").exists())
            return 17

        with patch.object(verify, "run", side_effect=fail_resolution):
            self.assertEqual(verify.main(["--standalone", "--toolchain", "1.95.0", "--offline"], sdk=self.sdk), 17)
        self.assertEqual(calls[0][0], ["cargo", "+1.95.0", "generate-lockfile", "--offline"])
        self.assertEqual(len(calls), 1)
        self.assertFalse(calls[0][1].exists())
        self.assertFalse((self.root / "Cargo.lock").exists())

    def test_standalone_artifacts_never_reuse_native_or_previous_copied_sources(self):
        target_root = self.root / "shared target"
        target_root.mkdir()
        retained = target_root / "native-artifact"
        retained.write_text("untouched")
        targets = []

        def compiled_check(sdk, cargo, environment, offline):
            target = Path(environment["CARGO_TARGET_DIR"])
            self.assertEqual(target.parent, target_root.resolve())
            # Model a compile-time source path embedded in a cached executable.
            marker = target / "compiled-manifest-dir"
            self.assertFalse(marker.exists())
            marker.write_text(str(sdk))
            targets.append(target)
            return 0 if len(targets) == 1 else 19

        environment = {"CARGO_TARGET_DIR": str(target_root), "RUSTUP_TOOLCHAIN": "test"}
        with patch.dict(os.environ, environment, clear=True), patch.object(verify, "run", return_value=0), patch.object(verify, "checks", side_effect=compiled_check):
            self.assertEqual(verify.main(["--standalone"], sdk=self.sdk), 0)
            self.assertEqual(verify.main(["--standalone"], sdk=self.sdk), 19)
            self.assertEqual(os.environ["CARGO_TARGET_DIR"], str(target_root))
        self.assertNotEqual(*targets)
        self.assertTrue(all(not target.exists() for target in targets))
        self.assertEqual(retained.read_text(), "untouched")
        with patch.dict(os.environ, environment, clear=True), patch.object(verify, "checks", return_value=0) as checks:
            self.assertEqual(verify.main([], sdk=self.sdk), 0)
            self.assertEqual(checks.call_args.args[2]["CARGO_TARGET_DIR"], str(target_root))

    def test_failing_consumer_checks_stop_before_doctests_and_docs(self):
        calls = []

        def fail_tests(command, *, cwd, environment):
            calls.append(command)
            return 19 if "--all-targets" in command and "test" in command else 0

        with patch.object(verify, "run", side_effect=fail_tests):
            self.assertEqual(verify.main([], sdk=self.sdk), 19)
        self.assertEqual(len(calls), 4)
        self.assertFalse(any("doc" in command or "--doc" in command for command in calls))

    def test_environment_keeps_explicit_caches_and_doc_flags_without_mutating_caller(self):
        environment = {"CARGO_TARGET_DIR": "/explicit target", "CARGO_HOME": "/explicit cargo", "RUSTDOCFLAGS": "--cfg custom"}
        with patch.dict(os.environ, environment, clear=True):
            prepared = verify.environment_for(self.sdk, True)
            self.assertEqual(prepared["CARGO_TARGET_DIR"], "/explicit target")
            self.assertEqual(prepared["CARGO_HOME"], "/explicit cargo")
            self.assertNotIn("PYTHONDONTWRITEBYTECODE", os.environ)
            with patch.object(verify, "run", return_value=0) as run:
                self.assertEqual(verify.checks(self.sdk, ["cargo"], prepared, False), 0)
            docs = run.call_args.kwargs["environment"]
            self.assertEqual(docs["RUSTDOCFLAGS"], "--cfg custom -D warnings")
            self.assertEqual(prepared["RUSTDOCFLAGS"], "--cfg custom")

    def test_relative_caches_keep_the_invocation_location_when_check_cwd_changes(self):
        for standalone in (False, True):
            with self.subTest(standalone=standalone), patch.dict(os.environ, {
                "CARGO_HOME": "cache with spaces $(not-a-command)",
                "CARGO_TARGET_DIR": "../shared target",
            }, clear=True), patch.object(verify.Path, "cwd", return_value=self.root):
                prepared = verify.environment_for(self.sdk, standalone)
                self.assertEqual(prepared["CARGO_HOME"], str(self.root / "cache with spaces $(not-a-command)"))
                self.assertEqual(prepared["CARGO_TARGET_DIR"], str(self.root / "../shared target"))
                self.assertEqual(os.environ["CARGO_HOME"], "cache with spaces $(not-a-command)")
        with patch.dict(os.environ, {"CARGO_HOME": "", "CARGO_TARGET_DIR": ""}, clear=True):
            prepared = verify.environment_for(self.sdk, True)
            self.assertEqual(prepared["CARGO_HOME"], "")
            self.assertEqual(prepared["CARGO_TARGET_DIR"], "")

    def test_standalone_preserves_source_toolchain_in_temporary_workspace(self):
        commands = self.root / "commands"
        commands.mkdir()
        rustup = commands / "rustup"
        rustup.write_text(
            '#!/bin/sh\n'
            'test "$PWD" = "$LGTMD_TEST_SOURCE" || exit 9\n'
            'printf "%s\\n" "1.95.0-test (directory override)"\n'
        )
        rustup.chmod(0o755)
        cargo = commands / "cargo"
        cargo.write_text(
            '#!/bin/sh\n'
            'printf "%s\\n" "${RUSTUP_TOOLCHAIN:-1.92.0-fallback}" > "$LGTMD_TEST_RESULT"\n'
        )
        cargo.chmod(0o755)
        receipt = self.root / "toolchain.txt"
        environment = {
            "PATH": str(commands), "LGTMD_TEST_SOURCE": str(self.sdk.resolve()),
            "LGTMD_TEST_RESULT": str(receipt),
        }
        with patch.dict(os.environ, environment, clear=True), patch.object(verify, "checks", return_value=0) as checks:
            self.assertEqual(verify.main(["--standalone"], sdk=self.sdk), 0)
            self.assertNotIn("RUSTUP_TOOLCHAIN", os.environ)
        self.assertEqual(receipt.read_text(), "1.95.0-test\n")
        isolated, cargo_command, prepared, _ = checks.call_args.args
        self.assertNotEqual(isolated, self.sdk)
        self.assertEqual(cargo_command, ["cargo"])
        self.assertEqual(prepared["RUSTUP_TOOLCHAIN"], "1.95.0-test")

    def test_explicit_toolchain_precedes_environment_without_rustup_discovery(self):
        with patch.dict(os.environ, {"RUSTUP_TOOLCHAIN": "nightly-custom"}, clear=True), patch.object(verify.shutil, "which") as which:
            prepared = verify.environment_for(self.sdk, True, "1.95.0")
            self.assertEqual(prepared["RUSTUP_TOOLCHAIN"], "1.95.0")
            self.assertEqual(os.environ["RUSTUP_TOOLCHAIN"], "nightly-custom")
            self.assertEqual(verify.environment_for(self.sdk, True)["RUSTUP_TOOLCHAIN"], "nightly-custom")
            which.assert_not_called()

    def test_system_cargo_needs_no_available_or_configured_rustup(self):
        with patch.dict(os.environ, {}, clear=True):
            with patch.object(verify.shutil, "which", return_value=None):
                self.assertNotIn("RUSTUP_TOOLCHAIN", verify.environment_for(self.sdk, True))
            with patch.object(verify.shutil, "which", return_value="/optional/rustup"), patch.object(verify.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, stdout="")):
                self.assertNotIn("RUSTUP_TOOLCHAIN", verify.environment_for(self.sdk, True))

    def test_missing_cargo_fails_visibly(self):
        output = io.StringIO()
        with contextlib.redirect_stderr(output), patch.object(verify, "run", side_effect=FileNotFoundError("cargo unavailable")):
            self.assertEqual(verify.main([], sdk=self.sdk), 1)
        self.assertIn("cargo unavailable", output.getvalue())


if __name__ == "__main__":
    unittest.main()
