import importlib.util
import json
import os
import shutil
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
            (root / "package.json").write_text(json.dumps({"workspaces": ["packages/lgtmd", "packages/viewer", "examples/lgtmd-web", "examples/review"]}), encoding="utf-8")
            (root / "package-lock.json").write_text("{}", encoding="utf-8")
            (root / "lgtmd.config.json").write_text("{}", encoding="utf-8")
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

    def test_standalone_cargo_targets_are_unique_and_cleaned_after_success_or_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve() / "source"
            sdk = root / "packages/lgtmd"
            sdk.mkdir(parents=True)
            target_root = root / "shared target"
            target_root.mkdir()
            retained = target_root / "native-artifact"
            retained.write_text("untouched")
            targets = []

            def compiled_check(source, cargo, environment, offline, install_browser, *, diagnostics_root):
                target = Path(environment["CARGO_TARGET_DIR"])
                self.assertEqual(target.parent, target_root)
                marker = target / "compiled-manifest-dir"
                self.assertFalse(marker.exists())
                marker.write_text(str(source))
                targets.append(target)
                if len(targets) == 2:
                    raise VERIFY.VerificationError("intentional standalone failure")

            environment = {"CARGO_TARGET_DIR": str(target_root), "RUSTUP_TOOLCHAIN": "test"}
            with mock.patch.dict(os.environ, environment, clear=True), mock.patch.object(VERIFY, "payload", side_effect=lambda source, destination: destination), mock.patch.object(VERIFY, "run"), mock.patch.object(VERIFY, "checks", side_effect=compiled_check):
                self.assertEqual(VERIFY.main(["--standalone"], sdk=sdk), 0)
                self.assertEqual(VERIFY.main(["--standalone"], sdk=sdk), 1)
                self.assertEqual(os.environ["CARGO_TARGET_DIR"], str(target_root))
            self.assertNotEqual(*targets)
            self.assertTrue(all(not target.exists() for target in targets))
            self.assertEqual(retained.read_text(), "untouched")
            with mock.patch.dict(os.environ, environment, clear=True), mock.patch.object(VERIFY, "checks") as checks:
                self.assertEqual(VERIFY.main([], sdk=sdk), 0)
                self.assertEqual(checks.call_args.args[2]["CARGO_TARGET_DIR"], str(target_root))

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

            def consumer_check(source, cargo_command, environment, offline, install_browser, *, diagnostics_root):
                self.assertEqual(source, root)
                self.assertEqual(diagnostics_root, root / ".cache/lgtmd-web/diagnostics")
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


class EmbeddedViewerPreparationTests(unittest.TestCase):
    def test_native_staging_replaces_inode_preserves_mode_and_leaves_open_old_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            binary = root / "compiled"
            binary.write_bytes(b"new signed executable")
            binary.chmod(0o751)
            native = root / "native/lgtmd"
            native.parent.mkdir()
            native.write_bytes(b"previous executable")
            before = native.stat().st_ino
            with native.open("rb") as running:
                VERIFY.stage_native(binary, native)
                self.assertNotEqual(native.stat().st_ino, before)
                self.assertEqual(running.read(), b"previous executable")
            self.assertEqual(native.read_bytes(), binary.read_bytes())
            self.assertEqual(native.stat().st_mode & 0o777, 0o751)
            self.assertEqual(list(native.parent.iterdir()), [native])

    def test_failed_native_staging_keeps_previous_executable_and_removes_partial_copy(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            binary = root / "compiled"
            binary.write_bytes(b"new executable")
            native = root / "native/lgtmd"
            native.parent.mkdir()
            native.write_bytes(b"previous executable")
            before = native.stat().st_ino
            def interrupted(source, destination):
                Path(destination).write_bytes(b"partial")
                raise OSError("copy interrupted")
            with mock.patch.object(VERIFY.shutil, "copy2", side_effect=interrupted):
                with self.assertRaisesRegex(OSError, "copy interrupted"):
                    VERIFY.stage_native(binary, native)
            self.assertEqual(native.stat().st_ino, before)
            self.assertEqual(native.read_bytes(), b"previous executable")
            self.assertEqual(list(native.parent.iterdir()), [native])

    def test_preparation_builds_frontend_before_native_and_retires_old_bridge(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "packages/lgtmd/viewer"
            source.mkdir(parents=True)
            (source / "index.html").write_text("prepared HTML")
            (source / "manifest.json").write_text("{}")
            native = root / "packages/lgtmd/native/darwin-arm64"
            native.mkdir(parents=True)
            (native / "lgtmd-node").write_text("old bridge")
            binary = root / "target/release/lgtmd"
            binary.parent.mkdir(parents=True)
            binary.write_text("native with embedded viewer")
            calls = []
            def step(command, **kwargs):
                calls.append(command)
                if "cargo" == command[0]:
                    self.assertEqual((root / "crates/lgtmd-cli/viewer/index.html").read_text(), "prepared HTML")
            with mock.patch.object(VERIFY, "run", side_effect=step):
                VERIFY.prepare(root, ["cargo"], {"CARGO_TARGET_DIR": str(root / "target")}, True, "npm", "darwin-arm64")
            self.assertEqual(calls[0][:2], ["npm", "ci"])
            self.assertEqual(calls[1], ["npm", "run", "build"])
            self.assertIn("lgtmd-cli", calls[2])
            self.assertFalse((native / "lgtmd-node").exists())
            self.assertEqual((native / "lgtmd").read_bytes(), binary.read_bytes())

    def test_viewer_staging_rejects_missing_or_symlink_assets(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaises(VERIFY.VerificationError):
                VERIFY.stage_viewer(root)
            source = root / "packages/lgtmd/viewer"
            source.mkdir(parents=True)
            (source / "index.html").write_text("HTML")
            (source / "manifest.json").write_text("{}")
            (source / "escaped").symlink_to(root)
            with self.assertRaises(VERIFY.VerificationError):
                VERIFY.stage_viewer(root)


class PackagedCliFailureTests(unittest.TestCase):
    def test_failed_preview_exits_instead_of_waiting_for_already_delivered_close(self):
        node = shutil.which("node")
        self.assertIsNotNone(node, "CLI verification requires Node.js")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cli = root / "node_modules/lgtmd/dist/src/cli.js"
            cli.parent.mkdir(parents=True)
            cli.write_text(
                "const fs = require('node:fs');\n"
                "if (process.argv[2] === '--help') console.log('dev');\n"
                "else if (process.argv[2] === 'build') fs.writeFileSync('runs', 'x');\n"
                "else { console.error('deliberate broken preview'); process.exitCode = 23; }\n",
                encoding="utf-8",
            )
            binary = root / "node_modules/.bin/lgtmd"
            binary.parent.mkdir()
            binary.symlink_to(cli)
            smoke = root / "smoke.mjs"
            smoke.write_text(VERIFY.CLI_SMOKE, encoding="utf-8")
            result = subprocess.run([node, str(smoke)], cwd=root, capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("deliberate broken preview", result.stderr)


class BrowserDiagnosticsTests(unittest.TestCase):
    def test_failed_check_keeps_baseline_and_actual_without_recapture(self):
        failure = VERIFY.VerificationError("artifact changed")
        commands = []
        with tempfile.TemporaryDirectory() as temporary:
            durable = Path(temporary) / "diagnostics"
            with tempfile.TemporaryDirectory() as disposable:
                root = Path(disposable)

                def browser_run(command, *, cwd, environment):
                    commands.append(command[2])
                    self.assertEqual(cwd, root)
                    if command[2] == "build":
                        baseline = Path(command[3]) / "reader/assets/matching-records.png"
                        baseline.parent.mkdir(parents=True)
                        baseline.write_bytes(b"baseline PNG bytes")
                    else:
                        actual = root / "examples/lgtmd-web/.cache/playwright/test/matching-records.png"
                        actual.parent.mkdir(parents=True)
                        actual.write_bytes(b"actual PNG bytes from failed check")
                        (actual.parent / "trace.zip").write_bytes(b"same run trace")
                        raise failure

                with mock.patch.object(VERIFY, "run", side_effect=browser_run):
                    with self.assertRaises(VERIFY.VerificationError) as raised:
                        VERIFY.browser_example(root, "node", {}, durable)
                self.assertIs(raised.exception, failure)
            # The original standalone workspace and review temporary are gone.
            retained, = durable.iterdir()
            self.assertEqual((retained / "baseline/reader/assets/matching-records.png").read_bytes(), b"baseline PNG bytes")
            self.assertEqual((retained / "playwright/test/matching-records.png").read_bytes(), b"actual PNG bytes from failed check")
            self.assertEqual((retained / "playwright/test/trace.zip").read_bytes(), b"same run trace")
            self.assertIn("artifact changed", (retained / "failure.txt").read_text())
            self.assertEqual(commands, ["build", "check"])

    def test_standalone_failure_uses_original_checkout_for_diagnostics(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve() / "source"
            sdk = root / "packages/lgtmd"
            sdk.mkdir(parents=True)
            isolated_roots = []

            def failed_checks(isolated, cargo, environment, offline, install_browser, *, diagnostics_root):
                self.assertNotEqual(isolated, root)
                isolated_roots.append(isolated)
                self.assertEqual(diagnostics_root, root / ".cache/lgtmd-web/diagnostics")
                diagnostics_root.mkdir(parents=True)
                (diagnostics_root / "same-run.png").write_bytes(b"retained from isolated run")
                raise VERIFY.VerificationError("standalone browser comparison failed")

            with mock.patch.object(VERIFY, "payload", side_effect=lambda source, destination: destination), mock.patch.object(VERIFY, "run"), mock.patch.object(VERIFY, "checks", side_effect=failed_checks):
                self.assertEqual(VERIFY.main(["--standalone"], sdk=sdk), 1)
            self.assertFalse(isolated_roots[0].exists())
            self.assertEqual((root / ".cache/lgtmd-web/diagnostics/same-run.png").read_bytes(), b"retained from isolated run")

    def test_retention_error_does_not_replace_original_failure(self):
        failure = VERIFY.VerificationError("original comparison failed")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with mock.patch.object(VERIFY, "run", side_effect=failure), mock.patch.object(VERIFY.Path, "mkdir", side_effect=OSError("diagnostics unavailable")):
                with self.assertRaises(VERIFY.VerificationError) as raised:
                    VERIFY.browser_example(root, "node", {}, root / "diagnostics")
            self.assertIs(raised.exception, failure)

    def test_success_has_no_retained_failure_artifacts(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            durable = root / "diagnostics"
            with mock.patch.object(VERIFY, "run") as run:
                VERIFY.browser_example(root, "node", {}, durable)
            self.assertEqual([call.args[0][2] for call in run.call_args_list], ["build", "check", "check", "check"])
            self.assertFalse(durable.exists())


if __name__ == "__main__":
    unittest.main()
