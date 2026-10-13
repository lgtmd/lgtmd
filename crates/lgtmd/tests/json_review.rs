use lgtmd::{Audience, Doc, Document};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, HashMap};

fn ordered_object(reverse: bool) -> Value {
    let mut inner = Map::new();
    for key in if reverse { ["z", "a"] } else { ["a", "z"] } {
        inner.insert(key.into(), json!(key));
    }
    let mut outer = Map::new();
    for key in if reverse { ["z", "a"] } else { ["a", "z"] } {
        outer.insert(key.into(), json!([inner.clone(), 2, 1]));
    }
    Value::Object(outer)
}

fn export(value: Value) -> BTreeMap<String, Vec<u8>> {
    let mut doc = Doc::new("json", "JSON").unwrap();
    let checked = doc
        .expect_eq("value", value.clone(), ordered_object(false))
        .unwrap();
    assert_eq!(
        checked.observed().to_string(),
        r#"{"a":[{"a":"a","z":"z"},2,1],"z":[{"a":"a","z":"z"},2,1]}"#,
    );
    doc.paragraph(("Observed: ", &checked)).unwrap();
    doc.json_code("result", &value).unwrap();
    Document::render_many(&[doc.finish().unwrap()], Audience::Reader).unwrap()
}

#[test]
fn nested_values_are_canonical_in_resources_prose_and_manifest() {
    // Also run this test in the independent consumer with preserve_order enabled.
    // Arrays deliberately contain descending elements: their order must survive.
    let files = export(ordered_object(true));
    assert_eq!(files, export(ordered_object(false)));
    let bytes = &files["assets/json/result.json"];
    assert_eq!(
        std::str::from_utf8(bytes).unwrap(),
        "{\n  \"a\": [\n    {\n      \"a\": \"a\",\n      \"z\": \"z\"\n    },\n    2,\n    1\n  ],\n  \"z\": [\n    {\n      \"a\": \"a\",\n      \"z\": \"z\"\n    },\n    2,\n    1\n  ]\n}\n",
    );
    let manifest: Value = serde_json::from_slice(&files["manifest.json"]).unwrap();
    assert_eq!(
        manifest["documents"][0]["checks"][0]["actual"],
        ordered_object(false)
    );
    assert_eq!(
        manifest["documents"][0]["checks"][0]["expected"],
        ordered_object(false)
    );
}

#[test]
fn hash_maps_are_sorted_recursively_without_reordering_arrays() {
    let nested = HashMap::from([("z", 3), ("a", 1), ("m", 2)]);
    let input = HashMap::from([("z", vec![nested.clone()]), ("a", vec![nested])]);
    let mut doc = Doc::new("hash-map", "Hash map").unwrap();
    doc.require("executed", true).unwrap();
    doc.json_code("result", &input).unwrap();
    let files = Document::render_many(&[doc.finish().unwrap()], Audience::Reader).unwrap();
    assert_eq!(
        std::str::from_utf8(&files["assets/hash-map/result.json"]).unwrap(),
        "{\n  \"a\": [\n    {\n      \"a\": 1,\n      \"m\": 2,\n      \"z\": 3\n    }\n  ],\n  \"z\": [\n    {\n      \"a\": 1,\n      \"m\": 2,\n      \"z\": 3\n    }\n  ]\n}\n",
    );
}
