use lgtmd::{
    Artifact, Audience, Doc, ExportLayout, Result, render,
    transport::{self, Input},
};
use serde_json::{Value, json};

fn documents() -> Result<Vec<lgtmd::Document>> {
    let mut doc = Doc::new("portable", "Portable document")?;
    let value = doc.observe("count", 3)?;
    let private = doc.observe("internal-only", "private observation")?;
    let checked = doc.expect_eq("null-value", Value::Null, Value::Null)?;
    doc.require("verified-count", true)?;
    doc.heading_with_id("overview", 2, "Overview")?;
    let passage = doc.markdown_parts(("Contains ", &value, " records and ", &checked, ".\n\n"))?;
    doc.note_on(&passage, ("Internal: ", &private))?;
    let json = doc.json("data", &json!({"z":2,"a":1}))?;
    doc.markdown_parts((
        "Data:\n\n",
        json.code("json"),
        "\n\n",
        json.link("Download"),
        "\n\n",
    ))?;
    let image = doc.resource(
        "image",
        Artifact::new(vec![1, 2, 3], "image/png", "png", "fixture", "exact-v1")?,
    )?;
    doc.paragraph(image.image("Fixed fixture bytes"))?;
    doc.code(&json, "json")?;
    doc.markdown("A **literal** Markdown block.")?;
    Ok(vec![doc.finish()?])
}

#[test]
fn frozen_transport_preserves_both_native_exports_and_null_checks() {
    let docs = documents().unwrap();
    let input = Input::from_documents(&docs).unwrap();
    let serialized = serde_json::to_vec(&input).unwrap();
    let input: Input = serde_json::from_slice(&serialized).unwrap();
    let exports = transport::compile(&input, &ExportLayout::default()).unwrap();
    assert_eq!(exports.reader, render(&docs, Audience::Reader).unwrap());
    assert_eq!(
        exports.contributor,
        render(&docs, Audience::Contributor).unwrap()
    );
    assert!(
        !String::from_utf8(exports.reader["manifest.json"].clone())
            .unwrap()
            .contains("internal-only")
    );
}

#[test]
fn transport_rejects_invalid_schema_references_outcomes_and_numbers() {
    let input =
        serde_json::to_value(Input::from_documents(&documents().unwrap()).unwrap()).unwrap();
    for mutate in [
        |v: &mut Value| v["schema_version"] = json!(2),
        |v: &mut Value| v["documents"][0]["checks"][0]["passed"] = json!(false),
        |v: &mut Value| {
            v["documents"][0]["observations"][0]["value"] = json!(9_007_199_254_740_992_u64)
        },
        |v: &mut Value| {
            v["documents"][0]["nodes"][1]["parts"][1]["target"]["id"] = json!("missing")
        },
        |v: &mut Value| {
            v["documents"][0]["nodes"][1]["parts"][1]["target"]["kind"] = json!("resource")
        },
        |v: &mut Value| v["documents"][0]["resources"][0]["path"] = json!("../escape.json"),
        |v: &mut Value| v["documents"][0]["nodes"][0]["id"] = json!("count"),
    ] {
        let mut candidate = input.clone();
        mutate(&mut candidate);
        let candidate: Input = serde_json::from_value(candidate).unwrap();
        assert!(transport::compile(&candidate, &ExportLayout::default()).is_err());
    }
    let mut unknown = input.clone();
    unknown["documents"][0]["host_state"] = json!(true);
    assert!(serde_json::from_value::<Input>(unknown).is_err());
    let mut unknown_binding = input.clone();
    unknown_binding["documents"][0]["bindings"] = json!([{
        "id":"label", "value":{"kind":"text", "value":"Visible", "unknown":true}
    }]);
    assert!(serde_json::from_value::<Input>(unknown_binding).is_err());
    let mut invalid_bytes = input;
    invalid_bytes["documents"][0]["resources"][0]["bytes"] = json!([256]);
    assert!(serde_json::from_value::<Input>(invalid_bytes).is_err());
}

#[test]
fn native_values_outside_portable_numeric_domain_fail_at_boundary() {
    let mut doc = Doc::new("large-number", "Large number").unwrap();
    doc.observe("large", u64::MAX).unwrap();
    assert!(Input::from_documents(&[doc.finish().unwrap()]).is_err());
}

#[test]
fn shared_fixture_exports_remain_exact() {
    let fixture: Value = serde_json::from_str(include_str!("fixtures/portable.json")).unwrap();
    let input: Input = serde_json::from_value(fixture["input"].clone()).unwrap();
    let exports = transport::compile(&input, &ExportLayout::default()).unwrap();
    assert_eq!(serde_json::to_value(exports).unwrap(), fixture["exports"]);
}
