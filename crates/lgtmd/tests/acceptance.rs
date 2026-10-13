use lgtmd::{Artifact, Audience, Doc, Document};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering};

fn resource(text: &str) -> Artifact {
    Artifact::new(
        text.as_bytes(),
        "text/plain",
        "txt",
        "acceptance",
        "utf8-v1",
    )
    .unwrap()
}

fn all_text(files: &BTreeMap<String, Vec<u8>>) -> String {
    files
        .iter()
        .map(|(path, bytes)| format!("{path}\n{}", String::from_utf8_lossy(bytes)))
        .collect()
}

fn authored_document(notes: bool) -> Document {
    let mut doc = Doc::new("configuration", "Configuration").unwrap();
    let port = doc.expect_eq("port-preserved", 8080, 8080).unwrap();
    doc.heading(2, "Choose a port").unwrap();
    if notes {
        doc.note("INTERNAL NOTE: explain the fixed fixture.")
            .unwrap();
    }
    let paragraph = doc.paragraph(("The port is ", &port, ".")).unwrap();
    let output = doc.resource("settings", resource("port=8080")).unwrap();
    doc.code(&output, "text").unwrap();
    doc.paragraph(("Download ", &output, " to reuse it."))
        .unwrap();
    if notes {
        let private = doc
            .resource(
                "private-observation",
                Artifact::new(
                    b"PRIVATE RESOURCE BODY",
                    "application/x-private-review",
                    "bin",
                    "private-review-producer",
                    "private-review-profile",
                )
                .unwrap(),
            )
            .unwrap();
        doc.note_on(&paragraph, ("Check this paragraph against ", &private, "."))
            .unwrap();
        doc.note_on(&output, "INTERNAL CAPTURE NOTE").unwrap();
    }
    doc.finish().unwrap()
}

#[test]
fn notes_do_not_change_any_reader_byte_or_resource_identity() {
    let without = Document::render_many(&[authored_document(false)], Audience::Reader).unwrap();
    let with = Document::render_many(&[authored_document(true)], Audience::Reader).unwrap();
    assert_eq!(
        without, with,
        "Audience filtering must precede stable public identities"
    );
    let reader = all_text(&with);
    for private in [
        "INTERNAL",
        "PRIVATE RESOURCE",
        "private-observation",
        "private-review",
        "x-private-review",
    ] {
        assert!(!reader.contains(private), "Reader leaked {private}");
    }
    assert_eq!(with.keys().filter(|path| path.ends_with(".txt")).count(), 1);

    let contributor =
        Document::render_many(&[authored_document(true)], Audience::Contributor).unwrap();
    let contributor_text = all_text(&contributor);
    assert!(contributor_text.contains("INTERNAL CAPTURE NOTE"));
    assert!(contributor_text.contains("PRIVATE RESOURCE BODY"));
}

#[test]
fn private_value_payload_is_not_exposed_through_reader_manifest() {
    let mut doc = Doc::new("private-value", "Notes").unwrap();
    doc.require("public-condition", true).unwrap();
    doc.paragraph("The configuration is valid.").unwrap();
    let private = doc
        .expect_eq("diagnostic", "INTERNAL-TOKEN", "INTERNAL-TOKEN")
        .unwrap();
    doc.note(("Internal observation: ", &private)).unwrap();
    let document = doc.finish().unwrap();
    let reader = Document::render_many(std::slice::from_ref(&document), Audience::Reader).unwrap();
    assert!(!all_text(&reader).contains("INTERNAL-TOKEN"));
    let contributor = Document::render_many(&[document], Audience::Contributor).unwrap();
    assert!(all_text(&contributor).contains("INTERNAL-TOKEN"));
}

#[test]
fn annotating_an_existing_check_does_not_change_reader_manifest() {
    let build = |with_note| {
        let mut doc = Doc::new("checks", "Checks").unwrap();
        let claim = doc.require("preserves-output", true).unwrap();
        doc.paragraph("Invalid input preserves the original output.")
            .unwrap();
        if with_note {
            doc.note_on(
                &claim,
                "Compare complete bytes rather than only the parsed port.",
            )
            .unwrap();
        }
        Document::render_many(&[doc.finish().unwrap()], Audience::Reader).unwrap()
    };
    assert_eq!(build(false), build(true));
}

#[test]
fn rendering_freezes_resources_and_never_reexecutes_application() {
    let executions = AtomicUsize::new(0);
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("observation.txt");
    std::fs::write(&path, "first observation").unwrap();
    let document = {
        executions.fetch_add(1, Ordering::SeqCst);
        let mut doc = Doc::new("frozen", "Frozen evidence").unwrap();
        let mut value = String::from("first observation");
        let checked = doc.expect_eq("observed", &value, &value).unwrap();
        doc.paragraph(("Observed: ", &checked)).unwrap();
        let artifact =
            Artifact::from_file(&path, "text/plain", "txt", "fixture", "utf8-v1").unwrap();
        let frozen = doc.resource("file", artifact).unwrap();
        doc.code(&frozen, "text").unwrap();
        value.clear();
        std::fs::write(&path, "changed after capture").unwrap();
        doc.finish().unwrap()
    };
    for audience in [Audience::Reader, Audience::Contributor, Audience::Reader] {
        let files = Document::render_many(std::slice::from_ref(&document), audience).unwrap();
        assert!(all_text(&files).contains("first observation"));
        assert!(!all_text(&files).contains("changed after capture"));
    }
    assert_eq!(executions.load(Ordering::SeqCst), 1);
}

#[test]
fn a_foreign_note_target_cannot_be_smuggled_into_reader_only_rendering() {
    let mut first = Doc::new("first", "First").unwrap();
    let claim = first.require("valid", true).unwrap();
    first.paragraph("First document.").unwrap();
    first.finish().unwrap();

    let mut second = Doc::new("second", "Second").unwrap();
    second.require("valid", true).unwrap();
    second.paragraph("Second document.").unwrap();
    assert!(second.note_on(&claim, "Foreign target").is_err());
    assert!(
        second.finish().is_err(),
        "Ignoring a note error cannot bless the candidate"
    );
}

#[test]
fn duplicate_document_identity_fails_the_complete_bundle() {
    let document = authored_document(false);
    let result = Document::render_many(&[document.clone(), document], Audience::Reader);
    assert!(result.is_err());
}

#[test]
fn code_fences_preserve_backticks_without_manufacturing_links() {
    let mut doc = Doc::new("fences", "Literal output").unwrap();
    doc.require("command-produced-text", true).unwrap();
    let text = "```\n[not a link](missing.txt)\n```\n";
    let artifact = doc.resource("transcript", resource(text)).unwrap();
    doc.code(&artifact, "text").unwrap();
    let files = Document::render_many(&[doc.finish().unwrap()], Audience::Reader).unwrap();
    let markdown = String::from_utf8_lossy(&files["fences.md"]);
    let parser = pulldown_cmark::Parser::new(&markdown);
    assert!(!parser.into_iter().any(|event| matches!(
        event,
        pulldown_cmark::Event::Start(pulldown_cmark::Tag::Link { .. })
    )));
    assert!(markdown.contains(text));
}
