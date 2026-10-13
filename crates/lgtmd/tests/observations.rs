use lgtmd::{Audience, Doc, Document, store};
use serde::{Serialize, Serializer, ser::Error};
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn render(doc: Doc, audience: Audience) -> BTreeMap<String, Vec<u8>> {
    Document::render_many(&[doc.finish().unwrap()], audience).unwrap()
}

fn manifest(files: &BTreeMap<String, Vec<u8>>) -> Value {
    serde_json::from_slice(&files["manifest.json"]).unwrap()
}

#[test]
fn explanations_publish_without_manufacturing_checks_or_observations() {
    let mut doc = Doc::new("saved-view", "Save a useful view").unwrap();
    let section = doc.heading(2, "Name your view").unwrap();
    doc.paragraph("Give the view a name you will recognize later.")
        .unwrap();
    doc.note_on(
        &section,
        "This page makes no behavioral verification claim.",
    )
    .unwrap();
    let files = render(doc, Audience::Reader);
    let receipt = manifest(&files);
    assert_eq!(receipt["documents"][0]["checks"], json!([]));
    assert!(receipt["documents"][0].get("observations").is_none());
    let directory = tempfile::tempdir().unwrap();
    store::build(
        &directory.path().canonicalize().unwrap().join("reader"),
        &files,
    )
    .unwrap();
    assert!(String::from_utf8_lossy(&files["saved-view.md"]).contains("recognize later"));
    assert!(!String::from_utf8_lossy(&files["saved-view.md"]).contains("verification claim"));
}

#[test]
fn observations_freeze_at_registration_and_are_distinct_from_executed_checks() {
    let mut doc = Doc::new("values", "Values").unwrap();
    let mut source = json!({"nested": [{"z": "last", "a": "first"}], "count": 2});
    let observed = doc.observe("response", &source).unwrap();
    assert_eq!(observed.id(), "response");
    assert_eq!(observed.observed(), &source);
    doc.paragraph(("The response was ", &observed, "."))
        .unwrap();
    let count = doc.expect_eq("expected-count", 2, 2).unwrap();
    doc.paragraph(("The checked count is ", &count, "."))
        .unwrap();
    source["count"] = 99.into();
    source["nested"][0]["a"] = "changed".into();
    let files = render(doc, Audience::Reader);
    let receipt = manifest(&files);
    assert_eq!(
        receipt["documents"][0]["observations"],
        json!([{"id": "response", "value": {
            "nested": [{"z": "last", "a": "first"}], "count": 2
        }}])
    );
    assert_eq!(
        receipt["documents"][0]["checks"].as_array().unwrap().len(),
        1
    );
    assert_eq!(receipt["documents"][0]["checks"][0]["id"], "expected-count");
    assert_eq!(
        receipt["documents"][0]["blocks"][0]["references"][0]["kind"],
        "observation"
    );
    let page = String::from_utf8_lossy(&files["values.md"]);
    assert!(page.contains("first"));
    assert!(!page.contains("changed"));
    assert!(!page.contains("99"));
    let directory = tempfile::tempdir().unwrap();
    store::build(
        &directory.path().canonicalize().unwrap().join("reader"),
        &files,
    )
    .unwrap();
}

#[test]
fn observing_does_not_require_an_assertion_and_json_null_remains_present() {
    let mut doc = Doc::new("optional", "An optional response").unwrap();
    let response = doc.observe("response", Option::<String>::None).unwrap();
    doc.paragraph(("The response was ", response, ".")).unwrap();
    let files = render(doc, Audience::Reader);
    let receipt = manifest(&files);
    assert_eq!(receipt["documents"][0]["checks"], json!([]));
    assert_eq!(
        receipt["documents"][0]["observations"][0].get("value"),
        Some(&Value::Null)
    );
    assert!(String::from_utf8_lossy(&files["optional.md"]).contains("response was null"));
    let directory = tempfile::tempdir().unwrap();
    store::build(
        &directory.path().canonicalize().unwrap().join("reader"),
        &files,
    )
    .unwrap();
}

#[test]
fn adding_private_observations_and_notes_preserves_every_reader_byte() {
    fn document(private: bool) -> Document {
        let mut doc = Doc::new("records", "Records").unwrap();
        let heading = doc.heading(2, "Review records").unwrap();
        doc.paragraph("Use the name to identify a record.").unwrap();
        if private {
            let token = doc.observe("private-token", "PRIVATE SNAPSHOT").unwrap();
            let details = doc.text("private-resource", "PRIVATE BYTES").unwrap();
            doc.note_on(&heading, ("Internal: ", &token, " ", &details))
                .unwrap();
            doc.note_on(&token, "Keep this observation for contributor review.")
                .unwrap();
        }
        doc.finish().unwrap()
    }
    let ordinary = Document::render_many(&[document(false)], Audience::Reader).unwrap();
    let annotated = Document::render_many(&[document(true)], Audience::Reader).unwrap();
    assert_eq!(ordinary, annotated);
    let contributor = Document::render_many(&[document(true)], Audience::Contributor).unwrap();
    let receipt = manifest(&contributor);
    assert_eq!(
        receipt["documents"][0]["observations"],
        json!([{"id": "private-token", "value": "PRIVATE SNAPSHOT"}])
    );
    assert!(
        String::from_utf8_lossy(&contributor["records.md"])
            .contains("Contributor note on `private-token`")
    );
    assert_eq!(
        contributor["assets/records/private-resource.txt"],
        b"PRIVATE BYTES"
    );
}

#[test]
fn observation_registration_order_and_nested_json_keys_are_canonical() {
    struct OutOfOrder;
    impl Serialize for OutOfOrder {
        fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
            use serde::ser::SerializeMap;
            let mut map = serializer.serialize_map(Some(2))?;
            map.serialize_entry("z", &json!([{"z": 2, "a": 1}]))?;
            map.serialize_entry("a", &"first")?;
            map.end()
        }
    }
    fn document(reverse: bool) -> Document {
        let mut doc = Doc::new("canonical", "Canonical observations").unwrap();
        let mut ids = ["alpha", "zeta"];
        if reverse {
            ids.reverse();
        }
        let mut observations = BTreeMap::new();
        for id in ids {
            let observed = doc.observe(id, OutOfOrder).unwrap();
            assert_eq!(
                observed.observed().to_string(),
                r#"{"a":"first","z":[{"a":1,"z":2}]}"#
            );
            observations.insert(id, observed);
        }
        for observed in observations.values() {
            doc.paragraph(observed).unwrap();
        }
        doc.finish().unwrap()
    }
    assert_eq!(
        Document::render_many(&[document(false)], Audience::Reader).unwrap(),
        Document::render_many(&[document(true)], Audience::Reader).unwrap()
    );
}

#[test]
fn swallowed_observation_failures_and_failed_checks_still_prevent_completion() {
    struct CannotSerialize;
    impl Serialize for CannotSerialize {
        fn serialize<S: Serializer>(&self, _: S) -> Result<S::Ok, S::Error> {
            Err(S::Error::custom("snapshot failed"))
        }
    }
    let mut failed = Doc::new("failed", "Failed").unwrap();
    let _ = failed.observe("snapshot", CannotSerialize);
    failed
        .paragraph("An explanation cannot hide a failed operation.")
        .unwrap();
    assert!(failed.finish().unwrap_err().contains("snapshot failed"));

    let mut duplicate = Doc::new("duplicate", "Duplicate").unwrap();
    duplicate.observe("shared", 1).unwrap();
    let _ = duplicate.require("shared", true);
    assert!(duplicate.finish().unwrap_err().contains("Duplicate"));

    let mut first = Doc::new("first", "First").unwrap();
    let observed = first.observe("value", 1).unwrap();
    let mut second = Doc::new("second", "Second").unwrap();
    second.observe("value", 1).unwrap();
    let _ = second.paragraph(&observed);
    assert!(
        second
            .finish()
            .unwrap_err()
            .contains("Foreign document/run")
    );

    let mut check = Doc::new("check", "Failed check").unwrap();
    check.observe("value", 1).unwrap();
    let _ = check.expect_eq("incorrect", 1, 2);
    assert!(
        check
            .finish()
            .unwrap_err()
            .contains("Check incorrect failed")
    );
}

#[test]
fn malformed_observation_receipts_fail_before_writing_output() {
    let mut doc = Doc::new("values", "Values").unwrap();
    let observed = doc.observe("response", 2).unwrap();
    doc.paragraph(&observed).unwrap();
    let original = render(doc, Audience::Reader);
    let directory = tempfile::tempdir().unwrap();
    let parent = directory.path().canonicalize().unwrap();
    store::build(&parent.join("valid"), &original).unwrap();
    for (index, edit) in [
        (|receipt: &mut Value| {
            receipt["documents"][0]["observations"] = Value::Null;
        }) as fn(&mut Value),
        |receipt| {
            receipt["documents"][0]["observations"][0]
                .as_object_mut()
                .unwrap()
                .remove("value");
        },
        |receipt| {
            let duplicate = receipt["documents"][0]["observations"][0].clone();
            receipt["documents"][0]["observations"]
                .as_array_mut()
                .unwrap()
                .push(duplicate);
        },
        |receipt| {
            receipt["documents"][0]["observations"][0]["id"] = "block-0001".into();
        },
        |receipt| {
            receipt["documents"][0]["blocks"][0]["references"][0]["kind"] = "value".into();
        },
    ]
    .into_iter()
    .enumerate()
    {
        let mut candidate = original.clone();
        let mut receipt = manifest(&candidate);
        edit(&mut receipt);
        candidate.insert(
            "manifest.json".into(),
            serde_json::to_vec(&receipt).unwrap(),
        );
        let output = parent.join(index.to_string());
        assert!(store::build(&output, &candidate).is_err());
        assert!(!output.exists());
    }
}
