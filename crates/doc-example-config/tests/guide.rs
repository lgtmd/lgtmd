#[path = "../examples/support/mod.rs"]
#[allow(dead_code)]
mod support;

use lgtmd::{Audience, Document, store};
use std::path::Path;

#[test]
fn guide_is_reproducible_and_keeps_contributor_evidence_out_of_reader_output() {
    let binary = Path::new(env!("CARGO_BIN_EXE_config-demo"));
    let first = support::guide(binary).unwrap();
    let second = support::guide(binary).unwrap();
    let reader = Document::render_many(&first, Audience::Reader).unwrap();
    let repeated = Document::render_many(&second, Audience::Reader).unwrap();
    assert_eq!(reader, repeated);

    let reader_text = reader
        .iter()
        .filter(|(path, _)| path.ends_with(".md"))
        .map(|(_, bytes)| std::str::from_utf8(bytes).unwrap())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(reader_text.contains("preserves every byte"));
    assert!(reader_text.contains("[exit 2]"));
    assert!(!reader_text.contains("contributor evidence"));
    assert!(!reader.keys().any(|path| path.contains("execution-checks")));

    let contributor = Document::render_many(&first, Audience::Contributor).unwrap();
    assert!(
        contributor
            .keys()
            .any(|path| path.contains("execution-checks"))
    );
    let contributor_text = contributor
        .iter()
        .filter(|(path, _)| path.ends_with(".md"))
        .map(|(_, bytes)| std::str::from_utf8(bytes).unwrap())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(contributor_text.contains("contributor evidence"));
}

#[test]
fn guide_fails_if_the_actual_cli_cannot_run() {
    let directory = tempfile::tempdir().unwrap();
    let error = support::guide(&directory.path().join("missing-config-demo")).unwrap_err();
    assert!(error.contains("could not run"), "Unexpected error: {error}");
}

#[test]
fn both_config_views_match_the_retained_contract() {
    let binary = Path::new(env!("CARGO_BIN_EXE_config-demo"));
    let documents = support::guide(binary).unwrap();
    let baseline = Path::new(env!("CARGO_MANIFEST_DIR")).join("baseline/config");
    for (audience, directory) in [
        (Audience::Reader, "reader"),
        (Audience::Contributor, "contributor"),
    ] {
        let files = Document::render_many(&documents, audience).unwrap();
        store::check(&baseline.join(directory), &files).unwrap();
    }
}
