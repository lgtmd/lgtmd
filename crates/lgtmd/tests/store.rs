use lgtmd::{Artifact, Audience, Doc, Document, runner::run_cli, store};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

fn directory() -> (tempfile::TempDir, PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    (temp, root)
}

fn files(audience: &str, profile: &str, text: &str) -> store::Files {
    let mut doc = Doc::new("example", "Example").unwrap();
    doc.require("executed", true).unwrap();
    let resource = doc
        .resource_at(
            "content",
            Artifact::new(text.as_bytes(), "text/plain", "md", "text", profile).unwrap(),
            "pages/example.md",
        )
        .unwrap();
    doc.code(&resource, "text").unwrap();
    Document::render_many(
        &[doc.finish().unwrap()],
        if audience == "reader" {
            Audience::Reader
        } else {
            Audience::Contributor
        },
    )
    .unwrap()
}

fn without_content() -> store::Files {
    let mut doc = Doc::new("example", "Example").unwrap();
    doc.require("executed", true).unwrap();
    doc.paragraph("Content has been retired.").unwrap();
    Document::render_many(&[doc.finish().unwrap()], Audience::Reader).unwrap()
}

#[test]
fn retained_receipts_accept_unknown_fields_and_null_or_omitted_check_payloads() {
    let (_temporary, parent) = directory();
    let root = parent.join("reader");
    let mut doc = Doc::new("compatibility", "Receipt compatibility").unwrap();
    let observation = doc.expect_eq("nothing", Option::<u8>::None, None).unwrap();
    doc.require("private-check", true).unwrap();
    let label = doc
        .binding("label", lgtmd::BindingValue::Code("result".into()))
        .unwrap();
    doc.paragraph(("The ", label, " is ", observation)).unwrap();
    let resource = doc
        .resource(
            "download",
            Artifact::new(b"result", "text/plain", "txt", "text", "v1").unwrap(),
        )
        .unwrap();
    doc.embed(&resource, "Download the result").unwrap();
    let candidate = Document::render_many(&[doc.finish().unwrap()], Audience::Reader).unwrap();
    let mut retained = candidate.clone();
    let mut receipt: serde_json::Value =
        serde_json::from_slice(&retained["manifest.json"]).unwrap();
    let checks = receipt["documents"][0]["checks"].as_array().unwrap();
    let nothing = checks
        .iter()
        .find(|check| check["id"] == "nothing")
        .unwrap();
    assert_eq!(nothing.get("actual"), Some(&serde_json::Value::Null));
    assert_eq!(nothing.get("expected"), Some(&serde_json::Value::Null));
    let private = checks
        .iter()
        .find(|check| check["id"] == "private-check")
        .unwrap();
    assert!(private.get("actual").is_none() && private.get("expected").is_none());
    // Additional record fields have always been tolerated. A typed internal
    // reader must not make an otherwise valid retained baseline incompatible.
    receipt["extension"] = serde_json::json!({"owner": "another consumer"});
    for document in receipt["documents"].as_array_mut().unwrap() {
        document["extension"] = serde_json::json!(1);
        for check in document["checks"].as_array_mut().unwrap() {
            check["extension"] = serde_json::json!(null);
        }
        for block in document["blocks"].as_array_mut().unwrap() {
            block["extension"] = serde_json::json!(false);
            for reference in block["references"].as_array_mut().unwrap() {
                reference["extension"] = serde_json::json!([]);
            }
        }
        for binding in document["bindings"].as_object_mut().unwrap().values_mut() {
            binding["extension"] = serde_json::json!({});
        }
    }
    for key in ["profiles", "artifacts"] {
        for record in receipt[key].as_array_mut().unwrap() {
            record["extension"] = serde_json::json!("retained");
        }
    }
    retained.insert(
        "manifest.json".into(),
        serde_json::to_vec(&receipt).unwrap(),
    );
    store::build(&root, &retained).unwrap();
    store::check(&root, &retained).unwrap();
    store::update(&root, &candidate).unwrap();
    store::check(&root, &candidate).unwrap();
}

fn snapshot(root: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(base: &Path, dir: &Path, files: &mut BTreeMap<String, Vec<u8>>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(base, &path, files);
            } else {
                files.insert(
                    path.strip_prefix(base).unwrap().to_str().unwrap().into(),
                    fs::read(path).unwrap(),
                );
            }
        }
    }
    let mut files = BTreeMap::new();
    walk(root, root, &mut files);
    files
}

#[test]
fn check_is_read_only_and_reports_changed_missing_and_extra_files() {
    let (_temp, parent) = directory();
    let root = parent.join("reader");
    let expected = files("reader", "v1", "original");
    store::update(&root, &expected).unwrap();
    let saved = snapshot(&root);
    store::check(&root, &expected).unwrap();
    assert_eq!(snapshot(&root), saved);
    let changed = files("reader", "v1", "changed");
    assert!(
        store::check(&root, &changed)
            .unwrap_err()
            .contains("changed pages/example.md")
    );
    let fewer = without_content();
    assert!(
        store::check(&root, &fewer)
            .unwrap_err()
            .contains("extra pages/example.md")
    );
    fs::remove_file(root.join("pages/example.md")).unwrap();
    assert!(
        store::check(&root, &expected)
            .unwrap_err()
            .contains("missing pages/example.md")
    );
    assert!(!parent.join(".reader.lock").exists());
}

#[test]
fn intended_updates_work_but_retired_files_require_explicit_removal() {
    let (_temp, parent) = directory();
    let root = parent.join("reader");
    let original = files("reader", "v1", "old");
    store::update(&root, &original).unwrap();
    let mut replacement = files("reader", "v1", "new");
    store::update(&root, &replacement).unwrap();
    store::check(&root, &replacement).unwrap();
    replacement = without_content();
    let saved = snapshot(&root);
    assert!(
        store::update(&root, &replacement)
            .unwrap_err()
            .contains("explicit removal")
    );
    assert_eq!(snapshot(&root), saved);
    fs::remove_file(root.join("pages/example.md")).unwrap();
    store::update(&root, &replacement).unwrap();
    store::check(&root, &replacement).unwrap();
}

#[test]
fn incompatible_profiles_audiences_and_schemas_cannot_be_blessed() {
    let (_temp, parent) = directory();
    let root = parent.join("reader");
    let original = files("reader", "v1", "old");
    store::update(&root, &original).unwrap();
    let saved = snapshot(&root);
    for (candidate, message) in [
        (files("reader", "v2", "old"), "profiles"),
        (files("contributor", "v1", "old"), "audience"),
    ] {
        assert!(
            store::update(&root, &candidate)
                .unwrap_err()
                .contains(message)
        );
        assert!(
            store::check(&root, &candidate)
                .unwrap_err()
                .contains(message)
        );
        assert_eq!(snapshot(&root), saved);
    }
    let mut candidate = original.clone();
    candidate.insert(
        "manifest.json".into(),
        br#"{"schema_version":99,"audience":"reader","profiles":[],"artifacts":[]}"#.to_vec(),
    );
    assert!(
        store::update(&root, &candidate)
            .unwrap_err()
            .contains("schema")
    );
    assert_eq!(snapshot(&root), saved);
}

fn resource_files(resources: &[(&str, &str, &str)]) -> store::Files {
    let mut doc = Doc::new("example", "Example").unwrap();
    doc.require("executed", true).unwrap();
    for (id, producer, profile) in resources {
        let resource = doc
            .resource_at(
                id,
                Artifact::new(
                    id.as_bytes(),
                    "application/octet-stream",
                    "bin",
                    producer,
                    profile,
                )
                .unwrap(),
                &format!("assets/{id}.bin"),
            )
            .unwrap();
        doc.paragraph(resource.link(id)).unwrap();
    }
    Document::render_many(&[doc.finish().unwrap()], Audience::Reader).unwrap()
}

#[test]
fn adding_and_explicitly_retiring_producers_does_not_change_retained_compatibility() {
    let (_temp, parent) = directory();
    let root = parent.join("reader");
    let first = resource_files(&[("config", "json", "v1")]);
    store::update(&root, &first).unwrap();
    let expanded = resource_files(&[("config", "json", "v1"), ("preview", "renderer", "metal")]);
    store::update(&root, &expanded).unwrap();
    store::check(&root, &expanded).unwrap();
    let retired = resource_files(&[("preview", "renderer", "metal")]);
    assert!(
        store::update(&root, &retired)
            .unwrap_err()
            .contains("explicit removal")
    );
    fs::remove_file(root.join("assets/config.bin")).unwrap();
    store::update(&root, &retired).unwrap();
    store::check(&root, &retired).unwrap();
}

#[test]
fn retained_resources_cannot_swap_profiles_or_producers() {
    let (_temp, parent) = directory();
    let root = parent.join("reader");
    let first = resource_files(&[("a", "renderer", "metal"), ("b", "renderer", "vulkan")]);
    store::update(&root, &first).unwrap();
    let saved = snapshot(&root);
    // The aggregate profile set is unchanged, but each retained resource differs.
    let swapped = resource_files(&[("a", "renderer", "vulkan"), ("b", "renderer", "metal")]);
    assert!(
        store::update(&root, &swapped)
            .unwrap_err()
            .contains("profiles for example/a")
    );
    assert_eq!(snapshot(&root), saved);
    let producer_change = resource_files(&[
        ("a", "different-renderer", "metal"),
        ("b", "renderer", "vulkan"),
    ]);
    assert!(
        store::update(&root, &producer_change)
            .unwrap_err()
            .contains("profiles for example/a")
    );
    assert_eq!(snapshot(&root), saved);
}

#[test]
fn unsafe_or_conflicting_paths_fail_before_creating_output() {
    let (_temp, parent) = directory();
    for unsafe_path in [
        "../escape",
        "/absolute",
        "a//b",
        "a/./b",
        "a\\b",
        ".ownership.json",
    ] {
        let root = parent.join("reader");
        let mut candidate = files("reader", "v1", "content");
        candidate.insert(unsafe_path.into(), b"unsafe".to_vec());
        assert!(
            store::update(&root, &candidate)
                .unwrap_err()
                .contains("path")
        );
        assert!(!root.exists());
    }
    let mut candidate = files("reader", "v1", "content");
    candidate.insert("pages".into(), b"conflict".to_vec());
    assert!(
        store::update(&parent.join("reader"), &candidate)
            .unwrap_err()
            .contains("conflicts")
    );
}

#[test]
fn unowned_files_and_directories_are_preserved() {
    let (_temp, parent) = directory();
    let root = parent.join("reader");
    let expected = files("reader", "v1", "content");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("personal.txt"), "keep me").unwrap();
    assert!(
        store::update(&root, &expected)
            .unwrap_err()
            .contains("ownership")
    );
    assert_eq!(
        fs::read_to_string(root.join("personal.txt")).unwrap(),
        "keep me"
    );
    fs::remove_file(root.join("personal.txt")).unwrap();
    fs::remove_dir(&root).unwrap();
    store::update(&root, &expected).unwrap();
    fs::write(root.join("personal.txt"), "keep me").unwrap();
    assert!(
        store::update(&root, &expected)
            .unwrap_err()
            .contains("Unowned")
    );
    fs::remove_file(root.join("personal.txt")).unwrap();
    fs::create_dir(root.join("personal")).unwrap();
    assert!(
        store::update(&root, &expected)
            .unwrap_err()
            .contains("Unowned output directory")
    );
    assert!(root.join("personal").is_dir());
}

#[test]
fn duplicate_ownership_entries_are_rejected() {
    let (_temp, parent) = directory();
    let root = parent.join("reader");
    let expected = files("reader", "v1", "content");
    store::update(&root, &expected).unwrap();
    fs::write(
        root.join(".ownership.json"),
        br#"{"schema_version":1,"files":["manifest.json","manifest.json"]}"#,
    )
    .unwrap();
    assert!(
        store::check(&root, &expected)
            .unwrap_err()
            .contains("Duplicate owned")
    );
}

#[test]
fn phantom_ownership_entries_cannot_be_checked_updated_or_recovered() {
    let (_temp, parent) = directory();
    let root = parent.join("reader");
    let expected = files("reader", "v1", "content");
    store::build(&root, &expected).unwrap();
    let marker = root.join(".ownership.json");
    let mut ownership: serde_json::Value =
        serde_json::from_slice(&fs::read(&marker).unwrap()).unwrap();
    ownership["files"]
        .as_array_mut()
        .unwrap()
        .push("never-generated.txt".into());
    fs::write(&marker, serde_json::to_vec_pretty(&ownership).unwrap()).unwrap();
    let damaged = snapshot(&root);

    for result in [
        store::check(&root, &expected),
        store::update(&root, &expected),
    ] {
        let error = result.unwrap_err();
        assert!(error.contains("Ownership inventory"), "{error}");
        assert!(error.contains("never-generated.txt"), "{error}");
        assert_eq!(snapshot(&root), damaged);
        assert_eq!(fs::read_dir(&parent).unwrap().count(), 1);
    }

    let backup = parent.join(".reader.backup");
    fs::rename(&root, &backup).unwrap();
    assert!(
        store::recover_backup(&root)
            .unwrap_err()
            .contains("missing never-generated.txt")
    );
    assert_eq!(snapshot(&backup), damaged);
    assert!(!root.exists());
}

#[test]
fn retirement_requires_agreement_between_manifest_and_ownership_inventory() {
    let (_temp, parent) = directory();
    let root = parent.join("reader");
    let expected = files("reader", "v1", "content");
    store::build(&root, &expected).unwrap();
    fs::remove_file(root.join("pages/example.md")).unwrap();

    // Deleting a still-required resource cannot be accepted as retirement.
    let damaged = snapshot(&root);
    assert!(
        store::update(&root, &expected)
            .unwrap_err()
            .contains("missing pages/example.md")
    );
    assert_eq!(snapshot(&root), damaged);

    // Even genuine retirement must not conceal a contradictory ownership record.
    let marker = root.join(".ownership.json");
    let mut ownership: serde_json::Value =
        serde_json::from_slice(&fs::read(&marker).unwrap()).unwrap();
    ownership["files"]
        .as_array_mut()
        .unwrap()
        .retain(|name| name != "pages/example.md");
    fs::write(&marker, serde_json::to_vec_pretty(&ownership).unwrap()).unwrap();
    fs::remove_dir(root.join("pages")).unwrap();
    let damaged = snapshot(&root);
    assert!(
        store::update(&root, &without_content())
            .unwrap_err()
            .contains("Ownership inventory differs")
    );
    assert_eq!(snapshot(&root), damaged);
    assert_eq!(fs::read_dir(&parent).unwrap().count(), 1);
}

#[test]
fn lock_conflicts_never_remove_someone_elses_lock() {
    let (_temp, parent) = directory();
    let root = parent.join("reader");
    let expected = files("reader", "v1", "content");
    store::update(&root, &expected).unwrap();
    let lock = parent.join(".reader.lock");
    fs::write(&lock, "other writer").unwrap();
    assert!(
        store::update(&root, &expected)
            .unwrap_err()
            .contains("lock")
    );
    assert!(store::check(&root, &expected).unwrap_err().contains("lock"));
    assert_eq!(fs::read_to_string(&lock).unwrap(), "other writer");
}

#[test]
fn interrupted_transaction_material_is_not_discarded() {
    let (_temp, parent) = directory();
    let root = parent.join("reader");
    let expected = files("reader", "v1", "content");
    store::update(&root, &expected).unwrap();
    for suffix in ["staging", "backup"] {
        let retained = parent.join(format!(".reader.{suffix}"));
        fs::create_dir(&retained).unwrap();
        fs::write(retained.join("evidence.txt"), "inspect first").unwrap();
        assert!(
            store::update(&root, &expected)
                .unwrap_err()
                .contains("Interrupted transaction")
        );
        assert!(
            store::check(&root, &expected)
                .unwrap_err()
                .contains("Interrupted transaction")
        );
        assert_eq!(
            fs::read_to_string(retained.join("evidence.txt")).unwrap(),
            "inspect first"
        );
        fs::remove_dir_all(retained).unwrap();
    }
}

#[test]
fn explicit_recovery_restores_only_a_complete_backup_to_an_absent_destination() {
    let (_temp, parent) = directory();
    let root = parent.join("reader");
    let expected = files("reader", "v1", "content");
    store::update(&root, &expected).unwrap();
    assert!(
        store::recover_backup(&root)
            .unwrap_err()
            .contains("destination exists")
    );
    let backup = parent.join(".reader.backup");
    fs::rename(&root, &backup).unwrap();
    store::recover_backup(&root).unwrap();
    store::check(&root, &expected).unwrap();
    fs::rename(&root, &backup).unwrap();
    fs::remove_file(backup.join("pages/example.md")).unwrap();
    assert!(
        store::recover_backup(&root)
            .unwrap_err()
            .contains("missing pages/example.md")
    );
    assert!(backup.exists());
    assert!(!root.exists());
}

#[test]
fn builds_require_new_destination_and_preserve_existing_candidates() {
    let (_temp, parent) = directory();
    let root = parent.join("candidate");
    let expected = files("reader", "v1", "content");
    store::build(&root, &expected).unwrap();
    let saved = snapshot(&root);
    assert!(
        store::build(&root, &expected)
            .unwrap_err()
            .contains("already exists")
    );
    assert_eq!(snapshot(&root), saved);
}

#[cfg(unix)]
#[test]
fn symlink_destinations_ancestors_resources_and_transaction_paths_are_rejected() {
    use std::os::unix::fs::symlink;
    let (_temp, parent) = directory();
    let expected = files("reader", "v1", "content");
    let protected = parent.join("protected");
    fs::create_dir(&protected).unwrap();
    fs::write(protected.join("keep"), "untouched").unwrap();
    let alias = parent.join("alias");
    symlink(&protected, &alias).unwrap();
    assert!(
        store::update(&alias.join("reader"), &expected)
            .unwrap_err()
            .contains("Symlink")
    );
    assert!(
        store::update(&alias, &expected)
            .unwrap_err()
            .contains("Symlink")
    );
    for suffix in ["lock", "staging", "backup"] {
        let link = parent.join(format!(".reader.{suffix}"));
        symlink(&protected, &link).unwrap();
        assert!(
            store::update(&parent.join("reader"), &expected)
                .unwrap_err()
                .contains("Symlink")
        );
        assert!(link.symlink_metadata().unwrap().file_type().is_symlink());
        fs::remove_file(link).unwrap();
    }
    let root = parent.join("reader");
    store::update(&root, &expected).unwrap();
    fs::remove_file(root.join("pages/example.md")).unwrap();
    symlink(protected.join("keep"), root.join("pages/example.md")).unwrap();
    assert!(
        store::update(&root, &expected)
            .unwrap_err()
            .contains("symlink")
    );
    assert_eq!(
        fs::read_to_string(protected.join("keep")).unwrap(),
        "untouched"
    );
}

#[test]
fn generation_errors_and_panics_never_publish_any_requested_audience() {
    let (_temp, parent) = directory();
    let baseline = parent.join("baseline");
    let expected = files("reader", "v1", "original");
    store::update(&baseline.join("reader"), &expected).unwrap();
    let saved = snapshot(&baseline);
    let args = || ["update", "--audience", "both"].map(str::to_owned);
    assert!(
        run_cli(args(), &baseline, || Err("failed assertion".into()))
            .unwrap_err()
            .contains("failed assertion")
    );
    assert_eq!(snapshot(&baseline), saved);
    assert!(
        run_cli(args(), &baseline, || panic!("broken generator"))
            .unwrap_err()
            .contains("panicked")
    );
    assert_eq!(snapshot(&baseline), saved);
    assert!(!baseline.join("contributor").exists());
}

#[test]
fn invalid_cli_or_overlapping_build_paths_fail_before_execution() {
    let (_temp, parent) = directory();
    let baseline = parent.join("baseline");
    for args in [
        vec!["unknown"],
        vec!["check", "--out", "somewhere"],
        vec!["build"],
        vec!["update", "--audience", "unknown"],
    ] {
        let invoked = std::cell::Cell::new(false);
        assert!(
            run_cli(args.into_iter().map(str::to_owned), &baseline, || {
                invoked.set(true);
                Err("must not execute".into())
            })
            .is_err()
        );
        assert!(!invoked.get());
    }
    for output in [&baseline, &baseline.join("candidate"), &parent] {
        let invoked = std::cell::Cell::new(false);
        let error = run_cli(
            vec![
                "build".into(),
                "--out".into(),
                output.to_str().unwrap().into(),
            ],
            &baseline,
            || {
                invoked.set(true);
                Err("must not execute".into())
            },
        )
        .unwrap_err();
        assert!(error.contains("overlap"));
        assert!(!invoked.get());
    }
}

#[test]
fn a_case_alias_of_existing_baseline_fails_before_generation() {
    let (_temp, parent) = directory();
    let baseline = parent.join("Baseline");
    let alias = parent.join("baseline");
    let expected = files("reader", "v1", "retained bytes");
    store::update(&baseline.join("reader"), &expected).unwrap();
    if !alias.exists() {
        // The distinct-directory behavior on case-sensitive hosts is covered by
        // the lifecycle test; there is no case alias to exercise in this runner.
        return;
    }
    assert!(same_file::is_same_file(&baseline, &alias).unwrap());
    let saved = snapshot(&baseline);
    let output = alias.join("candidate");
    let invoked = std::cell::Cell::new(false);
    let error = run_cli(
        [
            "build".into(),
            "--out".into(),
            output.to_str().unwrap().into(),
        ],
        &baseline,
        || {
            invoked.set(true);
            Ok(vec![document()])
        },
    )
    .unwrap_err();
    assert!(error.contains("overlap"));
    assert!(!invoked.get(), "preflight must precede generation");
    assert!(!output.exists());
    assert_eq!(snapshot(&baseline), saved);
}

fn document() -> lgtmd::Document {
    let mut doc = lgtmd::Doc::new("example", "Example").unwrap();
    let value = doc.expect_eq("value", 8080, 8080).unwrap();
    doc.paragraph(("Port ", &value, ".")).unwrap();
    doc.note("Contributor-only explanation").unwrap();
    doc.finish().unwrap()
}

#[test]
fn both_views_execute_once_and_publish_separate_inventories() {
    let (_temp, parent) = directory();
    let baseline = parent.join("baseline");
    let candidate = parent.join("candidate");
    let invoked = std::cell::Cell::new(0);
    run_cli(
        vec![
            "build".into(),
            "--out".into(),
            candidate.to_str().unwrap().into(),
            "--audience".into(),
            "both".into(),
        ],
        &baseline,
        || {
            invoked.set(invoked.get() + 1);
            Ok(vec![document()])
        },
    )
    .unwrap();
    assert_eq!(invoked.get(), 1);
    assert!(!baseline.exists());
    for audience in ["reader", "contributor"] {
        let manifest: serde_json::Value = serde_json::from_slice(
            &fs::read(candidate.join(audience).join("manifest.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(manifest["audience"], audience);
        assert!(candidate.join(audience).join(".ownership.json").exists());
    }
}

#[test]
fn render_failure_prevents_all_publication() {
    let (_temp, parent) = directory();
    let baseline = parent.join("baseline");
    let doc = document();
    let error = run_cli(
        ["update", "--audience", "both"].map(str::to_owned),
        &baseline,
        || Ok(vec![doc.clone(), doc]),
    )
    .unwrap_err();
    assert!(error.to_lowercase().contains("duplicate"));
    assert!(!baseline.exists());
}

#[test]
fn partial_audience_publication_is_explicit_and_preserves_other_writer() {
    let (_temp, parent) = directory();
    let baseline = parent.join("baseline");
    fs::create_dir(&baseline).unwrap();
    let lock = baseline.join(".contributor.lock");
    fs::write(&lock, "another writer").unwrap();
    let error = run_cli(
        ["update", "--audience", "both"].map(str::to_owned),
        &baseline,
        || Ok(vec![document()]),
    )
    .unwrap_err();
    assert!(error.contains("earlier audiences completed independently: reader"));
    assert!(baseline.join("reader/manifest.json").exists());
    assert!(!baseline.join("contributor").exists());
    assert_eq!(fs::read_to_string(lock).unwrap(), "another writer");
}

fn edit_manifest(files: &mut store::Files, edit: impl FnOnce(&mut serde_json::Value)) {
    let mut manifest: serde_json::Value = serde_json::from_slice(&files["manifest.json"]).unwrap();
    edit(&mut manifest);
    files.insert(
        "manifest.json".into(),
        serde_json::to_vec_pretty(&manifest).unwrap(),
    );
}

#[test]
fn inconsistent_artifact_manifests_never_build_update_or_pass_check() {
    let (_temp, parent) = directory();
    let baseline = parent.join("baseline");
    let original = files("reader", "v1", "frozen bytes");
    store::update(&baseline, &original).unwrap();
    let saved = snapshot(&baseline);
    let mut candidates = Vec::new();
    let mut changed_bytes = original.clone();
    changed_bytes.insert(
        "pages/example.md".into(),
        b"different actual bytes".to_vec(),
    );
    candidates.push(("stale hash", changed_bytes));
    let mut missing = original.clone();
    missing.remove("pages/example.md");
    candidates.push(("missing file", missing));
    let mut unrecorded = original.clone();
    unrecorded.insert("unrecorded.txt".into(), b"extra".to_vec());
    candidates.push(("unrecorded file", unrecorded));

    for (name, edit) in [
        (
            "wrong length",
            (|manifest: &mut serde_json::Value| {
                manifest["artifacts"][0]["bytes"] = 999.into();
            }) as fn(&mut serde_json::Value),
        ),
        ("wrong hash", |manifest| {
            manifest["artifacts"][0]["sha256"] = "0".repeat(64).into();
        }),
        ("missing artifact", |manifest| {
            manifest["artifacts"].as_array_mut().unwrap().pop();
        }),
        ("duplicate path", |manifest| {
            let repeated = manifest["artifacts"][0].clone();
            manifest["artifacts"].as_array_mut().unwrap().push(repeated);
        }),
        ("duplicate document", |manifest| {
            let repeated = manifest["documents"][0].clone();
            manifest["documents"].as_array_mut().unwrap().push(repeated);
        }),
        ("unknown document", |manifest| {
            manifest["artifacts"][0]["document"] = "unknown".into();
        }),
        ("unsafe declared path", |manifest| {
            manifest["artifacts"][0]["path"] = "../outside".into();
        }),
        ("unknown artifact kind", |manifest| {
            manifest["artifacts"][0]["kind"] = "unknown".into();
        }),
        ("profile mismatch", |manifest| {
            manifest["profiles"][0]["profile"] = "invented".into();
        }),
        ("duplicate profile", |manifest| {
            let repeated = manifest["profiles"][0].clone();
            manifest["profiles"].as_array_mut().unwrap().push(repeated);
        }),
        ("failed check", |manifest| {
            manifest["documents"][0]["checks"][0]["passed"] = false.into();
        }),
        ("wrong-kind reference", |manifest| {
            manifest["documents"][0]["blocks"][0]["references"][0]["kind"] = "value".into();
        }),
        ("reader note", |manifest| {
            manifest["documents"][0]["blocks"][0]["kind"] = "note".into();
        }),
    ] {
        let mut candidate = original.clone();
        edit_manifest(&mut candidate, edit);
        candidates.push((name, candidate));
    }
    for (index, (name, candidate)) in candidates.into_iter().enumerate() {
        let fresh = parent.join(format!("candidate-{index}"));
        assert!(
            store::build(&fresh, &candidate).is_err(),
            "build accepted {name}"
        );
        assert!(!fresh.exists(), "build wrote a rejected candidate: {name}");
        assert!(
            store::update(&baseline, &candidate).is_err(),
            "update accepted {name}"
        );
        assert!(
            store::check(&baseline, &candidate).is_err(),
            "check accepted {name}"
        );
        assert_eq!(
            snapshot(&baseline),
            saved,
            "rejected {name} changed the baseline"
        );
    }
}

#[test]
fn distinct_paths_cannot_reuse_a_resource_identity() {
    let (_temp, parent) = directory();
    let mut candidate =
        resource_files(&[("first", "producer", "v1"), ("second", "producer", "v1")]);
    edit_manifest(&mut candidate, |manifest| {
        let resources: Vec<_> = manifest["artifacts"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .filter(|record| record["kind"] == "resource")
            .collect();
        for resource in resources {
            resource["id"] = "same".into();
        }
    });
    let error = store::build(&parent.join("candidate"), &candidate).unwrap_err();
    assert!(error.contains("Duplicate manifest evidence identity"));
}

#[test]
fn corruption_of_retained_bytes_or_backup_cannot_be_approved_as_an_update() {
    let (_temp, parent) = directory();
    let root = parent.join("reader");
    let expected = files("reader", "v1", "original");
    store::update(&root, &expected).unwrap();
    fs::write(root.join("pages/example.md"), "corrupted").unwrap();
    let damaged = snapshot(&root);
    assert!(
        store::check(&root, &expected)
            .unwrap_err()
            .contains("size/hash mismatch")
    );
    assert!(
        store::update(&root, &expected)
            .unwrap_err()
            .contains("size/hash mismatch")
    );
    assert_eq!(snapshot(&root), damaged);
    let backup = parent.join(".reader.backup");
    fs::rename(&root, &backup).unwrap();
    assert!(
        store::recover_backup(&root)
            .unwrap_err()
            .contains("size/hash mismatch")
    );
    assert!(backup.exists());
    assert!(!root.exists());
}
