use lgtmd::{Audience, BindingValue, Doc, Document, IntoProse, Prose, prose};
use std::cell::Cell;

#[test]
fn named_prose_preserves_typed_evidence_and_exact_text() {
    fn document(named: bool) -> Document {
        let mut doc = Doc::new("prose", "Prose").unwrap();
        let count = doc.expect_eq("count", 3, 3).unwrap();
        let key = doc
            .binding("key", BindingValue::Keys(vec!["Space".into()]))
            .unwrap();
        let parts = if named {
            prose!(
                "Press {key} for **{count}** items. Again: {count}. {{literal}}\n",
                key = &key,
                count = &count
            )
            .unwrap()
        } else {
            prose![
                "Press ",
                &key,
                " for **",
                &count,
                "** items. Again: ",
                &count,
                ". {literal}\n"
            ]
            .into_prose()
        };
        doc.markdown_parts(parts).unwrap();
        doc.finish().unwrap()
    }
    for audience in [Audience::Reader, Audience::Contributor] {
        assert_eq!(
            Document::render_many(&[document(true)], audience).unwrap(),
            Document::render_many(&[document(false)], audience).unwrap(),
        );
    }
}

#[test]
fn named_expressions_run_once_even_when_referenced_twice() {
    let evaluations = Cell::new(0);
    let parts = prose!(
        "{value} and {value}",
        value = {
            evaluations.set(evaluations.get() + 1);
            "one"
        }
    )
    .unwrap();
    assert_eq!(evaluations.get(), 1);
    let mut doc = Doc::new("once", "Once").unwrap();
    doc.require("evaluated-once", evaluations.get() == 1)
        .unwrap();
    doc.paragraph(parts).unwrap();
    let text = doc
        .finish()
        .unwrap()
        .render_fragment(Audience::Reader)
        .unwrap();
    assert_eq!(text, "one and one\n\n");
}

#[test]
fn invalid_interpolation_fails_instead_of_dropping_evidence() {
    for text in [
        "{missing}",
        "{value",
        "value}",
        "{value:?}",
        "no placeholders",
    ] {
        assert!(Prose::interpolate(text, [("value", "x".into_prose())]).is_err());
    }
}

#[test]
fn duplicate_names_and_foreign_handles_remain_errors() {
    assert!(Prose::interpolate("{x}", [("x", "a".into_prose()), ("x", "b".into_prose())]).is_err());
    let mut first = Doc::new("first", "First").unwrap();
    let value = first.expect_eq("value", 3, 3).unwrap();
    let mut second = Doc::new("second", "Second").unwrap();
    second.require("check", true).unwrap();
    assert!(
        second
            .paragraph(prose!("Observed {value}", value = &value).unwrap())
            .is_err()
    );
    assert!(second.finish().is_err());
}

#[test]
fn private_interpolated_resources_stay_private() {
    let mut doc = Doc::new("notes", "Notes").unwrap();
    doc.require("check", true).unwrap();
    doc.paragraph("Public explanation.").unwrap();
    let private = doc.text("private", "private bytes").unwrap();
    doc.note(prose!("Internal evidence: {private}", private = &private).unwrap())
        .unwrap();
    let document = doc.finish().unwrap();
    let reader = Document::render_many(std::slice::from_ref(&document), Audience::Reader).unwrap();
    assert!(!reader.contains_key("assets/notes/private.txt"));
    let contributor = Document::render_many(&[document], Audience::Contributor).unwrap();
    assert_eq!(contributor["assets/notes/private.txt"], b"private bytes");
}
