use lgtmd::{Audience, Doc, Document, ExportLayout, lifecycle, store};
use serde_json::Value;
use std::{fs, path::PathBuf};

fn directory() -> (tempfile::TempDir, PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    (temp, root)
}

fn files(page: &str, text: &str) -> store::Files {
    let mut document = Doc::new("example", "An independently placed page").unwrap();
    document.require("completed", true).unwrap();
    let output = document.text("output", text).unwrap();
    document
        .paragraph(("The observed output is in ", &output, "."))
        .unwrap();
    let layout = ExportLayout::default()
        .resources_under("evidence/observations")
        .unwrap()
        .page("example", page)
        .unwrap();
    Document::render_many_with(&[document.finish().unwrap()], Audience::Reader, &layout).unwrap()
}

fn edit_manifest(files: &mut store::Files, edit: impl FnOnce(&mut Value)) {
    let mut manifest: Value = serde_json::from_slice(&files["manifest.json"]).unwrap();
    edit(&mut manifest);
    files.insert(
        "manifest.json".into(),
        serde_json::to_vec_pretty(&manifest).unwrap(),
    );
}

#[test]
fn custom_nested_exports_build_check_update_and_recover() {
    let (_temp, parent) = directory();
    let root = parent.join("independent-publication");
    let original = files("manual/getting-started/README.md", "original observation");
    assert!(!original.contains_key("example.md"));
    assert!(original.contains_key("evidence/observations/example/output.txt"));
    store::build(&root, &original).unwrap();
    store::check(&root, &original).unwrap();

    let changed = files("manual/getting-started/README.md", "new observation");
    assert!(
        store::check(&root, &changed)
            .unwrap_err()
            .contains("changed")
    );
    store::update(&root, &changed).unwrap();
    store::check(&root, &changed).unwrap();

    // Recovery must validate the same manifest-defined page layout as publication.
    fs::rename(&root, parent.join(".independent-publication.backup")).unwrap();
    store::recover_backup(&root).unwrap();
    store::check(&root, &changed).unwrap();
    assert_eq!(
        fs::read_to_string(root.join("evidence/observations/example/output.txt")).unwrap(),
        "new observation"
    );
}

#[test]
fn moving_a_page_requires_explicit_retirement_of_its_old_owned_path() {
    let (_temp, parent) = directory();
    let root = parent.join("publication");
    let old_page = "manual/start/README.md";
    let original = files(old_page, "same evidence");
    store::build(&root, &original).unwrap();
    let retained = lifecycle::read_tree(&root).unwrap();
    let moved = files("handbook/entry.md", "same evidence");

    assert!(
        store::update(&root, &moved)
            .unwrap_err()
            .contains("explicit removal")
    );
    assert_eq!(lifecycle::read_tree(&root).unwrap(), retained);
    fs::remove_file(root.join(old_page)).unwrap();
    store::update(&root, &moved).unwrap();
    store::check(&root, &moved).unwrap();
    assert!(!root.join(old_page).exists());
    assert!(root.join("handbook/entry.md").is_file());
}

#[test]
fn configurable_paths_do_not_weaken_page_identity_or_inventory_validation() {
    let (_temp, parent) = directory();
    let baseline = parent.join("retained");
    let page = "manual/getting-started/README.md";
    let original = files(page, "frozen evidence");
    store::build(&baseline, &original).unwrap();
    let retained = lifecycle::read_tree(&baseline).unwrap();
    let mut candidates = Vec::new();

    let mut missing = original.clone();
    missing.remove(page);
    edit_manifest(&mut missing, |manifest| {
        manifest["artifacts"]
            .as_array_mut()
            .unwrap()
            .retain(|record| record["kind"] != "page");
    });
    candidates.push(("missing page", missing));

    let mut duplicate = original.clone();
    duplicate.insert("manual/extra.md".into(), original[page].clone());
    edit_manifest(&mut duplicate, |manifest| {
        let mut record = manifest["artifacts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|record| record["kind"] == "page")
            .unwrap()
            .clone();
        record["path"] = "manual/extra.md".into();
        manifest["artifacts"].as_array_mut().unwrap().push(record);
    });
    candidates.push(("duplicate page identity", duplicate));

    for (name, field, value) in [
        ("unknown document", "document", "other-document"),
        ("wrong MIME", "mime", "text/plain"),
        ("unsafe path", "path", "../outside.md"),
        ("reserved path", "path", ".ownership.json/page.md"),
    ] {
        let mut candidate = original.clone();
        edit_manifest(&mut candidate, |manifest| {
            let record = manifest["artifacts"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|record| record["kind"] == "page")
                .unwrap();
            record[field] = value.into();
        });
        candidates.push((name, candidate));
    }
    let mut collision = original.clone();
    collision.insert(
        "manual".into(),
        b"cannot be a file and a directory".to_vec(),
    );
    candidates.push(("file and directory collision", collision));
    let mut corrupt = original.clone();
    corrupt.insert(page.into(), b"changed without a matching receipt".to_vec());
    candidates.push(("stale page hash", corrupt));

    for (index, (name, candidate)) in candidates.into_iter().enumerate() {
        let fresh = parent.join(format!("rejected-{index}"));
        assert!(
            store::build(&fresh, &candidate).is_err(),
            "build accepted {name}"
        );
        assert!(!fresh.exists(), "build wrote invalid {name}");
        assert!(
            store::check(&baseline, &candidate).is_err(),
            "check accepted {name}"
        );
        assert!(
            store::update(&baseline, &candidate).is_err(),
            "update accepted {name}"
        );
        assert_eq!(
            lifecycle::read_tree(&baseline).unwrap(),
            retained,
            "{name} changed retained evidence"
        );
    }
}
