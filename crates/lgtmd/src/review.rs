//! Exact, presentation-independent document and resource pairing.
use crate::{
    Result,
    lifecycle::Files,
    site::{self, Page, Resource},
};
use serde::Serialize;
use std::collections::BTreeSet;

#[derive(Serialize)]
pub struct PagePair {
    pub id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before: Option<Page>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after: Option<Page>,
}
#[derive(Serialize)]
pub struct ResourcePair {
    pub page_id: String,
    pub id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before: Option<Resource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after: Option<Resource>,
    pub compatible: bool,
    pub compatibility: String,
}
#[derive(Serialize)]
pub struct Review {
    pub schema_version: u32,
    pub audience: String,
    pub before: String,
    pub after: String,
    pub site_changed: bool,
    pub pages: Vec<PagePair>,
    pub resources: Vec<ResourcePair>,
}
fn status<T: PartialEq>(before: Option<&T>, after: Option<&T>) -> String {
    match (before, after) {
        (None, Some(_)) => "added",
        (Some(_), None) => "removed",
        (Some(a), Some(b)) if a == b => "unchanged",
        _ => "changed",
    }
    .into()
}
fn uses_resource(nodes: &[site::Node], page_id: &str, id: &str) -> bool {
    nodes.iter().any(|node| {
        node.page_id.as_deref() == Some(page_id) && node.resource_id.as_deref() == Some(id)
            || uses_resource(&node.children, page_id, id)
    })
}
fn page_uses(page: &Page, resource: &ResourcePair) -> bool {
    page.id == resource.page_id
        || uses_resource(&page.content, &resource.page_id, &resource.id)
        || page
            .notes
            .iter()
            .any(|note| uses_resource(&note.content, &resource.page_id, &resource.id))
}
pub fn compare(before: &Files, after: &Files) -> Result<Review> {
    let before = site::validate(&crate::lifecycle::strip_ownership(before)?)?.bundle;
    let after = site::validate(&crate::lifecycle::strip_ownership(after)?)?.bundle;
    if before.audience != after.audience {
        return Err("Cannot compare different site audiences".into());
    }
    let resource_ids: BTreeSet<_> = before
        .resources
        .iter()
        .chain(&after.resources)
        .map(|r| (&r.page_id, &r.id))
        .collect();
    let resources: Vec<_> = resource_ids
        .into_iter()
        .map(|(page, id)| {
            let a = before
                .resources
                .iter()
                .find(|r| r.page_id == *page && r.id == *id);
            let b = after
                .resources
                .iter()
                .find(|r| r.page_id == *page && r.id == *id);
            let compatibility = match (a, b) {
                (Some(a), Some(b)) if a.mime != b.mime => "different-format",
                (Some(a), Some(b)) if a.producer != b.producer || a.profile != b.profile => {
                    "different-profile"
                }
                (Some(_), Some(_)) => "matching",
                _ => "missing-side",
            };
            ResourcePair {
                page_id: page.clone(),
                id: id.clone(),
                status: status(a, b),
                before: a.cloned(),
                after: b.cloned(),
                compatible: compatibility == "matching",
                compatibility: compatibility.into(),
            }
        })
        .collect();
    let page_ids: BTreeSet<_> = before
        .pages
        .iter()
        .chain(&after.pages)
        .map(|p| &p.id)
        .collect();
    let pages = page_ids
        .into_iter()
        .map(|id| {
            let a = before.pages.iter().find(|p| p.id == *id);
            let b = after.pages.iter().find(|p| p.id == *id);
            let mut change = status(a, b);
            if change == "unchanged"
                && resources.iter().any(|r| {
                    r.status != "unchanged"
                        && (a.is_some_and(|page| page_uses(page, r))
                            || b.is_some_and(|page| page_uses(page, r)))
                })
            {
                change = "changed".into();
            }
            PagePair {
                id: id.clone(),
                status: change,
                before: a.cloned(),
                after: b.cloned(),
            }
        })
        .collect();
    Ok(Review {
        schema_version: 1,
        audience: before.audience,
        before: before.digest,
        after: after.digest,
        site_changed: before.title != after.title || before.navigation != after.navigation,
        pages,
        resources,
    })
}
