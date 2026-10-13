//! An executable user explanation built against the existing serde_json crate.
//! This is our integration example, not documentation adopted by its maintainers.

use lgtmd::runner::run_cli;
use lgtmd::{Artifact, Doc, Document, Result};
use serde_json::error::Category;
use std::path::Path;

fn main() {
    let baseline = Path::new(env!("CARGO_MANIFEST_DIR")).join("baseline/serde-json");
    if let Err(error) = run_cli(std::env::args().skip(1), &baseline, guide) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn guide() -> Result<Vec<Document>> {
    let mut doc = Doc::new("parse-a-typed-list", "Parse a typed JSON list")?;
    doc.markdown(
        r#"Use `serde_json::from_str::<Vec<u32>>()` to read a JSON array of
unsigned integers into a Rust vector. The Rust type supplies a concrete
expectation: a string inside the array is a type mismatch, even if the JSON
syntax is valid.

This walkthrough parses a valid list, inspects an error, and retries with
corrected input. It calls the public `serde_json` API directly.

The library documents [deserializing from a string](https://docs.rs/serde_json/1.0.151/serde_json/fn.from_str.html)
and [classifying errors](https://docs.rs/serde_json/1.0.151/serde_json/struct.Error.html)."#,
    )?;

    doc.heading(2, "Parse a valid list")?;
    let source = "[2, 3, 5]";
    doc.paragraph("Start with this JSON array:")?;
    let input = doc.resource_code("valid-input", input_json(source)?, "json")?;
    let values: Vec<u32> = serde_json::from_str(source).map_err(|error| error.to_string())?;
    let count = doc.expect_eq("parsed-length", values.len(), 3)?;
    let total = doc.expect_eq("parsed-sum", values.iter().sum::<u32>(), 10)?;
    doc.paragraph((
        "Parsing succeeds with ",
        &count,
        " integers. Their sum is ",
        &total,
        ". The values are ordinary Rust integers after deserialization.",
    ))?;

    doc.heading(2, "Inspect a type mismatch")?;
    doc.markdown(
        r#"Replace the second number with a string. This input is still valid JSON,
but it does not match `Vec<u32>`:"#,
    )?;
    let invalid = r#"[2, "three", 5]"#;
    doc.resource_code("mismatched-input", input_json(invalid)?, "json")?;
    doc.require(
        "mismatched-input-has-valid-json-syntax",
        serde_json::from_str::<serde_json::Value>(invalid).is_ok(),
    )?;
    let error = match serde_json::from_str::<Vec<u32>>(invalid) {
        Ok(_) => return Err("Expected the string element to fail typed deserialization".into()),
        Err(error) => error,
    };
    doc.require(
        "type-mismatch-is-data-error",
        error.classify() == Category::Data,
    )?;
    let line = doc.expect_eq("error-line", error.line(), 1)?;
    let column = doc.expect_eq("error-column", error.column(), 11)?;
    doc.paragraph("The failed parse returns an error. Its display text identifies the incompatible value and the expected Rust type:")?;
    let diagnostic = doc.resource_code(
        "type-error",
        captured(&error.to_string(), "text/plain", "txt")?,
        "text",
    )?;
    doc.paragraph((
        "The error is classified as Data and is reported at line ",
        &line,
        ", column ",
        &column,
        ". Use the category to distinguish a type mismatch from invalid JSON syntax.",
    ))?;
    let details = doc.json(
        "error-observation",
        &serde_json::json!({
            "category": format!("{:?}", error.classify()),
            "line": error.line(),
            "column": error.column(),
            "message": error.to_string(),
        }),
    )?;
    doc.note_on(
        &diagnostic,
        (
            "The error text is captured from serde_json 1.0.151. A dependency update must review both the asserted category and the captured message. The ",
            &details,
            " records the observed diagnostic fields for contributors.",
        ),
    )?;

    doc.heading(2, "Correct the input and serialize the result")?;
    doc.paragraph("Replace the string with the number 3 and parse the corrected source again. The corrected input is the same valid array shown above:")?;
    doc.code(&input, "json")?;
    let corrected = invalid.replace("\"three\"", "3");
    let recovered: Vec<u32> =
        serde_json::from_str(&corrected).map_err(|error| error.to_string())?;
    let recovered_values = doc.expect_eq("corrected-values", &recovered, &values)?;
    doc.paragraph((
        "The corrected parse returns ",
        &recovered_values,
        ". Pass that vector to serde_json::to_string_pretty to obtain formatted JSON:",
    ))?;
    let pretty = serde_json::to_string_pretty(&recovered).map_err(|error| error.to_string())?;
    let roundtrip: Vec<u32> = serde_json::from_str(&pretty).map_err(|error| error.to_string())?;
    doc.require("pretty-json-preserves-values", roundtrip == recovered)?;
    let formatted = doc.resource_code(
        "formatted-list",
        captured(&pretty, "application/json", "json")?,
        "json",
    )?;
    doc.paragraph((
        "The ",
        &formatted,
        " can be parsed back into the same integers. Formatting changes the presentation while preserving these values.",
    ))?;
    doc.note("This integration is maintained here to test the documentation framework against an independently existing Rust library. It is not upstream serde_json documentation or evidence of adoption by its maintainers.")?;
    Ok(vec![doc.finish()?])
}

fn captured(text: &str, mime: &str, extension: &str) -> Result<Artifact> {
    Artifact::new(
        text.as_bytes(),
        mime,
        extension,
        "serde_json",
        "serde-json-1.0.151",
    )
}

fn input_json(text: &str) -> Result<Artifact> {
    Artifact::new(
        text.as_bytes(),
        "application/json",
        "json",
        "serde-json-guide",
        "json-fixture-v1",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use lgtmd::{Audience, store};

    #[test]
    fn both_serde_json_views_match_the_retained_contract() {
        let documents = guide().unwrap();
        let baseline = Path::new(env!("CARGO_MANIFEST_DIR")).join("baseline/serde-json");
        for (audience, directory) in [
            (Audience::Reader, "reader"),
            (Audience::Contributor, "contributor"),
        ] {
            let files = Document::render_many(&documents, audience).unwrap();
            store::check(&baseline.join(directory), &files).unwrap();
        }
    }

    #[test]
    fn library_guide_repeats_exactly_without_exposing_contributor_diagnostics() {
        let first = Document::render_many(&guide().unwrap(), Audience::Reader).unwrap();
        let second = Document::render_many(&guide().unwrap(), Audience::Reader).unwrap();
        assert_eq!(first, second);
        assert!(!first.keys().any(|path| path.contains("error-observation")));
        let reader_text = first
            .values()
            .map(|bytes| String::from_utf8_lossy(bytes))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(!reader_text.contains("observed diagnostic fields for contributors"));
    }
}
