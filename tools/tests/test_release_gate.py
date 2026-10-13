import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock
from urllib.error import HTTPError, URLError


SPEC = importlib.util.spec_from_file_location("release_gate", Path(__file__).resolve().parents[1] / "release_gate.py")
GATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GATE)
SHA = "a" * 40
VERSION = "0.1.0"
ENVIRONMENT = {
    "GITHUB_REPOSITORY": "lgtmd/lgtmd",
    "GITHUB_REF": "refs/heads/main",
    "GITHUB_SHA": SHA,
    "GITHUB_TOKEN": "test-read-only-token",
    "GITHUB_RUN_ID": "123",
}


def write_json(root, relative, value):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def fixture(root, version=VERSION):
    for relative, text in {
        "crates/lgtmd/Cargo.toml": f'''[package]
name = "lgtmd"
version = "{version}"
publish = ["crates-io"]
repository = "https://github.com/lgtmd/lgtmd"
''',
        "crates/lgtmd-node/Cargo.toml": f'''[package]
name = "lgtmd-node"
version = "{version}"
publish = false
[dependencies]
lgtmd = {{ path = "../lgtmd", version = "{version}" }}
''',
        "crates/doc-example-config/Cargo.toml": '''[package]
name = "doc-example-config"
version = "0.0.0"
publish = false
''',
        "Cargo.lock": f'''version = 4
[[package]]
name = "lgtmd"
version = "{version}"
[[package]]
name = "lgtmd-node"
version = "{version}"
''',
    }.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    workspace = {"private": True, "workspaces": ["packages/lgtmd", "examples/lgtmd-web"]}
    write_json(root, "package.json", workspace)
    write_json(root, "packages/lgtmd/package.json", {
        "name": "lgtmd", "version": version,
        "repository": {"type": "git", "url": "git+https://github.com/lgtmd/lgtmd.git", "directory": "packages/lgtmd"},
        "publishConfig": {"access": "public", "registry": "https://registry.npmjs.org"},
    })
    write_json(root, "examples/lgtmd-web/package.json", {"name": "@lgtmd/example-web", "version": "0.0.0", "private": True, "devDependencies": {"lgtmd": version}})
    write_json(root, "package-lock.json", {"lockfileVersion": 3, "packages": {
        "": workspace,
        "packages/lgtmd": {"version": version},
        "examples/lgtmd-web": {"version": "0.0.0", "devDependencies": {"lgtmd": version}},
        "node_modules/lgtmd": {"resolved": "packages/lgtmd", "link": True},
    }})


def clean_git(root, *arguments):
    if arguments == ("rev-parse", "HEAD"):
        return SHA
    if arguments == ("status", "--porcelain", "--untracked-files=normal"):
        return ""
    raise AssertionError(arguments)


def workflow():
    return {"id": 9, "name": "Verify", "path": ".github/workflows/ci.yml", "state": "active"}


def successful_run():
    return {
        "id": 55, "workflow_id": 9, "head_sha": SHA, "head_branch": "main",
        "event": "push", "status": "completed", "conclusion": "success",
        "path": ".github/workflows/ci.yml@refs/heads/main",
        "head_repository": {"full_name": "lgtmd/lgtmd"},
    }


def protected_environment():
    return {
        "id": 7, "name": "release", "can_admins_bypass": False,
        "protection_rules": [{"type": "required_reviewers", "reviewers": [
            {"type": "User", "reviewer": {"id": 42, "login": "maintainer", "type": "User"}},
        ]}],
        "deployment_branch_policy": {"protected_branches": False, "custom_branch_policies": True},
    }


def main_policy():
    return {"total_count": 1, "branch_policies": [{"id": 10, "name": "main", "type": "branch"}]}


def approval():
    return {"state": "approved", "environments": [{"id": 7, "name": "release"}], "user": {"id": 42, "login": "maintainer", "type": "User"}}


class SourceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        fixture(self.root)
        self.fetch = mock.Mock(side_effect=self.response)

    def response(self, url, **options):
        if url.endswith("actions/workflows/ci.yml"):
            return workflow()
        if "actions/workflows/ci.yml/runs?" in url:
            return {"workflow_runs": [successful_run()]}
        if url.startswith(("https://registry.npmjs.org/", "https://crates.io/")):
            self.assertEqual(options, {"missing_ok": True})
            return None
        raise AssertionError(url)

    def source(self, **options):
        return GATE.source(VERSION, "both", root=self.root, environment=ENVIRONMENT, fetch=self.fetch, git=clean_git, **options)

    def test_verify_validates_source_without_registry_or_environment_requests(self):
        fixture(self.root, "0.0.0")
        result = GATE.source("0.0.0", "both", root=self.root, environment=ENVIRONMENT, fetch=self.fetch, git=clean_git)
        self.assertFalse(result["publishing"])
        self.fetch.assert_not_called()

    def test_publish_requires_exact_successful_ci_and_absent_versions(self):
        result = self.source(publishing=True)
        self.assertEqual(result["verified_ci_run"], 55)
        self.assertEqual(len(self.fetch.call_args_list), 4)
        self.assertIn(f"head_sha={SHA}", self.fetch.call_args_list[1].args[0])

    def test_single_registry_target_does_not_probe_other_registry(self):
        GATE.source(VERSION, "crates", publishing=True, root=self.root, environment=ENVIRONMENT, fetch=self.fetch, git=clean_git)
        urls = [call.args[0] for call in self.fetch.call_args_list]
        self.assertTrue(any(url.startswith("https://crates.io/") for url in urls))
        self.assertFalse(any(url.startswith("https://registry.npmjs.org/") for url in urls))

    def test_wrong_checkout_repository_ref_sha_and_dirty_source_fail(self):
        for field, value in (("GITHUB_REPOSITORY", "fork/lgtmd"), ("GITHUB_REF", "refs/tags/v0.1.0"), ("GITHUB_SHA", "b" * 40)):
            with self.subTest(field=field), self.assertRaises(GATE.ReleaseError):
                GATE.source(VERSION, "both", root=self.root, environment={**ENVIRONMENT, field: value}, fetch=self.fetch, git=clean_git)
        with self.assertRaisesRegex(GATE.ReleaseError, "clean"):
            GATE.source(VERSION, "both", root=self.root, environment=ENVIRONMENT, fetch=self.fetch, git=lambda root, *args: SHA if args[0] == "rev-parse" else " M Cargo.lock")
        self.fetch.assert_not_called()

    def test_all_sdk_versions_and_locks_must_match(self):
        for relative in ("crates/lgtmd/Cargo.toml", "crates/lgtmd-node/Cargo.toml", "Cargo.lock", "packages/lgtmd/package.json", "package-lock.json"):
            with self.subTest(relative=relative):
                fixture(self.root)
                path = self.root / relative
                path.write_text(path.read_text().replace(VERSION, "0.2.0", 1))
                with self.assertRaises(GATE.ReleaseError):
                    self.source()
        self.fetch.assert_not_called()

    def test_manifest_publication_boundaries_fail_closed(self):
        for relative, old, new in (
            ("crates/lgtmd/Cargo.toml", 'publish = ["crates-io"]', 'publish = false'),
            ("crates/lgtmd-node/Cargo.toml", 'publish = false', 'publish = true'),
            ("crates/doc-example-config/Cargo.toml", 'publish = false', 'publish = true'),
            ("packages/lgtmd/package.json", '"name": "lgtmd"', '"name": "lgtmd", "private": true'),
            ("package.json", '"private": true', '"private": false'),
            ("examples/lgtmd-web/package.json", '"private": true', '"private": false'),
            ("packages/lgtmd/package.json", 'git+https://github.com/lgtmd/lgtmd.git', 'git+https://github.com/fork/lgtmd.git'),
        ):
            with self.subTest(relative=relative, new=new):
                fixture(self.root)
                path = self.root / relative
                path.write_text(path.read_text().replace(old, new))
                with self.assertRaises(GATE.ReleaseError):
                    self.source()

    def test_reservation_and_invalid_version_are_never_publishable(self):
        for version in ("0.0.0", "0.0.0-stage", "v0.1.0", "^0.1.0", "1.02.3", "1.2.3-01"):
            with self.subTest(version=version), self.assertRaises(GATE.ReleaseError):
                GATE.source(version, "both", publishing=True, root=self.root, environment=ENVIRONMENT, fetch=self.fetch, git=clean_git)
        self.fetch.assert_not_called()

    def test_shared_release_version_rejects_build_metadata_before_any_requests(self):
        for publishing in (False, True):
            with self.subTest(publishing=publishing), self.assertRaisesRegex(GATE.ReleaseError, r"cannot include \+build metadata"):
                GATE.source("0.1.0+build.1", "both", publishing=publishing, root=self.root, environment=ENVIRONMENT, fetch=self.fetch, git=clean_git)
        self.fetch.assert_not_called()

    def test_existing_selected_registry_version_fails(self):
        for host in ("registry.npmjs.org", "crates.io"):
            with self.subTest(host=host):
                self.fetch.side_effect = lambda url, **options: {"version": VERSION} if host in url else self.response(url, **options)
                with self.assertRaisesRegex(GATE.ReleaseError, "already exists"):
                    self.source(publishing=True)

    def test_ci_identity_and_outcome_must_match_exact_source(self):
        for field, value in (("workflow_id", 8), ("head_sha", "b" * 40), ("head_branch", "other"), ("event", "pull_request"), ("conclusion", "failure"), ("status", "in_progress"), ("path", ".github/workflows/release.yml"), ("head_repository", {"full_name": "fork/lgtmd"})):
            with self.subTest(field=field):
                run = {**successful_run(), field: value}
                self.fetch.side_effect = lambda url, **options: {"workflow_runs": [run]} if "/runs?" in url else self.response(url, **options)
                with self.assertRaisesRegex(GATE.ReleaseError, "No successful Verify"):
                    self.source(publishing=True)
        self.fetch.side_effect = lambda url, **options: {"workflow_runs": []} if "/runs?" in url else self.response(url, **options)
        with self.assertRaisesRegex(GATE.ReleaseError, "No successful Verify"):
            self.source(publishing=True)

    def test_missing_or_wrong_verify_workflow_is_rejected(self):
        for value in ({}, {**workflow(), "name": "Different"}, {**workflow(), "path": ".github/workflows/release.yml"}):
            self.fetch.side_effect = lambda url, **options: value if url.endswith("ci.yml") else self.response(url, **options)
            with self.assertRaises(GATE.ReleaseError):
                self.source(publishing=True)


class ApprovalTests(unittest.TestCase):
    def gate(self, *, configuration=None, policies=None, history=None, approved=False):
        def response(url, **options):
            self.assertEqual(options, {"token": ENVIRONMENT["GITHUB_TOKEN"]})
            if url.endswith("/environments/release"):
                return protected_environment() if configuration is None else configuration
            if url.endswith("/deployment-branch-policies"):
                return main_policy() if policies is None else policies
            if url.endswith("/actions/runs/123/approvals"):
                return [approval()] if history is None else history
            raise AssertionError(url)
        return GATE.gate(approved=approved, environment=ENVIRONMENT, fetch=response)

    def test_protected_environment_and_human_approval_pass(self):
        self.assertEqual(self.gate()["environment_id"], 7)
        self.assertEqual(self.gate(approved=True)["approver"], "maintainer")

    def test_missing_malformed_or_unprotected_environment_fails(self):
        values = [{}, [], {**protected_environment(), "can_admins_bypass": True}, {**protected_environment(), "protection_rules": []}, {**protected_environment(), "deployment_branch_policy": None}, {**protected_environment(), "deployment_branch_policy": {"protected_branches": 0, "custom_branch_policies": 1}}]
        no_reviewers = protected_environment()
        no_reviewers["protection_rules"][0]["reviewers"] = []
        values.append(no_reviewers)
        for value in values:
            with self.subTest(value=value), self.assertRaises(GATE.ReleaseError):
                self.gate(configuration=value)

    def test_main_only_explicit_branch_policy_is_required(self):
        for policy in ({"total_count": 0, "branch_policies": []}, {"total_count": 1, "branch_policies": [{"name": "*", "type": "branch"}]}, {"total_count": 1, "branch_policies": [{"name": "main", "type": "tag"}]}, {"total_count": 2, "branch_policies": [{"name": "main", "type": "branch"}]}):
            with self.subTest(policy=policy), self.assertRaises(GATE.ReleaseError):
                self.gate(policies=policy)

    def test_no_approval_other_environment_bot_or_unlisted_user_fails(self):
        other_environment = {**approval(), "environments": [{"id": 8, "name": "release"}]}
        bot = {**approval(), "user": {"id": 42, "login": "bot", "type": "Bot"}}
        unlisted = {**approval(), "user": {"id": 99, "login": "other", "type": "User"}}
        for history in ([], [other_environment], [bot], [unlisted], [{**approval(), "state": "pending"}]):
            with self.subTest(history=history), self.assertRaisesRegex(GATE.ReleaseError, "No required human"):
                self.gate(history=history, approved=True)

    def test_rejection_and_malformed_history_fail_even_with_approval(self):
        for history in ({}, [None], [{**approval(), "environments": None}], [approval(), {**approval(), "state": "rejected"}]):
            with self.subTest(history=history), self.assertRaises(GATE.ReleaseError):
                self.gate(history=history, approved=True)

    def test_gate_is_main_repository_only_and_requires_read_token(self):
        for key, value in (("GITHUB_TOKEN", ""), ("GITHUB_REPOSITORY", "fork/lgtmd"), ("GITHUB_REF", "refs/heads/other"), ("GITHUB_RUN_ID", "")):
            fetch = mock.Mock()
            with self.subTest(key=key), self.assertRaises(GATE.ReleaseError):
                GATE.gate(approved=True, environment={**ENVIRONMENT, key: value}, fetch=fetch)


class HttpTests(unittest.TestCase):
    def test_only_explicit_registry_404_is_absent(self):
        for code in (401, 403, 429, 500):
            error = HTTPError("https://registry.npmjs.org/lgtmd/0.1.0", code, "failed", {}, None)
            with self.subTest(code=code), mock.patch.object(GATE, "urlopen", side_effect=error), self.assertRaises(GATE.ReleaseError):
                GATE.request_json(error.url, missing_ok=True)
        error = HTTPError("https://registry.npmjs.org/lgtmd/0.1.0", 404, "missing", {}, None)
        with mock.patch.object(GATE, "urlopen", side_effect=error):
            self.assertIsNone(GATE.request_json(error.url, missing_ok=True))
            with self.assertRaises(GATE.ReleaseError):
                GATE.request_json(error.url)

    def test_network_and_invalid_json_fail_closed(self):
        with mock.patch.object(GATE, "urlopen", side_effect=URLError("offline")), self.assertRaises(GATE.ReleaseError):
            GATE.request_json("https://registry.npmjs.org/lgtmd/0.1.0", missing_ok=True)
        with mock.patch.object(GATE, "urlopen", return_value=io.BytesIO(b"not JSON")), self.assertRaises(GATE.ReleaseError):
            GATE.request_json("https://registry.npmjs.org/lgtmd/0.1.0", missing_ok=True)

    def test_successful_http_null_cannot_masquerade_as_missing_version(self):
        for value in (b"null", b"false", b"42", b'"missing"'):
            with self.subTest(value=value), mock.patch.object(GATE, "urlopen", return_value=io.BytesIO(value)), self.assertRaises(GATE.ReleaseError):
                GATE.request_json("https://registry.npmjs.org/lgtmd/0.1.0", missing_ok=True)

    def test_github_credential_never_goes_to_registry(self):
        with mock.patch.object(GATE, "urlopen") as request, self.assertRaises(GATE.ReleaseError):
            GATE.request_json("https://registry.npmjs.org/lgtmd/0.1.0", token="private")
        request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
