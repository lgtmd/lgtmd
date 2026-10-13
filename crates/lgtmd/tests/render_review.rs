use lgtmd::{Artifact, Audience, BindingValue, Doc, Document, ExportLayout};
use pulldown_cmark::{Event, Parser, Tag, html};

fn doc() -> Doc {
    let mut doc = Doc::new("review", "Renderer review").unwrap();
    doc.require("exercised", true).unwrap();
    doc
}

fn render(doc: Doc) -> Result<std::collections::BTreeMap<String, Vec<u8>>, String> {
    Document::render_many(&[doc.finish()?], Audience::Reader)
}

#[test]
fn interpolated_delimiter_cannot_expose_authored_html() {
    let mut doc = doc();
    let delimiter = doc.expect_eq("delimiter", "`", "`").unwrap();
    doc.markdown_parts(("`", &delimiter, "<img src=x onerror=alert(1)>`"))
        .unwrap();
    assert!(render(doc).unwrap_err().contains("Raw HTML"));
}

#[test]
fn generated_html_has_no_permission_to_cover_adjacent_authored_tags() {
    let mut doc = doc();
    let delimiter = doc.expect_eq("delimiter", "`", "`").unwrap();
    let code = doc
        .binding("label", BindingValue::Code("safe".into()))
        .unwrap();
    doc.markdown_parts(("`", &delimiter, "<img src=x onerror=alert(1)>` ", &code))
        .unwrap();
    assert!(render(doc).unwrap_err().contains("Raw HTML"));
}

#[test]
fn typed_html_cannot_silently_become_code_text() {
    let mut doc = doc();
    let code = doc
        .binding("label", BindingValue::Code("safe".into()))
        .unwrap();
    doc.markdown_parts(("`", &code, "`\n")).unwrap();
    assert!(render(doc).unwrap_err().contains("swallowed"));
}

#[test]
fn code_and_key_bindings_remain_literal_in_markdown_and_contributor_notes() {
    let mut doc = doc();
    let label = doc
        .binding(
            "label",
            BindingValue::Code("*literal* `tick` [x] & <y>".into()),
        )
        .unwrap();
    let keys = doc
        .binding(
            "keys",
            BindingValue::Keys(vec!["Command".into(), "`".into()]),
        )
        .unwrap();
    doc.markdown_parts(("Choose ", &label, " with ", &keys, ".\n\n"))
        .unwrap();
    doc.note(("Again ", &label, " with ", &keys)).unwrap();
    let files = Document::render_many(&[doc.finish().unwrap()], Audience::Contributor).unwrap();
    let page = std::str::from_utf8(&files["review.md"]).unwrap();
    let mut html = String::new();
    html::push_html(&mut html, Parser::new(page));
    assert!(html.contains("<code>*literal* `tick` [x] &amp; &lt;y&gt;</code>"));
    assert!(html.contains("<kbd>Command</kbd> + <kbd>`</kbd>"));
    assert!(html.contains("Contributor note"));
    assert!(!html.contains("<em>literal</em>"));
}

#[test]
fn resource_destinations_encode_entities_and_unicode_without_renaming_files() {
    let mut doc = doc();
    let path = "assets/a&copy;-é;'!.txt";
    let resource = doc
        .resource_at(
            "result",
            Artifact::new(b"data", "text/plain", "txt", "test", "v1").unwrap(),
            path,
        )
        .unwrap();
    doc.paragraph(resource.link("Download")).unwrap();
    doc.embed(&resource, "Embedded download").unwrap();
    let files = render(doc).unwrap();
    assert_eq!(files[path], b"data");
    let page = std::str::from_utf8(&files["review.md"]).unwrap();
    let destinations: Vec<_> = Parser::new(page)
        .filter_map(|event| match event {
            Event::Start(Tag::Link { dest_url, .. }) => Some(dest_url.into_string()),
            _ => None,
        })
        .collect();
    assert_eq!(destinations, ["assets/a%26copy%3B-%C3%A9%3B%27%21.txt"; 2]);
}

#[test]
fn unclosed_fence_cannot_swallow_following_blocks_in_pages_or_fragments() {
    for fence in ["```rust\nlet value = 3;", "~~~text\nunclosed"] {
        let mut doc = doc();
        doc.markdown(fence).unwrap();
        doc.heading(2, "Must remain a heading").unwrap();
        let document = doc.finish().unwrap();
        let error =
            Document::render_many(std::slice::from_ref(&document), Audience::Reader).unwrap_err();
        assert!(error.contains("boundary"), "{error}");
        assert!(
            document
                .render_fragment(Audience::Reader)
                .unwrap_err()
                .contains("boundary")
        );
    }
}

#[test]
fn closed_code_containing_html_and_backticks_keeps_following_anchors_active() {
    let mut doc = doc();
    doc.markdown("````text\n<img src=x onerror=alert(1)>\n```\n````")
        .unwrap();
    let heading = doc.heading(2, "Still visible").unwrap();
    doc.paragraph(("Continue at ", &heading)).unwrap();
    let files = render(doc).unwrap();
    let mut html = String::new();
    html::push_html(
        &mut html,
        Parser::new(std::str::from_utf8(&files["review.md"]).unwrap()),
    );
    assert!(html.contains("<h2>Still visible</h2>"));
    assert!(html.contains("<a id=\"block-0002\"></a>"));
    assert!(html.contains("&lt;img src=x onerror=alert(1)&gt;"));
    assert!(!html.contains("<img src=x"));
}

#[test]
fn multi_page_failures_identify_the_document_export_path_and_authored_block() {
    let mut valid = Doc::new("first", "Valid first document").unwrap();
    valid.require("executed", true).unwrap();
    valid.paragraph("This page compiles normally.").unwrap();
    let mut broken = Doc::new("second", "Broken second document").unwrap();
    broken.require("executed", true).unwrap();
    let code = broken
        .binding("label", BindingValue::Code("literal".into()))
        .unwrap();
    let block = broken.markdown_parts(("`", &code, "`\n")).unwrap();
    let layout = ExportLayout::default()
        .page("second", "chapters/second.guide")
        .unwrap();
    let error = Document::render_many_with(
        &[valid.finish().unwrap(), broken.finish().unwrap()],
        Audience::Reader,
        &layout,
    )
    .unwrap_err();
    assert!(
        error.contains("Document second (chapters/second.guide)"),
        "{error}"
    );
    assert!(error.contains(&format!("block {}", block.id())), "{error}");
    assert!(error.contains("swallowed"), "{error}");
}
