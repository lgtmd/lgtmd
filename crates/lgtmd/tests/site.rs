use lgtmd::{
    Artifact, Audience, BindingValue, Doc, Document, Result,
    lifecycle::{self, Files},
    review,
    site::{
        self,
        store::{self, StoreKind},
    },
    transport::{self, Input},
};
use serde_json::{Value, json};

fn docs(text: &str, image: u8, note: &str, profile: &str) -> Result<Vec<Document>> {
    let mut doc = Doc::new("intro", "Introduction")?;
    let private = doc.observe("internal-value", "NEVER-PUBLIC")?;
    let count = doc.observe("count", 3)?;
    let check = doc.require("not-rendered", true)?;
    let key = doc.binding(
        "shortcut",
        BindingValue::Keys(vec!["Ctrl".into(), "S".into()]),
    )?;
    let section = doc.heading_with_id("overview", 2, "Overview")?;
    doc.paragraph((text, " Count: ", &count, ". Press ", &key, "."))?;
    let screenshot = doc.resource(
        "screen",
        Artifact::new(vec![image], "image/png", "png", "fixture", profile)?,
    )?;
    doc.paragraph(screenshot.image("Application"))?;
    let secret = doc.resource(
        "private",
        Artifact::new(
            vec![91],
            "text/plain",
            "txt",
            "private-producer",
            "private-profile",
        )?,
    )?;
    doc.note_on(
        &section,
        (note, " ", &private, " ", secret.link("Private attachment")),
    )?;
    doc.note_on(&check, "An unattached check note")?;
    doc.markdown("A **strong** and *emphasized* [external link](https://example.com).\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n- First\n- Second\n\n```js\nconst answer = 42;\n```\n\n![Remote](https://example.com/remote.png)")?;
    Ok(vec![doc.finish()?])
}
fn compile(text: &str, image: u8, note: &str, profile: &str) -> site::Compiled {
    site::compile(
        &Input::from_documents(&docs(text, image, note, profile).unwrap()).unwrap(),
        "Example",
        None,
    )
    .unwrap()
}
fn rewrite(files: &mut Files, change: impl FnOnce(&mut Value)) {
    let mut bundle: Value = serde_json::from_slice(&files["bundle.json"]).unwrap();
    change(&mut bundle);
    bundle["digest"] = json!("");
    let digest = site::sha256(&site::canonical(&bundle).unwrap());
    bundle["digest"] = json!(digest);
    bundle.sort_all_objects();
    let mut bytes = serde_json::to_vec_pretty(&bundle).unwrap();
    bytes.push(b'\n');
    files.insert("bundle.json".into(), bytes);
}
#[test]
fn site_is_audience_filtered_and_legacy_markdown_is_unchanged() {
    let documents = docs("Welcome", 1, "Internal note", "exact").unwrap();
    let compiled =
        site::compile(&Input::from_documents(&documents).unwrap(), "Example", None).unwrap();
    assert_eq!(
        compiled.markdown.reader,
        lgtmd::render(&documents, Audience::Reader).unwrap()
    );
    assert_eq!(
        compiled.markdown.contributor,
        lgtmd::render(&documents, Audience::Contributor).unwrap()
    );
    let reader = String::from_utf8(compiled.reader.files["bundle.json"].clone()).unwrap();
    for private in [
        "NEVER-PUBLIC",
        "Internal note",
        "internal-value",
        "private-profile",
        "private-producer",
        "not-rendered",
    ] {
        assert!(!reader.contains(private), "leaked {private}");
    }
    assert_eq!(compiled.reader.bundle.resources.len(), 1);
    assert!(compiled.reader.bundle.pages[0].notes.is_empty());
    let notes = &compiled.contributor.bundle.pages[0].notes;
    assert_eq!(notes.len(), 2);
    assert_eq!(notes[0].anchor.as_deref(), Some("overview"));
    assert_eq!(notes[1].anchor, None);
    assert_eq!(notes[1].target.as_ref().unwrap().kind, "claim");
    assert!(!reader.contains("remote.png\",\n          \"type\": \"image"));
    assert_eq!(
        site::validate(&compiled.reader.files).unwrap().bundle,
        compiled.reader.bundle
    );
}
#[test]
fn shared_frozen_fixture_compiles_without_changing_markdown() {
    let fixture: Value = serde_json::from_str(include_str!("fixtures/portable.json")).unwrap();
    let input: Input = serde_json::from_value(fixture["input"].clone()).unwrap();
    let compiled = site::compile(&input, "Portable", None).unwrap();
    assert_eq!(
        compiled.markdown.reader,
        transport::compile(&input, &Default::default())
            .unwrap()
            .reader
    );
}
#[test]
fn markdown_parts_continue_across_anchors_and_notes_do_not_shift_reader() {
    let mut doc = Doc::new("parts", "Parts").unwrap();
    doc.markdown_parts("First half ").unwrap();
    doc.markdown_parts("and second half.\n\n").unwrap();
    let base = Input::from_documents(&[doc.finish().unwrap()]).unwrap();
    let compiled = site::compile(&base, "Parts", None).unwrap();
    assert_eq!(compiled.reader.bundle.pages[0].anchors.len(), 2);
    assert_eq!(
        compiled.reader.bundle.pages[0]
            .content
            .iter()
            .filter(|n| n.kind == "paragraph")
            .count(),
        2
    );
    assert!(
        compiled.reader.bundle.pages[0]
            .content
            .iter()
            .any(|node| node.kind == "paragraph"
                && node.children.iter().any(|child| child.kind == "anchor"))
    );
}
#[test]
fn exact_comparison_covers_text_resources_profiles_private_notes_and_audiences() {
    let a = compile("Before", 1, "Secret A", "exact");
    let note = compile("Before", 1, "Secret B", "exact");
    assert_eq!(a.reader.bundle.digest, note.reader.bundle.digest);
    assert_ne!(a.contributor.bundle.digest, note.contributor.bundle.digest);
    assert_ne!(a.candidate_id, note.candidate_id);
    assert_eq!(
        review::compare(&a.reader.files, &note.reader.files)
            .unwrap()
            .pages[0]
            .status,
        "unchanged"
    );
    let image = compile("Before", 2, "Secret A", "exact");
    let diff = review::compare(&a.reader.files, &image.reader.files).unwrap();
    assert_eq!(diff.pages[0].status, "changed");
    assert_eq!(diff.resources[0].status, "changed");
    assert!(diff.resources[0].compatible);
    let profile = compile("Before", 1, "Secret A", "other");
    let diff = review::compare(&a.reader.files, &profile.reader.files).unwrap();
    assert!(!diff.resources[0].compatible);
    assert_eq!(diff.resources[0].compatibility, "different-profile");
    let text = compile("After", 1, "Secret A", "exact");
    assert_eq!(
        review::compare(&a.reader.files, &text.reader.files)
            .unwrap()
            .pages[0]
            .status,
        "changed"
    );
    assert!(review::compare(&a.reader.files, &a.contributor.files).is_err());
}
#[test]
fn historical_navigation_survives_added_removed_pages() {
    let mut one = Doc::new("one", "One").unwrap();
    one.paragraph("Page one").unwrap();
    let one = one.finish().unwrap();
    let mut two = Doc::new("two", "Two").unwrap();
    two.paragraph("Page two").unwrap();
    let two = two.finish().unwrap();
    let before = site::compile(
        &Input::from_documents(std::slice::from_ref(&one)).unwrap(),
        "Old",
        None,
    )
    .unwrap();
    let after = site::compile(
        &Input::from_documents(&[two, one]).unwrap(),
        "New",
        Some(&["two".into(), "one".into()]),
    )
    .unwrap();
    let diff = review::compare(&before.reader.files, &after.reader.files).unwrap();
    assert!(diff.site_changed);
    assert_eq!(diff.pages[0].status, "unchanged");
    assert_eq!(diff.pages[1].status, "added");
    assert_eq!(
        review::compare(&after.reader.files, &before.reader.files)
            .unwrap()
            .pages[1]
            .status,
        "removed"
    );
    assert_eq!(
        site::validate(&before.reader.files)
            .unwrap()
            .bundle
            .navigation,
        vec!["one"]
    );
    assert!(
        site::compile(
            &Input::from_documents(&docs("A", 1, "N", "P").unwrap()).unwrap(),
            "Title",
            Some(&[])
        )
        .is_err()
    );
}
#[test]
fn retained_content_is_semantically_validated_even_with_recomputed_hashes() {
    let base = compile("Before", 1, "Secret", "exact").reader.files;
    for change in [
        |v: &mut Value| v["pages"][0]["content"][0]["type"] = json!("script"),
        |v: &mut Value| {
            v["pages"][0]["content"][0] = json!({"type":"link","url":"javascript:alert(1)"})
        },
        |v: &mut Value| {
            v["pages"][0]["content"][0] = json!({"type":"link","url":"data:text/html,bad"})
        },
        |v: &mut Value| {
            v["pages"][0]["content"][0] =
                json!({"type":"image","text":"bad","url":"https://example.com"})
        },
        |v: &mut Value| v["pages"][0]["content"][0] = json!({"type":"link","page_id":"absent"}),
        |v: &mut Value| {
            v["pages"][0]["content"][0] = json!({"type":"link","page_id":"intro","id":"absent"})
        },
        |v: &mut Value| v["pages"][0]["notes"] = json!([{"id":"note","content":[]}]),
        |v: &mut Value| v["resources"][0]["path"] = json!("../private.png"),
        |v: &mut Value| v["navigation"] = json!(["intro", "intro"]),
        |v: &mut Value| v["pages"][0]["anchors"] = json!(["nonexistent"]),
        |v: &mut Value| v["schema_version"] = json!(2),
    ] {
        let mut candidate = base.clone();
        rewrite(&mut candidate, change);
        assert!(site::validate(&candidate).is_err());
    }
}
#[test]
fn missing_extra_changed_and_lfs_resources_are_rejected() {
    let compiled = compile("Before", 1, "Secret", "exact");
    let path = compiled.reader.bundle.resources[0].path.clone();
    let mut files = compiled.reader.files.clone();
    files.remove(&path);
    assert!(site::validate(&files).unwrap_err().contains("Missing"));
    let mut files = compiled.reader.files.clone();
    files.insert("extra".into(), vec![1]);
    assert!(site::validate(&files).is_err());
    let mut files = compiled.reader.files.clone();
    files.get_mut(&path).unwrap().push(2);
    assert!(site::validate(&files).unwrap_err().contains("mismatch"));
    let mut files = compiled.reader.files;
    files.insert(
        path,
        b"version https://git-lfs.github.com/spec/v1\noid sha256:123\nsize 1\n".to_vec(),
    );
    assert!(site::validate(&files).unwrap_err().contains("LFS"));
}
#[test]
fn guarded_site_replacement_retires_owned_files_but_rejects_unrelated_content() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().canonicalize().unwrap().join("snapshot");
    let a = compile("Before", 1, "Secret", "exact");
    store::publish("update", &path, &a.reader.files, StoreKind::Snapshot).unwrap();
    let mut doc = Doc::new("other", "Other").unwrap();
    doc.paragraph("Replacement").unwrap();
    let b = site::compile(
        &Input::from_documents(&[doc.finish().unwrap()]).unwrap(),
        "New",
        None,
    )
    .unwrap();
    store::publish("update", &path, &b.reader.files, StoreKind::Snapshot).unwrap();
    assert!(!path.join(&a.reader.bundle.resources[0].path).exists());
    store::publish("check", &path, &b.reader.files, StoreKind::Snapshot).unwrap();
    std::fs::write(path.join("unrelated.txt"), "user data").unwrap();
    assert!(
        store::publish("update", &path, &a.reader.files, StoreKind::Snapshot)
            .unwrap_err()
            .contains("Unowned")
    );
    assert_eq!(
        std::fs::read_to_string(path.join("unrelated.txt")).unwrap(),
        "user data"
    );
}
#[test]
fn static_reader_replacement_removes_all_old_contributor_assets() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().canonicalize().unwrap().join("site");
    let a = compile("Before", 1, "Secret", "exact");
    let mut contributor = a.contributor.files.clone();
    contributor.insert("index.html".into(), b"site".to_vec());
    contributor.insert("viewer-old.js".into(), b"old build".to_vec());
    store::publish("update", &path, &contributor, StoreKind::Static).unwrap();
    let mut reader = a.reader.files.clone();
    reader.insert("index.html".into(), b"site".to_vec());
    reader.insert("viewer-new.js".into(), b"new build".to_vec());
    let published = store::publish("update", &path, &reader, StoreKind::Static).unwrap();
    assert!(!path.join("viewer-old.js").exists());
    assert!(!path.join("assets/intro/private.txt").exists());
    let raw = lifecycle::read_tree(&path).unwrap();
    assert_eq!(
        store::validate_files(&raw, StoreKind::Static)
            .unwrap()
            .files,
        published
    );
    assert_eq!(
        store::validate_files(&raw, StoreKind::Static)
            .unwrap()
            .bundle
            .unwrap()
            .audience,
        "reader"
    );
    let mut corrupt = raw.clone();
    corrupt.insert("viewer-new.js".into(), b"changed".to_vec());
    assert!(store::validate_files(&corrupt, StoreKind::Static).is_err());
    let mut unowned = raw;
    unowned.insert("private.txt".into(), b"secret".to_vec());
    assert!(store::validate_files(&unowned, StoreKind::Static).is_err());
}
#[test]
fn portable_ownership_marker_is_validated_before_stripping() {
    let compiled = compile("Before", 1, "Secret", "exact");
    let mut files = compiled.reader.files;
    let paths: Vec<_> = files.keys().cloned().collect();
    files.insert(
        ".ownership.json".into(),
        serde_json::to_vec(&json!({"schema_version":1,"files":paths})).unwrap(),
    );
    assert!(store::validate_files(&files, StoreKind::Snapshot).is_ok());
    files.insert("extra.txt".into(), vec![]);
    assert!(store::validate_files(&files, StoreKind::Snapshot).is_err());
}
#[test]
fn explicit_markdown_recording_retires_files_without_changing_legacy_store_policy() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().canonicalize().unwrap().join("guide");
    let a = compile("Before", 1, "Secret", "exact");
    store::publish("update", &path, &a.markdown.reader, StoreKind::Markdown).unwrap();
    let mut doc = Doc::new("fresh", "Fresh").unwrap();
    doc.paragraph("New guide").unwrap();
    let files = lgtmd::render(&[doc.finish().unwrap()], Audience::Reader).unwrap();
    assert!(lgtmd::store::update(&path, &files).is_err());
    store::publish("update", &path, &files, StoreKind::Markdown).unwrap();
    assert!(!path.join("intro.md").exists());
    assert!(path.join("fresh.md").exists());
}

#[test]
fn resource_changes_mark_every_referencing_page_changed() {
    let make = |image: u8| {
        let mut owner = Doc::new("owner", "Image owner").unwrap();
        let resource = owner
            .resource(
                "screen",
                Artifact::new(vec![image], "image/png", "png", "fixture", "exact").unwrap(),
            )
            .unwrap();
        owner.paragraph(resource.image("Owner")).unwrap();
        let mut other = Doc::new("other", "Other page").unwrap();
        other
            .markdown("![Shared image](assets/owner/screen.png)")
            .unwrap();
        site::compile(
            &Input::from_documents(&[owner.finish().unwrap(), other.finish().unwrap()]).unwrap(),
            "Example",
            None,
        )
        .unwrap()
    };
    let before = make(1);
    let after = make(2);
    let diff = review::compare(&before.reader.files, &after.reader.files).unwrap();
    assert!(diff.pages.iter().all(|page| page.status == "changed"));
}

#[test]
fn note_anchor_can_follow_unterminated_markdown_paragraph() {
    let mut doc = Doc::new("continuation", "Continuation").unwrap();
    let previous = doc.markdown_parts("First half ").unwrap();
    doc.note_on(&previous, "Private note after a continued paragraph")
        .unwrap();
    doc.markdown_parts("and second half.\n\n").unwrap();
    let compiled = site::compile(
        &Input::from_documents(&[doc.finish().unwrap()]).unwrap(),
        "Example",
        None,
    )
    .unwrap();
    assert_eq!(compiled.contributor.bundle.pages[0].notes.len(), 1);
    assert!(compiled.reader.bundle.pages[0].notes.is_empty());
}
