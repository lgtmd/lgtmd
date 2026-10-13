use lgtmd::{Artifact, Audience, Doc, Document, ExportLayout};
use pulldown_cmark::{Event, Parser, Tag};
use serde_json::Value;

fn doc(id: &str) -> Doc {
    let mut doc = Doc::new(id, id).unwrap();
    doc.require("executed", true).unwrap();
    doc
}

fn text() -> Artifact {
    Artifact::new(b"frozen evidence", "text/plain", "txt", "host", "v1").unwrap()
}

#[test]
fn default_layout_preserves_all_export_bytes_and_freezes_no_repository_paths() {
    let mut doc = doc("guide");
    let resource = doc.text("result", "actual result").unwrap();
    doc.paragraph(resource.link("Result")).unwrap();
    doc.note("Private rationale").unwrap();
    let document = doc.finish().unwrap();
    for audience in [Audience::Reader, Audience::Contributor] {
        let ordinary = Document::render_many(std::slice::from_ref(&document), audience).unwrap();
        assert_eq!(
            ordinary,
            document
                .render_with(audience, &ExportLayout::default())
                .unwrap()
        );
        assert_eq!(
            ordinary,
            lgtmd::render_with(
                std::slice::from_ref(&document),
                audience,
                &ExportLayout::default()
            )
            .unwrap()
        );
        assert_eq!(ordinary["assets/guide/result.txt"], b"actual result");
    }
    let root_resources = ExportLayout::default().resources_under("").unwrap();
    let files = document
        .render_with(Audience::Reader, &root_resources)
        .unwrap();
    assert_eq!(files["guide/result.txt"], b"actual result");
    assert!(!files.contains_key("assets/guide/result.txt"));
}

#[test]
fn nested_pages_use_relative_encoded_urls_for_typed_resources_and_keep_explicit_paths() {
    let mut doc = doc("start");
    let automatic = doc.text("result", "actual result").unwrap();
    let explicit = doc
        .resource_at("explicit", text(), "downloads/a&copy;-é.txt")
        .unwrap();
    doc.paragraph((
        automatic.link("Automatic"),
        " and ",
        explicit.link("Explicit"),
    ))
    .unwrap();
    doc.embed(&explicit, "Download").unwrap();
    let document = doc.finish().unwrap();
    let layout = ExportLayout::default()
        .pages_under("manual/chapters")
        .unwrap()
        .resources_under("evidence/frozen")
        .unwrap()
        .page("start", "manual/入口/index.md")
        .unwrap();
    let files = document.render_with(Audience::Reader, &layout).unwrap();
    assert!(files.contains_key("manual/入口/index.md"));
    assert_eq!(files["downloads/a&copy;-é.txt"], b"frozen evidence");
    assert_eq!(files["evidence/frozen/start/result.txt"], b"actual result");
    let page = std::str::from_utf8(&files["manual/入口/index.md"]).unwrap();
    let links: Vec<_> = Parser::new(page)
        .filter_map(|event| match event {
            Event::Start(Tag::Link { dest_url, .. }) => Some(dest_url.into_string()),
            _ => None,
        })
        .collect();
    assert_eq!(
        links,
        [
            "../../evidence/frozen/start/result.txt",
            "../../downloads/a%26copy%3B-%C3%A9.txt",
            "../../downloads/a%26copy%3B-%C3%A9.txt"
        ]
    );
    let manifest: Value = serde_json::from_slice(&files["manifest.json"]).unwrap();
    let page_record = manifest["artifacts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|record| record["kind"] == "page")
        .unwrap();
    assert_eq!(page_record["path"], "manual/入口/index.md");
}

#[test]
fn authored_relative_links_resolve_from_selected_page_and_validate_generated_anchors() {
    let mut first = doc("first");
    first
        .markdown("[Second](../reference/second.md#details)")
        .unwrap();
    let mut second = doc("second");
    second.heading_with_id("details", 2, "Details").unwrap();
    second
        .resource_at("result", text(), "downloads/data.txt")
        .unwrap();
    second.markdown("[Data](../../downloads/data.txt)").unwrap();
    let documents = [first.finish().unwrap(), second.finish().unwrap()];
    let layout = ExportLayout::default()
        .page("first", "manual/start/index.md")
        .unwrap()
        .page("second", "manual/reference/second.md")
        .unwrap();
    let files = Document::render_many_with(&documents, Audience::Reader, &layout).unwrap();
    assert_eq!(files["downloads/data.txt"], b"frozen evidence");
    assert!(Document::render_many(&documents, Audience::Reader).is_err());
    let changed_layout = ExportLayout::default()
        .page("first", "manual/start/index.md")
        .unwrap()
        .page("second", "manual/reference/moved.md")
        .unwrap();
    assert!(
        Document::render_many_with(&documents, Audience::Reader, &changed_layout)
            .unwrap_err()
            .contains("Broken")
    );
}

#[test]
fn selected_layout_rejects_parent_traversal_outside_bundle_including_encoded_paths() {
    let layout = ExportLayout::default().pages_under("manual").unwrap();
    for link in [
        "../../secret.txt",
        "%2e%2e/%2e%2e/secret.txt",
        "../%2e%2e/secret.txt",
        "/secret.txt",
        "https:///missing",
    ] {
        let mut doc = doc("guide");
        doc.markdown(&format!("[Bad]({link})")).unwrap();
        let document = doc.finish().unwrap();
        assert!(
            document.render_with(Audience::Reader, &layout).is_err(),
            "Accepted {link}"
        );
    }
}

#[test]
fn layout_validation_rejects_unsafe_and_unknown_configuration() {
    for path in [
        "/absolute",
        "../outside",
        "a/../outside",
        "a//b",
        "a/./b",
        "a\\b",
        "manifest.json",
        "manifest.json/guide.md",
        ".ownership.json",
        ".ownership.json/file.txt",
        "a?b",
        "a#b",
        "a%2Fb",
    ] {
        assert!(
            ExportLayout::default().pages_under(path).is_err(),
            "pages {path}"
        );
        assert!(
            ExportLayout::default().resources_under(path).is_err(),
            "resources {path}"
        );
        assert!(
            ExportLayout::default().page("guide", path).is_err(),
            "page {path}"
        );
    }
    assert!(ExportLayout::default().page("guide", "").is_err());
    assert!(ExportLayout::default().page("bad/id", "guide.md").is_err());
    assert!(
        ExportLayout::default()
            .page("guide", "one.md")
            .unwrap()
            .page("guide", "two.md")
            .is_err()
    );
    let layout = ExportLayout::default().page("missing", "one.md").unwrap();
    let document = doc("guide").finish().unwrap();
    assert!(
        document
            .render_with(Audience::Reader, &layout)
            .unwrap_err()
            .contains("unknown document")
    );
}

#[test]
fn layout_collisions_include_hidden_resources_and_file_directory_conflicts() {
    let mut first = doc("first");
    let private = first
        .resource_at("private", text(), "manual/second.md")
        .unwrap();
    first.note((&private, ": private evidence")).unwrap();
    let second = doc("second").finish().unwrap();
    let layout = ExportLayout::default().pages_under("manual").unwrap();
    assert!(
        Document::render_many_with(
            &[first.finish().unwrap(), second],
            Audience::Reader,
            &layout
        )
        .unwrap_err()
        .contains("Duplicate artifact path")
    );

    let mut guide = doc("guide");
    let resource = guide.resource_at("file", text(), "manual").unwrap();
    guide.paragraph(&resource).unwrap();
    assert!(
        guide
            .finish()
            .unwrap()
            .render_with(Audience::Reader, &layout)
            .unwrap_err()
            .contains("file/directory collision")
    );
}

#[test]
fn nested_layout_keeps_private_resources_and_metadata_out_of_reader_bundle() {
    let mut doc = doc("guide");
    doc.paragraph("Public text").unwrap();
    let resource = doc
        .resource_at("secret", text(), "private/secret.txt")
        .unwrap();
    doc.note(("Private attachment: ", &resource)).unwrap();
    let document = doc.finish().unwrap();
    let layout = ExportLayout::default()
        .pages_under("manual/chapters")
        .unwrap()
        .resources_under("evidence")
        .unwrap();
    let reader = document.render_with(Audience::Reader, &layout).unwrap();
    let contributor = document
        .render_with(Audience::Contributor, &layout)
        .unwrap();
    assert!(!reader.contains_key("private/secret.txt"));
    assert!(contributor.contains_key("private/secret.txt"));
    assert!(!String::from_utf8_lossy(&reader["manifest.json"]).contains("secret"));
    assert!(
        String::from_utf8_lossy(&contributor["manual/chapters/guide.md"])
            .contains("../../private/secret.txt")
    );
}

#[test]
fn layout_dependent_orphans_fail_before_any_export_returns() {
    let mut doc = doc("guide");
    doc.text("unused", "unused bytes").unwrap();
    let document = doc.finish().unwrap();
    assert!(
        document
            .render_fragment(Audience::Reader)
            .unwrap_err()
            .contains("Unreferenced")
    );
    assert!(
        document
            .resource_files(Audience::Reader)
            .unwrap_err()
            .contains("Unreferenced")
    );
    assert!(
        document
            .render_with(
                Audience::Reader,
                &ExportLayout::default().pages_under("manual").unwrap()
            )
            .unwrap_err()
            .contains("Unreferenced")
    );
}

#[test]
fn explicit_resource_paths_do_not_conflict_with_unselected_default_paths() {
    let mut doc = doc("guide");
    let automatic = doc.text("first", "automatic").unwrap();
    let explicit = doc
        .resource_at("second", text(), "assets/guide/first.txt")
        .unwrap();
    doc.paragraph((&automatic, " and ", &explicit)).unwrap();
    let document = doc.finish().unwrap();
    assert!(
        document
            .render_with(Audience::Reader, &ExportLayout::default())
            .unwrap_err()
            .contains("Duplicate artifact path")
    );
    let layout = ExportLayout::default().resources_under("evidence").unwrap();
    let files = document.render_with(Audience::Reader, &layout).unwrap();
    assert_eq!(files["evidence/guide/first.txt"], b"automatic");
    assert_eq!(files["assets/guide/first.txt"], b"frozen evidence");
}

#[test]
fn nested_cross_document_links_cannot_reference_excluded_notes_or_resources() {
    for use_note in [true, false] {
        let mut second = doc("second");
        let secret = second
            .resource_at("secret", text(), "private/secret.txt")
            .unwrap();
        let note = second.note((&secret, ": private evidence")).unwrap();
        let target = if use_note {
            format!("second.md#{}", note.id())
        } else {
            "../../private/secret.txt".into()
        };
        let mut first = doc("first");
        first.markdown(&format!("[Excluded]({target})")).unwrap();
        let layout = ExportLayout::default()
            .pages_under("manual/chapters")
            .unwrap();
        let documents = [first.finish().unwrap(), second.finish().unwrap()];
        assert!(Document::render_many_with(&documents, Audience::Reader, &layout).is_err());
        assert!(Document::render_many_with(&documents, Audience::Contributor, &layout).is_ok());
    }
}

#[test]
fn fragments_and_resource_exports_reject_impossible_file_directory_inventories() {
    let mut doc = doc("guide");
    let parent = doc.resource_at("parent", text(), "downloads").unwrap();
    let child = doc
        .resource_at("child", text(), "downloads/file.txt")
        .unwrap();
    doc.paragraph((&parent, " and ", &child)).unwrap();
    let document = doc.finish().unwrap();
    assert!(
        document
            .render_fragment(Audience::Reader)
            .unwrap_err()
            .contains("file/directory collision")
    );
    assert!(
        document
            .resource_files(Audience::Reader)
            .unwrap_err()
            .contains("file/directory collision")
    );
}

#[test]
fn reserved_ownership_metadata_cannot_be_registered_as_contributor_only_evidence() {
    for path in [
        ".ownership.json",
        ".ownership.json/private.txt",
        "manifest.json/private.txt",
    ] {
        let mut document = doc("guide");
        document.paragraph("Reader narrative").unwrap();
        let result = document
            .resource_at("private", text(), path)
            .and_then(|resource| document.note(("Contributor evidence: ", &resource)));
        assert!(result.unwrap_err().contains("reserved"), "Accepted {path}");
        assert!(
            document.finish().is_err(),
            "Swallowing private registration failure must taint the document"
        );
    }
}
