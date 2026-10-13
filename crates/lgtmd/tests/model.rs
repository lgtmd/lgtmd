use lgtmd::{Artifact, Audience, BindingValue, Doc, Document, IntoProse};
use serde_json::{Value, json};

fn doc() -> Doc {
    let mut doc = Doc::new("example", "Example").unwrap();
    doc.require("initial-condition", true).unwrap();
    doc
}

fn render(doc: Doc, audience: Audience) -> std::collections::BTreeMap<String, Vec<u8>> {
    Document::render_many(&[doc.finish().unwrap()], audience).unwrap()
}

#[test]
fn prose_macro_combines_many_mixed_parts_and_evaluates_each_once_in_order() {
    let mut doc = doc();
    let count = doc.expect_eq("count", 3, 3).unwrap();
    let control = doc
        .binding("save", BindingValue::Code("Save".into()))
        .unwrap();
    let text = doc.text("result", "saved").unwrap();
    let mut evaluated = Vec::new();
    doc.markdown_parts(lgtmd::prose![
        {
            evaluated.push(1);
            "First: "
        },
        &count,
        ". Choose ",
        &control,
        "; read ",
        text.link("the result"),
        ". Then ",
        &count,
        " again. ",
        {
            evaluated.push(2);
            String::from("Last: ")
        },
        &control,
        ".\n",
    ])
    .unwrap();
    assert_eq!(evaluated, [1, 2]);
    let document = doc.finish().unwrap();
    assert_eq!(
        document.render_fragment(Audience::Reader).unwrap(),
        "First: 3. Choose <code>Save</code>; read [the result](assets/example/result.txt). Then 3 again. Last: <code>Save</code>.\n"
    );
    let files = Document::render_many(&[document], Audience::Reader).unwrap();
    let manifest: Value = serde_json::from_slice(&files["manifest.json"]).unwrap();
    let references: Vec<_> = manifest["documents"][0]["blocks"][0]["references"]
        .as_array()
        .unwrap()
        .iter()
        .map(|reference| reference["id"].as_str().unwrap())
        .collect();
    assert_eq!(references, ["count", "save", "result", "count", "save"]);
    let empty = lgtmd::prose![];
    assert!(empty.is_empty());
}

#[test]
fn swallowed_failure_duplicate_and_foreign_handles_taint_finish() {
    let mut failed = doc();
    let _ = failed.expect_eq("result", 2, 3);
    failed.paragraph("This must never publish.").unwrap();
    assert!(failed.finish().unwrap_err().contains("tainted"));

    let mut duplicate = doc();
    let _ = duplicate.require("initial-condition", true);
    assert!(duplicate.finish().unwrap_err().contains("Duplicate"));

    let mut first = doc();
    let checked = first.expect_eq("observed", 42, 42).unwrap();
    let mut second = doc();
    second.expect_eq("observed", 42, 42).unwrap();
    let _ = second.paragraph(("Foreign value ", &checked));
    assert!(
        second
            .finish()
            .unwrap_err()
            .contains("Foreign document/run")
    );
}

#[test]
fn value_and_file_bytes_are_frozen_at_observation() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("result.txt");
    std::fs::write(&path, "before").unwrap();
    let mut doc = doc();
    let checked = doc.expect_eq("count", 42_u32, 42_u32).unwrap();
    doc.paragraph(("Count: ", &checked)).unwrap();
    let resource = doc
        .resource(
            "result",
            Artifact::from_file(&path, "text/plain", "txt", "test", "v1").unwrap(),
        )
        .unwrap();
    std::fs::write(&path, "after").unwrap();
    doc.code(&resource, "text").unwrap();
    let files = render(doc, Audience::Reader);
    assert_eq!(files["assets/example/result.txt"], b"before");
    let manifest: Value = serde_json::from_slice(&files["manifest.json"]).unwrap();
    assert!(
        manifest["documents"][0]["checks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|check| check["id"] == "count"
                && check["actual"] == 42
                && check["expected"] == 42)
    );
    assert!(String::from_utf8_lossy(&files["example.md"]).contains("Count: 42"));
}

#[test]
fn notes_and_their_values_resources_profiles_and_edges_are_absent_from_reader() {
    let mut doc = doc();
    let public = doc.text_code("public", "public bytes", "text").unwrap();
    let private = doc
        .resource(
            "private-secret",
            Artifact::new(
                b"private-body".to_vec(),
                "text/x-secret",
                "secret",
                "private-producer",
                "private-profile",
            )
            .unwrap(),
        )
        .unwrap();
    let value = doc
        .expect_eq(
            "private-value",
            "private-observation",
            "private-observation",
        )
        .unwrap();
    doc.note_on(&public, ("private-note ", &private, " observed ", &value))
        .unwrap();
    doc.note_on(&value, "Explain the checked observation.")
        .unwrap();
    let document = doc.finish().unwrap();
    let reader = Document::render_many(std::slice::from_ref(&document), Audience::Reader).unwrap();
    let contributor = Document::render_many(&[document], Audience::Contributor).unwrap();
    for (path, bytes) in &reader {
        let text = String::from_utf8_lossy(bytes);
        assert!(!path.contains("private"));
        for secret in [
            "private-secret",
            "private-note",
            "private-body",
            "private-observation",
            "private-producer",
            "private-profile",
        ] {
            assert!(
                !text.contains(secret),
                "Private evidence leaked into {path}: {text}"
            );
        }
    }
    assert!(contributor.contains_key("assets/example/private-secret.secret"));
    assert!(
        String::from_utf8_lossy(&contributor["example.md"])
            .contains("Contributor note on `private-value`")
    );
    assert!(String::from_utf8_lossy(&contributor["manifest.json"]).contains("private-observation"));
}

#[test]
fn inserting_notes_never_changes_reader_block_ids_or_bytes() {
    fn build(notes: bool) -> Doc {
        let mut doc = doc();
        if notes {
            doc.note("Before").unwrap();
        }
        let block = doc.heading(2, "Section").unwrap();
        if notes {
            doc.note_on(&block, "After").unwrap();
        }
        doc.paragraph(("See ", &block)).unwrap();
        doc
    }
    assert_eq!(
        render(build(false), Audience::Reader),
        render(build(true), Audience::Reader)
    );
}

#[test]
fn dangling_resources_and_public_references_to_private_blocks_fail() {
    let mut unused = doc();
    unused.text("unused", "not placed").unwrap();
    assert!(
        Document::render_many(&[unused.finish().unwrap()], Audience::Reader)
            .unwrap_err()
            .contains("Unreferenced resources")
    );
    let mut leaked = doc();
    let note = leaked.note("Private").unwrap();
    leaked.paragraph(("See ", &note)).unwrap();
    assert!(leaked.finish().unwrap_err().contains("excluded block"));
}

#[test]
fn wrong_text_kind_fails_even_when_error_is_swallowed() {
    let mut doc = doc();
    let image = doc
        .resource(
            "image",
            Artifact::new(vec![0, 1, 2], "image/png", "png", "test", "v1").unwrap(),
        )
        .unwrap();
    let _ = doc.code(&image, "text");
    doc.embed(&image, "image").unwrap();
    assert!(doc.finish().unwrap_err().contains("not declared as text"));
}

#[test]
fn resource_reuse_registers_bytes_once_and_code_fences_cannot_be_closed_by_content() {
    let mut doc = doc();
    let resource = doc
        .text_code(
            "transcript",
            "```\n[not a link](missing.md)\n`````\n",
            "text",
        )
        .unwrap();
    doc.paragraph(("Download ", &resource)).unwrap();
    doc.note_on(&resource, "One run supplies both uses.")
        .unwrap();
    let files = render(doc, Audience::Contributor);
    assert_eq!(
        files
            .keys()
            .filter(|path| path.starts_with("assets/"))
            .count(),
        1
    );
    assert!(String::from_utf8_lossy(&files["example.md"]).contains("``````text\n"));
}

#[test]
fn markdown_references_use_the_real_parser_and_ignore_code_examples() {
    let mut doc = doc();
    let resource = doc.json("data", &json!({"b": 2, "a": 1})).unwrap();
    doc.markdown("[saved data][result]\n\n[result]: assets/example/data.json \"JSON\"\n\n`[code](missing.md)`\n\n```text\n[also code](missing.md)\n```").unwrap();
    doc.note_on(&resource, "Source resource").unwrap();
    let files = render(doc, Audience::Reader);
    assert!(files.contains_key("assets/example/data.json"));
    let mut unresolved = doc_for_reference();
    let _ = unresolved.markdown("[missing][definition]");
    assert!(
        unresolved
            .finish()
            .unwrap_err()
            .contains("Unresolved Markdown")
    );
}

fn doc_for_reference() -> Doc {
    doc()
}

#[test]
fn raw_cross_document_links_wait_for_complete_bundle_but_unknown_and_hidden_links_fail() {
    let mut first = Doc::new("first", "First").unwrap();
    first.require("checked", true).unwrap();
    first.markdown("[second](second.md)").unwrap();
    let first = first.finish().unwrap();
    assert!(Document::render_many(std::slice::from_ref(&first), Audience::Reader).is_err());
    let mut second = Doc::new("second", "Second").unwrap();
    second.require("checked", true).unwrap();
    second.paragraph("Second document").unwrap();
    assert!(Document::render_many(&[first, second.finish().unwrap()], Audience::Reader).is_ok());
}

#[test]
fn raw_html_unsafe_schemes_and_encoded_traversal_fail() {
    for markdown in [
        "<img src=\"secret\">",
        "[bad](javascript:alert)",
        "[bad](%2e%2e/secret.txt)",
    ] {
        let mut doc = doc();
        let result = doc.markdown(markdown);
        assert!(
            result.is_err()
                || doc
                    .finish()
                    .and_then(|document| Document::render_many(&[document], Audience::Reader))
                    .is_err(),
            "Accepted {markdown}"
        );
    }
}

#[test]
fn repeated_runs_are_identical_and_registration_order_is_canonical() {
    fn build(reverse: bool) -> Document {
        let mut doc = doc();
        let mut names = ["first", "second"];
        if reverse {
            names.reverse();
        }
        let mut resources = std::collections::BTreeMap::new();
        for name in names {
            resources.insert(name, doc.text(name, name).unwrap());
        }
        for resource in resources.values() {
            doc.code(resource, "text").unwrap();
        }
        doc.finish().unwrap()
    }
    let first = Document::render_many(&[build(false)], Audience::Reader).unwrap();
    let second = Document::render_many(&[build(true)], Audience::Reader).unwrap();
    assert_eq!(first, second);
}

#[test]
fn resource_code_preserves_custom_provenance_and_failure_taints_the_document() {
    let mut complete = doc();
    let resource = complete
        .resource_code(
            "command",
            Artifact::new(
                b"actual stdout",
                "text/plain",
                "txt",
                "application-cli",
                "stdout-v1",
            )
            .unwrap(),
            "text",
        )
        .unwrap();
    complete
        .note_on(&resource, "Produced by the real command.")
        .unwrap();
    let files = render(complete, Audience::Reader);
    assert_eq!(files["assets/example/command.txt"], b"actual stdout");
    let manifest: Value = serde_json::from_slice(&files["manifest.json"]).unwrap();
    let record = manifest["artifacts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|record| record["id"] == "command")
        .unwrap();
    assert_eq!(record["producer"], "application-cli");
    assert_eq!(record["profile"], "stdout-v1");

    let mut failed = doc();
    let _ = failed.resource_code(
        "binary",
        Artifact::new(
            vec![0xff],
            "text/plain",
            "txt",
            "application-cli",
            "stdout-v1",
        )
        .unwrap(),
        "text",
    );
    assert!(failed.finish().unwrap_err().contains("not UTF-8"));
}

#[test]
fn legacy_fragment_preserves_markdown_whitespace_and_typed_control_media_markup() {
    let mut doc = doc();
    let control = doc
        .binding("control", BindingValue::Code("File & <View> \"'|".into()))
        .unwrap();
    let shortcut = doc
        .binding(
            "shortcut",
            BindingValue::Keys(vec!["Command".into(), "O".into()]),
        )
        .unwrap();
    let image = doc
        .resource_at(
            "preview",
            Artifact::new(
                b"frozen image",
                "image/webp",
                "webp",
                "host-renderer",
                "metal-v1",
            )
            .unwrap(),
            "assets/legacy-preview.webp",
        )
        .unwrap();
    doc.markdown_parts(vec![
        "# Existing guide\n\nChoose ".into_prose(),
        (&control).into_prose(),
        " or press ".into_prose(),
        (&shortcut).into_prose(),
        ".\n\n".into_prose(),
        image.image("Legacy preview"),
        "\n\n[Related](other.md#existing-heading)\n".into_prose(),
    ])
    .unwrap();
    doc.note("Contributor explanation.").unwrap();
    let document = doc.finish().unwrap();
    assert_eq!(
        document.render_fragment(Audience::Reader).unwrap(),
        "# Existing guide\n\nChoose <code>File &amp; &lt;View&gt; &quot;&#39;&#124;</code> or press <kbd>Command</kbd> + <kbd>O</kbd>.\n\n![Legacy preview](assets/legacy-preview.webp)\n\n[Related](other.md#existing-heading)\n"
    );
    assert!(
        Document::render_many(&[document], Audience::Reader).is_err(),
        "The ordinary bundle renderer still owns strict whole-bundle link checking"
    );
}

#[test]
fn typed_bindings_and_image_views_preserve_audience_isolation() {
    fn build(notes: bool) -> Document {
        let mut doc = doc();
        let public = doc
            .binding("public-label", BindingValue::Text("Visible".into()))
            .unwrap();
        doc.markdown_parts(("A **", &public, "** label.\n"))
            .unwrap();
        if notes {
            let private = doc
                .binding("secret-label", BindingValue::Keys(vec!["SECRET".into()]))
                .unwrap();
            let image = doc
                .resource_at(
                    "secret-image",
                    Artifact::new(
                        b"SECRET BYTES",
                        "image/png",
                        "png",
                        "secret-producer",
                        "secret-profile",
                    )
                    .unwrap(),
                    "assets/secret.png",
                )
                .unwrap();
            doc.note((&private, ": ", image.image("secret image")))
                .unwrap();
        }
        doc.finish().unwrap()
    }
    let ordinary = Document::render_many(&[build(false)], Audience::Reader).unwrap();
    let annotated = Document::render_many(&[build(true)], Audience::Reader).unwrap();
    assert_eq!(ordinary, annotated);
    let contributor = Document::render_many(&[build(true)], Audience::Contributor).unwrap();
    assert!(contributor.contains_key("assets/secret.png"));
    assert!(String::from_utf8_lossy(&contributor["manifest.json"]).contains("secret-label"));
}

#[test]
fn fragment_resource_files_exclude_note_only_bytes_from_reader() {
    let mut doc = doc();
    let diagnostic = doc.text("diagnostic", "private frozen bytes").unwrap();
    doc.markdown_parts("Public explanation.\n").unwrap();
    doc.note(("Contributor diagnosis: ", &diagnostic)).unwrap();
    let document = doc.finish().unwrap();
    assert_eq!(
        document.render_fragment(Audience::Reader).unwrap(),
        "Public explanation.\n"
    );
    assert!(
        document
            .resource_files(Audience::Reader)
            .unwrap()
            .is_empty()
    );
    let files = document.resource_files(Audience::Contributor).unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(
        files["assets/example/diagnostic.txt"],
        b"private frozen bytes"
    );
    assert_eq!(
        files,
        document.resource_files(Audience::Contributor).unwrap()
    );
}

#[test]
fn binding_and_media_composition_rejects_foreign_handles_wrong_mime_and_literal_html() {
    let mut first = doc();
    let foreign = first
        .binding("label", BindingValue::Text("Label".into()))
        .unwrap();
    let mut second = doc();
    assert!(second.markdown_parts(("Foreign ", &foreign)).is_err());
    assert!(second.finish().is_err());

    let mut wrong_kind = doc();
    let text = wrong_kind.text("plain", "bytes").unwrap();
    assert!(
        wrong_kind
            .markdown_parts(text.image("Not an image"))
            .is_err()
    );
    assert!(wrong_kind.finish().is_err());

    let mut html = doc();
    let tag = html
        .binding("tag", BindingValue::Text("script".into()))
        .unwrap();
    assert!(html.markdown_parts(("<", &tag, ">bad</script>")).is_err());
    assert!(html.finish().is_err());
}

#[test]
fn custom_resource_paths_cannot_overwrite_another_document_or_resource() {
    fn document(id: &str, path: &str) -> Document {
        let mut doc = Doc::new(id, id).unwrap();
        doc.require("executed", true).unwrap();
        let resource = doc
            .resource_at(
                "shared",
                Artifact::new(b"bytes", "text/plain", "txt", "host", "v1").unwrap(),
                path,
            )
            .unwrap();
        doc.paragraph(resource.link("Download")).unwrap();
        doc.finish().unwrap()
    }
    let error = Document::render_many(
        &[
            document("first", "assets/shared.txt"),
            document("second", "assets/shared.txt"),
        ],
        Audience::Reader,
    )
    .unwrap_err();
    assert!(error.contains("Duplicate artifact path"));
    let error = Document::render_many(
        &[
            document("first", "second.md"),
            document("second", "assets/second.txt"),
        ],
        Audience::Reader,
    )
    .unwrap_err();
    assert!(error.contains("Duplicate artifact path"));
    let mut unsafe_path = doc();
    assert!(
        unsafe_path
            .resource_at(
                "bad",
                Artifact::new(b"bytes", "text/plain", "txt", "host", "v1").unwrap(),
                "../bad.txt"
            )
            .is_err()
    );
    assert!(unsafe_path.finish().is_err());

    let private_document = |id: &str| {
        let mut doc = Doc::new(id, id).unwrap();
        doc.require("checked", true).unwrap();
        let resource = doc
            .resource_at(
                "private",
                Artifact::new(b"private", "text/plain", "txt", "host", "v1").unwrap(),
                "assets/private.txt",
            )
            .unwrap();
        doc.note(("Internal observation: ", &resource)).unwrap();
        doc.finish().unwrap()
    };
    assert!(
        Document::render_many(
            &[private_document("first"), private_document("second")],
            Audience::Reader
        )
        .is_err(),
        "Reader selection cannot conceal duplicate contributor ownership"
    );
}

#[test]
fn fragment_rejects_block_links_without_generated_anchors() {
    let mut doc = doc();
    let heading = doc.heading(2, "Section").unwrap();
    doc.paragraph(("See ", &heading)).unwrap();
    let document = doc.finish().unwrap();
    assert!(
        document
            .render_fragment(Audience::Reader)
            .unwrap_err()
            .contains("omits block anchors")
    );
    assert!(Document::render_many(&[document], Audience::Reader).is_ok());
}
