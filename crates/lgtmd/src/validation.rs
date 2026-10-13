//! Intrinsic document visibility, independent of output formatting.
use crate::{
    Audience, Result,
    model::{Document, Kind, Node},
};
use std::collections::BTreeSet;

pub(crate) fn visible_nodes(
    document: &Document,
    audience: Audience,
) -> impl Iterator<Item = &Node> {
    document
        .nodes
        .iter()
        .filter(move |node| audience == Audience::Contributor || !node.is_note())
}

pub(crate) fn validate_document(document: &Document) -> Result<()> {
    for audience in [Audience::Reader, Audience::Contributor] {
        let ids: BTreeSet<_> = visible_nodes(document, audience)
            .map(|node| node.id.as_str())
            .collect();
        for node in visible_nodes(document, audience) {
            for reference in node.references() {
                if reference.kind == Kind::Block && !ids.contains(reference.id.as_str()) {
                    return Err(format!(
                        "Visible block {} references excluded block {}",
                        node.id, reference.id
                    ));
                }
            }
        }
    }
    Ok(())
}
