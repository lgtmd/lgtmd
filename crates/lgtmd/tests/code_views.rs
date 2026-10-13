use lgtmd::{Artifact, Audience, Doc, Document};
use pulldown_cmark::{Event, Parser, Tag};
use serde_json::Value;

#[test]
fn a_typed_code_view_shares_one_frozen_resource_with_its_download() {
    let mut doc = Doc::new("configuration", "Configuration").unwrap();
    let text = "```\n[not a link](missing.md)\n`````\n";
    let output = doc.text("output", text).unwrap();
    let passage = doc
        .markdown_parts((
            "The command produced:\n\n",
            output.code("text"),
            "\n\nDownload ",
            output.link("the output"),
            ".\n",
        ))
        .unwrap();
    doc.note_on(&passage, "The producer runs once.").unwrap();
    let files = Document::render_many(&[doc.finish().unwrap()], Audience::Reader).unwrap();
    assert_eq!(files["assets/configuration/output.txt"], text.as_bytes());
    assert_eq!(files.len(), 3);
    let page = String::from_utf8_lossy(&files["configuration.md"]);
    let mut code_blocks = 0;
    let mut code_text = String::new();
    let mut in_code = false;
    for event in Parser::new(&page) {
        match event {
            Event::Start(Tag::CodeBlock(_)) => {
                code_blocks += 1;
                in_code = true;
            }
            Event::End(pulldown_cmark::TagEnd::CodeBlock) => in_code = false,
            Event::Text(text) if in_code => code_text.push_str(&text),
            _ => {}
        }
    }
    assert_eq!(code_blocks, 1);
    assert_eq!(code_text, text);
    let manifest: Value = serde_json::from_slice(&files["manifest.json"]).unwrap();
    assert_eq!(
        manifest["documents"][0]["blocks"][0]["references"],
        serde_json::json!([
            {"id": "output", "kind": "resource"},
            {"id": "output", "kind": "resource"}
        ])
    );
}

#[test]
fn isolated_code_views_end_before_the_following_document_block() {
    let mut doc = Doc::new("output", "Output").unwrap();
    let output = doc.text("result", "result").unwrap();
    doc.markdown_parts(output.code("text")).unwrap();
    doc.paragraph("The next explanation remains prose.")
        .unwrap();
    let files = Document::render_many(&[doc.finish().unwrap()], Audience::Reader).unwrap();
    let page = String::from_utf8_lossy(&files["output.md"]);
    assert!(page.contains("```text\nresult\n```\n\n<a id=\"block-0002\"></a>"));
}

#[test]
fn invalid_code_view_placement_or_kind_taints_completion() {
    for (before, after) in [
        ("A value ", " follows."),
        ("    ", ""),
        ("```text\n\n", "\n\n```"),
        ("", "\nThe following paragraph"),
    ] {
        let mut doc = Doc::new("placement", "Placement").unwrap();
        let text = doc.text("result", "frozen output").unwrap();
        assert!(
            doc.markdown_parts((before, text.code("text"), after))
                .is_err(),
            "Accepted code view between {before:?} and {after:?}"
        );
        assert!(doc.finish().is_err());
    }
    let mut paragraph = Doc::new("paragraph", "Paragraph").unwrap();
    let text = paragraph.text("result", "frozen output").unwrap();
    assert!(paragraph.paragraph(text.code("text")).is_err());
    assert!(paragraph.finish().is_err());

    let mut image = Doc::new("image", "Image").unwrap();
    let image_resource = image
        .resource(
            "result",
            Artifact::new(b"image", "image/png", "png", "test", "v1").unwrap(),
        )
        .unwrap();
    assert!(image.markdown_parts(image_resource.code("text")).is_err());
    assert!(image.finish().is_err());

    let mut bytes = Doc::new("bytes", "Bytes").unwrap();
    let text = bytes
        .resource(
            "result",
            Artifact::new([0xff], "text/plain", "txt", "test", "v1").unwrap(),
        )
        .unwrap();
    assert!(bytes.markdown_parts(text.code("text")).is_err());
    assert!(bytes.finish().is_err());

    let mut language = Doc::new("language", "Language").unwrap();
    let text = language.text("result", "output").unwrap();
    assert!(language.markdown_parts(text.code("text\n```\n")).is_err());
    assert!(language.finish().is_err());
}
