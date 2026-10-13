//! Emit common frozen input and exports from actual native authoring. The Node
//! conformance test authors the same document independently and compares bytes.
use lgtmd::{
    Artifact, Doc, ExportLayout, Result,
    transport::{self, Input},
};
use serde_json::json;

fn main() -> Result<()> {
    let mut doc = Doc::new("portable", "Portable document")?;
    let count = doc.observe("count", 3)?;
    let private = doc.observe("internal-only", "private observation")?;
    doc.require("verified-count", true)?;
    doc.heading_with_id("overview", 2, "Overview")?;
    let passage = doc.markdown_parts(("Contains ", &count, " records.\n\n"))?;
    doc.note_on(&passage, ("Internal: ", &private))?;
    let data = doc.json("data", &json!({"z":2,"a":1}))?;
    doc.markdown_parts((
        "Data:\n\n",
        data.code("json"),
        "\n\n",
        data.link("Download"),
        "\n\n",
    ))?;
    let image = doc.resource(
        "image",
        Artifact::new(vec![1, 2, 3], "image/png", "png", "fixture", "exact-v1")?,
    )?;
    doc.markdown_parts((image.image("Fixed fixture bytes"), "\n\n"))?;
    let input = Input::from_documents(&[doc.finish()?])?;
    let exports = transport::compile(&input, &ExportLayout::default())?;
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({"input":input,"exports":exports}))
            .map_err(|e| e.to_string())?
    );
    Ok(())
}
