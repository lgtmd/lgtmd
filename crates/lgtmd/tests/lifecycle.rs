use lgtmd::{
    Result,
    lifecycle::{self, Files, Ownership},
};
use std::{collections::BTreeSet, fs, path::PathBuf};

fn directory() -> (tempfile::TempDir, PathBuf) {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().canonicalize().unwrap();
    (temporary, root)
}

fn legacy() -> Files {
    Files::from([
        ("README.md".into(), b"<!-- Generated guide. -->\n# Existing guide\n\n![Example](assets/example.webp)\n".to_vec()),
        ("manifest.txt".into(), b"n3 executable documentation v6\nrenderer: macos-metal\nassert: original assertion text\n".to_vec()),
        ("assets/example.webp".into(), vec![82, 73, 70, 70, 0, 1, 2, 3]),
    ])
}

fn accepted(_: &Files, _: &Files) -> Result<()> {
    Ok(())
}

#[test]
fn dedicated_tree_preserves_every_legacy_byte_and_adds_no_metadata() {
    let (_temporary, parent) = directory();
    let root = parent.join("guide");
    let original = legacy();
    assert!(lifecycle::read_tree(&root).unwrap().is_empty());
    assert!(!root.exists());
    lifecycle::update(&root, &original, Ownership::Dedicated, accepted).unwrap();
    assert_eq!(lifecycle::read_tree(&root).unwrap(), original);
    assert!(!root.join(".ownership.json").exists());
    assert!(!root.join("manifest.json").exists());

    lifecycle::check(&root, &original, Ownership::Dedicated, accepted).unwrap();
    assert_eq!(lifecycle::read_tree(&root).unwrap(), original);
    let mut next = original.clone();
    next.get_mut("assets/example.webp").unwrap().push(42);
    assert!(
        lifecycle::check(&root, &next, Ownership::Dedicated, accepted)
            .unwrap_err()
            .contains("assets/example.webp")
    );
    assert_eq!(lifecycle::read_tree(&root).unwrap(), original);
    lifecycle::update(&root, &next, Ownership::Dedicated, accepted).unwrap();
    assert_eq!(lifecycle::read_tree(&root).unwrap(), next);
    assert_eq!(
        fs::read(root.join("manifest.txt")).unwrap(),
        original["manifest.txt"]
    );
    assert_eq!(
        fs::read_dir(&parent).unwrap().count(),
        1,
        "No transaction files remain"
    );
}

#[test]
fn dedicated_tree_refuses_unknown_and_retired_files_without_deleting_them() {
    let (_temporary, parent) = directory();
    let root = parent.join("guide");
    let original = legacy();
    lifecycle::update(&root, &original, Ownership::Dedicated, accepted).unwrap();
    fs::write(root.join("unowned.txt"), "keep this file").unwrap();
    let with_unknown = lifecycle::read_tree(&root).unwrap();
    assert!(
        lifecycle::update(&root, &original, Ownership::Dedicated, accepted)
            .unwrap_err()
            .contains("unowned.txt")
    );
    assert_eq!(lifecycle::read_tree(&root).unwrap(), with_unknown);
    fs::remove_file(root.join("unowned.txt")).unwrap();

    let mut retired = original.clone();
    retired.remove("assets/example.webp");
    assert!(
        lifecycle::update(&root, &retired, Ownership::Dedicated, accepted)
            .unwrap_err()
            .contains("explicit removal")
    );
    assert_eq!(lifecycle::read_tree(&root).unwrap(), original);
    fs::remove_file(root.join("assets/example.webp")).unwrap();
    lifecycle::update(&root, &retired, Ownership::Dedicated, accepted).unwrap();
    assert_eq!(lifecycle::read_tree(&root).unwrap(), retired);
}

#[test]
fn failed_or_panicking_preparation_never_reaches_legacy_publication() {
    let (_temporary, parent) = directory();
    let root = parent.join("guide");
    let original = legacy();
    lifecycle::update(&root, &original, Ownership::Dedicated, accepted).unwrap();
    let failure: Result<Files> = lifecycle::prepare(|| Err("behavior assertion failed".into()));
    let result =
        failure.and_then(|files| lifecycle::update(&root, &files, Ownership::Dedicated, accepted));
    assert!(result.unwrap_err().contains("behavior assertion failed"));
    assert_eq!(lifecycle::read_tree(&root).unwrap(), original);

    let failure: Result<Files> = lifecycle::prepare(|| panic!("capture failed"));
    let result =
        failure.and_then(|files| lifecycle::update(&root, &files, Ownership::Dedicated, accepted));
    assert!(result.unwrap_err().contains("panicked"));
    assert_eq!(lifecycle::read_tree(&root).unwrap(), original);
    assert_eq!(fs::read_dir(&parent).unwrap().count(), 1);
}

#[test]
fn adapter_profile_policy_runs_before_check_or_publication() {
    let (_temporary, parent) = directory();
    let root = parent.join("guide");
    let original = legacy();
    lifecycle::update(&root, &original, Ownership::Dedicated, accepted).unwrap();
    let mut other = original.clone();
    other.insert("manifest.txt".into(), b"renderer: other-profile\n".to_vec());
    let reject = |current: &Files, candidate: &Files| -> Result<()> {
        assert_eq!(current, &original);
        assert_eq!(candidate, &other);
        Err("renderer mismatch from adapter".into())
    };
    assert_eq!(
        lifecycle::check(&root, &other, Ownership::Dedicated, reject).unwrap_err(),
        "renderer mismatch from adapter"
    );
    assert_eq!(
        lifecycle::update(&root, &other, Ownership::Dedicated, reject).unwrap_err(),
        "renderer mismatch from adapter"
    );
    assert_eq!(lifecycle::read_tree(&root).unwrap(), original);
    assert_eq!(fs::read_dir(&parent).unwrap().count(), 1);
}

#[test]
fn generic_inventory_and_duplicate_checks_are_strict() {
    let mut files = Files::new();
    lifecycle::insert(&mut files, "page.md".into(), b"first".to_vec()).unwrap();
    assert!(
        lifecycle::insert(&mut files, "page.md".into(), b"second".to_vec())
            .unwrap_err()
            .contains("Duplicate")
    );
    assert_eq!(files["page.md"], b"first");
    for path in ["../escape", "/absolute", "a//b", "a/./b", "a\\b"] {
        assert!(lifecycle::insert(&mut files, path.into(), Vec::new()).is_err());
    }
    let expected = BTreeSet::from(["registered".into()]);
    lifecycle::check_inventory(&expected, &expected).unwrap();
    let error =
        lifecycle::check_inventory(&expected, &BTreeSet::from(["unexpected".into()])).unwrap_err();
    assert!(error.contains("Missing") && error.contains("unregistered"));
}

#[test]
fn recorded_inventory_is_complete_before_validation_or_publication() {
    let (_temporary, parent) = directory();
    let root = parent.join("guide");
    let original = legacy();
    lifecycle::build(&root, &original, Ownership::Recorded).unwrap();
    fs::remove_file(root.join("assets/example.webp")).unwrap();
    let damaged = lifecycle::read_tree(&root).unwrap();
    let mut replacement = original.clone();
    replacement.remove("assets/example.webp");
    for candidate in [&original, &replacement] {
        let called = std::cell::Cell::new(false);
        let accept = |_: &Files, _: &Files| {
            called.set(true);
            Ok(())
        };
        for result in [
            lifecycle::check(&root, candidate, Ownership::Recorded, accept),
            lifecycle::update(&root, candidate, Ownership::Recorded, accept),
        ] {
            assert!(result.unwrap_err().contains("missing assets/example.webp"));
            assert!(!called.get());
            assert_eq!(lifecycle::read_tree(&root).unwrap(), damaged);
            assert_eq!(fs::read_dir(&parent).unwrap().count(), 1);
        }
    }
}

#[test]
fn path_separation_rejects_lexical_overlap_without_creating_output() {
    let (_temporary, parent) = directory();
    let baseline = parent.join("guide");
    for candidate in [&baseline, &baseline.join("candidate"), &parent] {
        assert!(
            lifecycle::ensure_separate_paths(&baseline, candidate)
                .unwrap_err()
                .contains("overlap")
        );
    }
    lifecycle::ensure_separate_paths(&baseline, &parent.join("guide-sibling")).unwrap();
    assert_eq!(fs::read_dir(&parent).unwrap().count(), 0);
}

#[test]
fn path_separation_uses_existing_identity_without_folding_distinct_names() {
    let (_temporary, parent) = directory();
    let baseline = parent.join("Guide");
    let alias = parent.join("guide");
    fs::create_dir(&baseline).unwrap();
    fs::write(baseline.join("keep.txt"), "retained bytes").unwrap();
    let candidate = alias.join("candidate");

    if alias.exists() {
        assert!(same_file::is_same_file(&baseline, &alias).unwrap());
        for (left, right) in [(&baseline, &candidate), (&candidate, &baseline)] {
            assert!(
                lifecycle::ensure_separate_paths(left, right)
                    .unwrap_err()
                    .contains("overlap")
            );
        }
    } else {
        // A case-sensitive host must keep genuinely distinct directories usable.
        fs::create_dir(&alias).unwrap();
        assert!(!same_file::is_same_file(&baseline, &alias).unwrap());
        lifecycle::ensure_separate_paths(&baseline, &candidate).unwrap();
        lifecycle::ensure_separate_paths(&candidate, &baseline).unwrap();
    }
    assert!(!candidate.exists());
    assert_eq!(
        fs::read(baseline.join("keep.txt")).unwrap(),
        b"retained bytes"
    );
    assert_eq!(fs::read_dir(&baseline).unwrap().count(), 1);
}

#[test]
fn dedicated_recovery_requires_the_adapters_backup_validation() {
    let (_temporary, parent) = directory();
    let root = parent.join("guide");
    let backup = parent.join(".guide.backup");
    let original = legacy();
    lifecycle::update(&root, &original, Ownership::Dedicated, accepted).unwrap();
    fs::rename(&root, &backup).unwrap();
    assert!(
        lifecycle::read_tree(&root)
            .unwrap_err()
            .contains("Interrupted transaction")
    );
    fs::remove_file(backup.join("assets/example.webp")).unwrap();
    let error = lifecycle::recover_backup(&root, Ownership::Dedicated, |files| {
        lifecycle::compare(&original, files)
    })
    .unwrap_err();
    assert!(error.contains("missing assets/example.webp"));
    assert!(!root.exists());
    fs::write(
        backup.join("assets/example.webp"),
        &original["assets/example.webp"],
    )
    .unwrap();
    lifecycle::recover_backup(&root, Ownership::Dedicated, |files| {
        lifecycle::compare(&original, files)
    })
    .unwrap();
    assert_eq!(lifecycle::read_tree(&root).unwrap(), original);
}

#[cfg(unix)]
#[test]
fn dedicated_paths_reject_symlinks_without_touching_targets() {
    use std::os::unix::fs::symlink;
    let (_temporary, parent) = directory();
    let protected = parent.join("protected");
    fs::create_dir(&protected).unwrap();
    fs::write(protected.join("keep"), "untouched").unwrap();
    let link = parent.join("linked");
    symlink(&protected, &link).unwrap();
    assert!(
        lifecycle::read_tree(&link)
            .unwrap_err()
            .to_lowercase()
            .contains("symlink")
    );
    assert!(
        lifecycle::update(
            &link.join("guide"),
            &legacy(),
            Ownership::Dedicated,
            accepted
        )
        .is_err()
    );
    let root = parent.join("guide");
    lifecycle::update(&root, &legacy(), Ownership::Dedicated, accepted).unwrap();
    fs::remove_file(root.join("assets/example.webp")).unwrap();
    symlink(protected.join("keep"), root.join("assets/example.webp")).unwrap();
    assert!(lifecycle::update(&root, &legacy(), Ownership::Dedicated, accepted).is_err());
    assert_eq!(
        fs::read_to_string(protected.join("keep")).unwrap(),
        "untouched"
    );
}
