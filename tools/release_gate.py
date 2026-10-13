"""Validate release source and human approval without publishing or requesting OIDC."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tomllib
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = "lgtmd/lgtmd"
REPOSITORY_URL = f"https://github.com/{REPOSITORY}"
ENVIRONMENT = "release"
GITHUB_API = "https://api.github.com"


class ReleaseError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise ReleaseError(message)


def object_value(value, description):
    require(isinstance(value, dict), f"{description} must be an object")
    return value


def positive_id(value):
    return type(value) is int and value > 0


def request_json(url, *, token=None, missing_ok=False):
    """Only an explicit registry HTTP 404 can mean an unpublished version."""
    headers = {
        "Accept": "application/json",
        "User-Agent": "lgtmd-release-gate (https://github.com/lgtmd/lgtmd)",
    }
    if token is not None:
        require(url.startswith(GITHUB_API + "/"), "GitHub credentials cannot be sent to another host")
        headers["Authorization"] = f"Bearer {token}"
        headers["Accept"] = "application/vnd.github+json"
        headers["X-GitHub-Api-Version"] = "2026-03-10"
    try:
        with urlopen(Request(url, headers=headers), timeout=30) as response:
            value = json.load(response)
            require(isinstance(value, (dict, list)), f"Could not verify {url}: response must be a JSON object or array")
            return value
    except HTTPError as error:
        if error.code == 404 and missing_ok:
            return None
        raise ReleaseError(f"Could not verify {url}: HTTP {error.code}") from error
    except (OSError, URLError, ValueError) as error:
        raise ReleaseError(f"Could not verify {url}: {type(error).__name__}") from error


def github(path, environment, fetch):
    token = environment.get("GITHUB_TOKEN")
    require(isinstance(token, str) and bool(token.strip()), "GITHUB_TOKEN is required for read-only release validation")
    return fetch(f"{GITHUB_API}/repos/{REPOSITORY}/{path}", token=token)


def git_output(root, *arguments):
    result = subprocess.run(
        ["git", "-C", str(root), *arguments], check=False,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    require(result.returncode == 0, f"Could not inspect Git source: git {arguments[0]}")
    return result.stdout.strip()


def load_json(root, relative):
    try:
        return object_value(json.loads((root / relative).read_text(encoding="utf-8")), relative)
    except (OSError, ValueError) as error:
        raise ReleaseError(f"Could not read {relative}: {type(error).__name__}") from error


def load_toml(root, relative):
    try:
        return tomllib.loads((root / relative).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ReleaseError(f"Could not read {relative}: {type(error).__name__}") from error


def package(root, relative):
    return object_value(load_toml(root, relative).get("package"), f"{relative} package")


def validate_version(version, publishing):
    require("+" not in version, "Shared Rust/npm release versions cannot include +build metadata; npm normalizes it away")
    match = re.fullmatch(
        r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
        r"(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?", version,
    )
    require(match is not None, "Version must be an exact SemVer, without a v prefix or a range")
    for identifier in (match.group(4) or "").split("."):
        require(not (identifier.isdigit() and len(identifier) > 1 and identifier[0] == "0"), "Numeric prerelease identifiers cannot have leading zeroes")
    if publishing:
        require(match.group(1, 2, 3) != ("0", "0", "0"), "Reservation version 0.0.0 cannot be published; prepare an explicit release version first")


def validate_source_files(root, version):
    core = package(root, "crates/lgtmd/Cargo.toml")
    bridge = package(root, "crates/lgtmd-node/Cargo.toml")
    consumer = package(root, "crates/doc-example-config/Cargo.toml")
    node = load_json(root, "packages/lgtmd/package.json")
    example = load_json(root, "examples/lgtmd-web/package.json")
    workspace = load_json(root, "package.json")
    require(core.get("name") == node.get("name") == "lgtmd", "The published Rust and npm packages must both be named lgtmd")
    require(bridge.get("name") == "lgtmd-node", "The native bridge must be named lgtmd-node")
    for label, manifest in (("Rust SDK", core), ("npm SDK", node), ("native bridge", bridge)):
        require(manifest.get("version") == version, f"{label} version must exactly match requested version {version}")
    require(core.get("publish") == ["crates-io"], "Rust SDK must explicitly allow publication only to crates-io")
    require(bridge.get("publish") is False and consumer.get("publish") is False, "Native bridge and Rust example must remain unpublished")
    require(workspace.get("private") is True and example.get("private") is True, "npm workspace and web example must remain private")
    require(node.get("private", False) is False, "npm SDK is private; prepare its publication manifest explicitly")
    require(core.get("repository") in (REPOSITORY_URL, REPOSITORY_URL + ".git"), "Rust SDK repository metadata must identify lgtmd/lgtmd")
    repository = object_value(node.get("repository"), "npm SDK repository metadata")
    require(repository.get("type") == "git" and repository.get("url") == f"git+{REPOSITORY_URL}.git" and repository.get("directory") == "packages/lgtmd", "npm SDK repository metadata must identify its lgtmd/lgtmd package directory")
    publication = object_value(node.get("publishConfig"), "npm SDK publishConfig")
    require(publication.get("access") == "public" and publication.get("registry") == "https://registry.npmjs.org", "npm SDK must explicitly publish publicly to registry.npmjs.org")
    bridge_dependencies = object_value(load_toml(root, "crates/lgtmd-node/Cargo.toml").get("dependencies"), "native bridge dependencies")
    bridge_dependency = object_value(bridge_dependencies.get("lgtmd"), "native bridge lgtmd dependency")
    require(bridge_dependency.get("path") == "../lgtmd" and bridge_dependency.get("version") == version, "Native bridge dependency must use the matching local SDK version")
    require(object_value(example.get("devDependencies"), "web example dependencies").get("lgtmd") == version, "Web example must consume the matching SDK version")
    locked = load_toml(root, "Cargo.lock").get("package")
    require(isinstance(locked, list), "Cargo.lock must contain packages")
    for name in ("lgtmd", "lgtmd-node"):
        entries = [entry for entry in locked if isinstance(entry, dict) and entry.get("name") == name and "source" not in entry]
        require(len(entries) == 1 and entries[0].get("version") == version, f"Cargo.lock must contain exactly one matching local {name} version")
    npm_lock = load_json(root, "package-lock.json")
    require(npm_lock.get("lockfileVersion") == 3, "package-lock.json must use the maintained lockfile version 3")
    packages = object_value(npm_lock.get("packages"), "package-lock.json packages")
    require(object_value(packages.get("packages/lgtmd"), "locked npm SDK").get("version") == version, "package-lock.json SDK version must match")
    locked_example = object_value(packages.get("examples/lgtmd-web"), "locked web example")
    require(locked_example.get("version") == example.get("version"), "package-lock.json example version must match its private package")
    require(object_value(locked_example.get("devDependencies"), "locked web example dependencies").get("lgtmd") == version, "package-lock.json example SDK dependency must match")
    require(packages.get("node_modules/lgtmd") == {"resolved": "packages/lgtmd", "link": True}, "package-lock.json must link the local SDK workspace")
    require(workspace.get("workspaces") == ["packages/lgtmd", "examples/lgtmd-web"], "npm workspace membership must identify SDK and web example")
    require(object_value(packages.get(""), "locked npm workspace").get("workspaces") == workspace["workspaces"], "package-lock.json workspace membership must match source")


def verified_ci(environment, fetch):
    workflow = object_value(github("actions/workflows/ci.yml", environment, fetch), "Verify workflow")
    require(positive_id(workflow.get("id")) and workflow.get("name") == "Verify" and workflow.get("path") == ".github/workflows/ci.yml" and workflow.get("state") == "active", "The active Verify workflow must be .github/workflows/ci.yml")
    sha = environment["GITHUB_SHA"]
    response = object_value(github(f"actions/workflows/ci.yml/runs?head_sha={sha}&event=push&status=success&per_page=100", environment, fetch), "Verify workflow runs")
    runs = response.get("workflow_runs")
    require(isinstance(runs, list), "Verify workflow runs response is malformed")
    for run in runs:
        if not isinstance(run, dict):
            raise ReleaseError("Verify workflow run is malformed")
        if (
            positive_id(run.get("id")) and positive_id(run.get("workflow_id")) and run.get("workflow_id") == workflow["id"]
            and run.get("head_sha") == sha and run.get("head_branch") == "main"
            and run.get("event") == "push" and run.get("status") == "completed"
            and run.get("conclusion") == "success"
            and isinstance(run.get("path"), str)
            and run["path"].split("@", 1)[0] == ".github/workflows/ci.yml"
            and isinstance(run.get("head_repository"), dict)
            and run["head_repository"].get("full_name") == REPOSITORY
        ):
            return run["id"]
    raise ReleaseError(f"No successful Verify CI run for exact main commit {sha}; wait for ci.yml to pass before publishing")


def source(version, target, *, publishing=False, root=ROOT, environment=None, fetch=request_json, git=git_output):
    environment = os.environ if environment is None else environment
    require(target in ("both", "npm", "crates"), "Unknown registry target")
    validate_version(version, publishing)
    require(environment.get("GITHUB_REPOSITORY") == REPOSITORY, "Releases must run in lgtmd/lgtmd")
    require(environment.get("GITHUB_REF") == "refs/heads/main", "Releases must run from refs/heads/main")
    sha = environment.get("GITHUB_SHA", "")
    require(re.fullmatch(r"[0-9a-f]{40}", sha) is not None, "GITHUB_SHA must identify an exact source commit")
    require(git(root, "rev-parse", "HEAD") == sha, "Checkout HEAD must match GITHUB_SHA exactly")
    require(not git(root, "status", "--porcelain", "--untracked-files=normal"), "Release checkout must be clean, including untracked source files")
    validate_source_files(root, version)
    ci_run = None
    if publishing:
        ci_run = verified_ci(environment, fetch)
        endpoints = {
            "npm": f"https://registry.npmjs.org/lgtmd/{quote(version, safe='')}",
            "crates": f"https://crates.io/api/v1/crates/lgtmd/{quote(version, safe='')}",
        }
        selected = endpoints if target == "both" else {target: endpoints[target]}
        for registry, url in selected.items():
            require(fetch(url, missing_ok=True) is None, f"lgtmd {version} already exists on {registry}; publishing an existing version is forbidden")
    return {"repository": REPOSITORY, "sha": sha, "version": version, "target": target, "publishing": publishing, "verified_ci_run": ci_run}


def gate(*, approved=False, environment=None, fetch=request_json):
    environment = os.environ if environment is None else environment
    require(environment.get("GITHUB_REPOSITORY") == REPOSITORY and environment.get("GITHUB_REF") == "refs/heads/main", "Release approval gate is restricted to lgtmd/lgtmd main")
    configuration = object_value(github(f"environments/{ENVIRONMENT}", environment, fetch), "release environment")
    environment_id = configuration.get("id")
    require(configuration.get("name") == ENVIRONMENT and positive_id(environment_id), "release environment identity is malformed")
    require(configuration.get("can_admins_bypass") is False, "release environment must disable administrator bypass")
    rules = configuration.get("protection_rules")
    require(isinstance(rules, list) and all(isinstance(rule, dict) for rule in rules), "release environment protection rules are malformed")
    reviewer_rules = [rule for rule in rules if rule.get("type") == "required_reviewers"]
    require(len(reviewer_rules) == 1, "release environment must have required human reviewers")
    reviewers = reviewer_rules[0].get("reviewers")
    require(isinstance(reviewers, list) and bool(reviewers), "release environment must have required human reviewers")
    human_ids = set()
    for entry in reviewers:
        require(isinstance(entry, dict) and isinstance(entry.get("reviewer"), dict), "release environment reviewer is malformed")
        user = entry["reviewer"]
        require(entry.get("type") == "User" and user.get("type") == "User" and positive_id(user.get("id")) and isinstance(user.get("login"), str) and bool(user["login"]), "release environment currently requires direct human user reviewers")
        human_ids.add(user["id"])
    deployment_policy = object_value(configuration.get("deployment_branch_policy"), "release deployment branch policy")
    require(deployment_policy.get("protected_branches") is False and deployment_policy.get("custom_branch_policies") is True, "release environment must use an explicit main-only deployment policy")
    policies = object_value(github(f"environments/{ENVIRONMENT}/deployment-branch-policies", environment, fetch), "release deployment branch policies")
    branches = policies.get("branch_policies")
    require(type(policies.get("total_count")) is int and policies["total_count"] == 1 and isinstance(branches, list) and len(branches) == 1 and isinstance(branches[0], dict) and branches[0].get("name") == "main" and branches[0].get("type") == "branch", "release environment must permit only the main branch, with no tags or wildcards")
    approver = None
    if approved:
        run_id = environment.get("GITHUB_RUN_ID", "")
        require(re.fullmatch(r"[1-9][0-9]*", run_id) is not None, "GITHUB_RUN_ID is required to verify this run's approval")
        history = github(f"actions/runs/{run_id}/approvals", environment, fetch)
        require(isinstance(history, list) and all(isinstance(review, dict) for review in history), "Release review history is malformed")
        for review in history:
            environments = review.get("environments")
            require(isinstance(environments, list) and all(isinstance(item, dict) for item in environments), "Release review environment identity is malformed")
            if not any(item.get("id") == environment_id and item.get("name") == ENVIRONMENT for item in environments):
                continue
            require(review.get("state") != "rejected", "This release run has a rejected approval; start a new explicitly authorized run")
            user = object_value(review.get("user"), "release approver")
            if review.get("state") == "approved" and user.get("type") == "User" and positive_id(user.get("id")) and user.get("id") in human_ids and isinstance(user.get("login"), str):
                approver = user["login"]
        require(approver is not None, "No required human reviewer approved this run's exact release environment; publication is blocked")
    return {"environment": ENVIRONMENT, "environment_id": environment_id, "approved": approved, "approver": approver}


def main(arguments=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    source_parser = commands.add_parser("source", help="validate exact source, versions and selected registry availability")
    source_parser.add_argument("--version", required=True)
    source_parser.add_argument("--target", choices=("both", "npm", "crates"), required=True)
    source_parser.add_argument("--publishing", action="store_true")
    gate_parser = commands.add_parser("gate", help="validate protected environment and optional current-run approval")
    gate_parser.add_argument("--approved", action="store_true")
    options = parser.parse_args(arguments)
    try:
        result = source(options.version, options.target, publishing=options.publishing) if options.command == "source" else gate(approved=options.approved)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (ReleaseError, OSError, ValueError, TypeError, KeyError) as error:
        print(f"Release validation failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
