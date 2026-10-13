use lgtmd::{Audience, Doc, Document};
use serde_json::Value;

fn doc() -> Doc {
    let mut doc = Doc::new("sections", "Sections").unwrap();
    doc.require("executed", true).unwrap();
    doc
}

#[test]
fn named_section_links_and_notes_keep_their_target_after_insertions() {
    for prefix in [false, true] {
        let mut doc = doc();
        if prefix {
            doc.paragraph("An unrelated paragraph inserted later.")
                .unwrap();
        }
        let section = doc.heading_with_id("workflow", 2, "Workflow").unwrap();
        assert_eq!(section.id(), "workflow");
        doc.paragraph(section.link("Read the workflow")).unwrap();
        doc.note_on(&section, "A contributor decision attached to this section.")
            .unwrap();
        let document = doc.finish().unwrap();
        for audience in [Audience::Reader, Audience::Contributor] {
            let files = Document::render_many(std::slice::from_ref(&document), audience).unwrap();
            let page = std::str::from_utf8(&files["sections.md"]).unwrap();
            assert!(page.contains("<a id=\"workflow\"></a>\n\n## Workflow"));
            assert!(page.contains("[Read the workflow](#workflow)"));
            assert_eq!(
                page.contains("Contributor note on [workflow](#workflow)"),
                audience == Audience::Contributor
            );
            let manifest: Value = serde_json::from_slice(&files["manifest.json"]).unwrap();
            let blocks = manifest["documents"][0]["blocks"].as_array().unwrap();
            assert!(blocks.iter().any(|block| block["id"] == "workflow"));
            assert!(blocks.iter().any(|block| {
                block["references"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|reference| reference["id"] == "workflow" && reference["kind"] == "block")
            }));
        }
    }
}

#[test]
fn explicit_section_ids_share_evidence_namespace_and_fail_closed() {
    for id in ["executed", "Invalid ID"] {
        let mut doc = doc();
        assert!(doc.heading_with_id(id, 2, "Invalid").is_err());
        assert!(doc.finish().unwrap_err().contains("tainted"));
    }
    let mut duplicate = doc();
    duplicate.heading_with_id("workflow", 2, "First").unwrap();
    assert!(duplicate.heading_with_id("workflow", 2, "Second").is_err());
    assert!(duplicate.finish().unwrap_err().contains("tainted"));

    let mut automatic_collision = doc();
    automatic_collision
        .heading_with_id("block-0002", 2, "Explicit")
        .unwrap();
    assert!(automatic_collision.heading(2, "Automatic").is_err());
    assert!(
        automatic_collision
            .finish()
            .unwrap_err()
            .contains("tainted")
    );
}

#[test]
fn labeled_links_cannot_leak_notes_or_cross_document_ownership() {
    let mut private = doc();
    let note = private.note("Private detail").unwrap();
    private
        .paragraph(note.link("Read the hidden note"))
        .unwrap();
    assert!(private.finish().unwrap_err().contains("excluded block"));

    let mut source = doc();
    let section = source.heading_with_id("workflow", 2, "Workflow").unwrap();
    let mut foreign = doc();
    assert!(foreign.paragraph(section.link("Wrong owner")).is_err());
    assert!(foreign.finish().unwrap_err().contains("tainted"));
}
