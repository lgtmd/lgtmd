//! Audience-filtered, safe site content and exact resource sidecars.
//!
//! This is independent of presentation, Git, deployment URLs, and application
//! execution. The existing Markdown export remains a separate unchanged format.
mod content;
pub mod store;

use crate::{
    Audience, ExportLayout, Result,
    lifecycle::Files,
    model::{Content, Kind},
    transport::{self, Input},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Node {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<Node>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub align: Vec<String>,
}
impl Node {
    pub(crate) fn new(kind: &str) -> Self {
        Self {
            kind: kind.into(),
            children: Vec::new(),
            text: None,
            level: None,
            start: None,
            url: None,
            title: None,
            language: None,
            id: None,
            resource_id: None,
            page_id: None,
            align: Vec::new(),
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Target {
    pub id: String,
    pub kind: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Note {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<Target>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<String>,
    pub content: Vec<Node>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Page {
    pub id: String,
    pub title: String,
    pub content: Vec<Node>,
    pub anchors: Vec<String>,
    pub notes: Vec<Note>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub targets: Vec<Target>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Resource {
    pub page_id: String,
    pub id: String,
    pub path: String,
    pub mime: String,
    pub producer: String,
    pub profile: String,
    pub bytes: u64,
    pub sha256: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Bundle {
    pub schema_version: u32,
    pub audience: String,
    pub title: String,
    pub navigation: Vec<String>,
    pub pages: Vec<Page>,
    pub resources: Vec<Resource>,
    pub digest: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Projection {
    pub bundle: Bundle,
    pub files: Files,
}
#[derive(Serialize)]
pub struct Compiled {
    pub reader: Projection,
    pub contributor: Projection,
    pub markdown: transport::Exports,
    pub candidate_id: String,
}

pub fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn canonical<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    let mut value = serde_json::to_value(value).map_err(|e| e.to_string())?;
    value.sort_all_objects();
    serde_json::to_vec(&value).map_err(|e| e.to_string())
}
fn encoded<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    let mut value = serde_json::to_value(value).map_err(|e| e.to_string())?;
    value.sort_all_objects();
    let mut bytes = serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    Ok(bytes)
}
fn bundle_digest(bundle: &Bundle) -> Result<String> {
    let mut value = bundle.clone();
    value.digest.clear();
    Ok(sha256(&canonical(&value)?))
}
pub fn candidate_id(
    reader: &Projection,
    contributor: &Projection,
    markdown: &transport::Exports,
) -> Result<String> {
    Ok(sha256(
        format!(
            "{}\n{}\n{}\n{}\n",
            reader.bundle.digest,
            contributor.bundle.digest,
            sha256(&canonical(&markdown.reader)?),
            sha256(&canonical(&markdown.contributor)?)
        )
        .as_bytes(),
    ))
}

/// Compile both projections from one completed input. The legacy exporter is
/// deliberately invoked unchanged and validates complete Markdown provenance.
pub fn compile(input: &Input, title: &str, navigation: Option<&[String]>) -> Result<Compiled> {
    if title.trim().is_empty() {
        return Err("Site title must not be empty".into());
    }
    let documents = input.thaw()?;
    let markdown = transport::compile(input, &ExportLayout::default())?;
    let mut page_ids: Vec<_> = documents.iter().map(|d| d.id.clone()).collect();
    page_ids.sort();
    let navigation = navigation.unwrap_or(&page_ids).to_vec();
    let unique: BTreeSet<_> = navigation.iter().cloned().collect();
    if unique.len() != navigation.len() || unique != page_ids.iter().cloned().collect() {
        return Err("Navigation must list every page ID exactly once".into());
    }
    let projection = |audience: Audience, files: &Files| -> Result<Projection> {
        let manifest: serde_json::Value =
            serde_json::from_slice(&files["manifest.json"]).map_err(|e| e.to_string())?;
        let mut resources = Vec::new();
        let mut sidecars = Files::new();
        for record in manifest["artifacts"]
            .as_array()
            .ok_or("Invalid Markdown manifest")?
        {
            if record["kind"] != "resource" {
                continue;
            }
            let field = |name: &str| {
                record[name]
                    .as_str()
                    .ok_or_else(|| format!("Missing resource {name}"))
                    .map(str::to_owned)
            };
            let path = field("path")?;
            // Reserve metadata paths even for caller-selected resource paths.
            if matches!(path.as_str(), "bundle.json" | ".site.json") {
                return Err(format!("Reserved site resource path: {path}"));
            }
            sidecars.insert(path.clone(), files[&path].clone());
            resources.push(Resource {
                page_id: field("document")?,
                id: field("id")?,
                path,
                mime: field("mime")?,
                producer: field("producer")?,
                profile: field("profile")?,
                bytes: record["bytes"].as_u64().ok_or("Invalid resource length")?,
                sha256: field("sha256")?,
            });
        }
        resources.sort_by(|a, b| (&a.page_id, &a.id).cmp(&(&b.page_id, &b.id)));
        let mut pages = Vec::new();
        for document in &documents {
            let path = format!("{}.md", document.id);
            let source = std::str::from_utf8(&markdown.reader[&path]).map_err(|e| e.to_string())?;
            let content = content::parse(source, &path, &page_ids, &resources)?;
            let mut anchors = Vec::new();
            content::anchors(&content, &mut anchors);
            let mut notes = Vec::new();
            let mut targets = Vec::new();
            if audience == Audience::Contributor {
                let contributor = content::parse(
                    std::str::from_utf8(&files[&path]).map_err(|e| e.to_string())?,
                    &path,
                    &page_ids,
                    &resources,
                )?;
                for node in &document.nodes {
                    let Content::Note { target, .. } = &node.content else {
                        continue;
                    };
                    let note_content = content::note(&contributor, &node.id)?;
                    let target = target.as_ref().map(|reference| Target {
                        id: reference.id.clone(),
                        kind: match reference.kind {
                            Kind::Block => "block",
                            Kind::Claim => "claim",
                            Kind::Value => "value",
                            Kind::Observation => "observation",
                            Kind::Resource => "resource",
                            Kind::Binding => "binding",
                        }
                        .into(),
                    });
                    if let Some(target) = &target
                        && !targets.contains(target)
                    {
                        targets.push(target.clone());
                    }
                    let anchor = target.as_ref().and_then(|target| {
                        if target.kind == "block" && anchors.contains(&target.id) {
                            return Some(target.id.clone());
                        }
                        document
                            .nodes
                            .iter()
                            .find(|node| {
                                !node.is_note()
                                    && node
                                        .references()
                                        .iter()
                                        .any(|reference| reference.id == target.id)
                            })
                            .map(|node| node.id.clone())
                            .filter(|id| anchors.contains(id))
                    });
                    notes.push(Note {
                        id: node.id.clone(),
                        target,
                        anchor,
                        content: note_content,
                    });
                    anchors.push(node.id.clone());
                }
            }
            pages.push(Page {
                id: document.id.clone(),
                title: document.title.clone(),
                content,
                anchors,
                notes,
                targets,
            });
        }
        pages.sort_by(|a, b| a.id.cmp(&b.id));
        let mut bundle = Bundle {
            schema_version: 1,
            audience: match audience {
                Audience::Reader => "reader",
                Audience::Contributor => "contributor",
            }
            .into(),
            title: title.into(),
            navigation: navigation.clone(),
            pages,
            resources,
            digest: String::new(),
        };
        bundle.digest = bundle_digest(&bundle)?;
        sidecars.insert("bundle.json".into(), encoded(&bundle)?);
        validate(&sidecars)
    };
    let reader = projection(Audience::Reader, &markdown.reader)?;
    let contributor = projection(Audience::Contributor, &markdown.contributor)?;
    let candidate_id = candidate_id(&reader, &contributor, &markdown)?;
    Ok(Compiled {
        reader,
        contributor,
        markdown,
        candidate_id,
    })
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|v| v.is_ascii_digit() || (b'a'..=b'f').contains(&v))
}
fn target_valid(target: &Target) -> bool {
    crate::model::valid_id(&target.id)
        && matches!(
            target.kind.as_str(),
            "block" | "claim" | "value" | "observation" | "resource" | "binding"
        )
}

/// Validate untrusted history including all AST structure, references, sidecars,
/// inventory, and canonical encoding; hashes alone never make content safe.
pub fn validate(files: &Files) -> Result<Projection> {
    for key in files.keys() {
        crate::lifecycle::validate_path(key)?;
        for parent in std::path::Path::new(key)
            .ancestors()
            .skip(1)
            .filter(|p| !p.as_os_str().is_empty())
        {
            if files.contains_key(parent.to_str().ok_or("Non UTF-8 path")?) {
                return Err("Site file/directory path collision".into());
            }
        }
    }
    let bytes = files.get("bundle.json").ok_or("Missing site bundle.json")?;
    if bytes.starts_with(b"version https://git-lfs.github.com/spec/v1") {
        return Err("Unhydrated Git LFS pointer for bundle.json".into());
    }
    let bundle: Bundle =
        serde_json::from_slice(bytes).map_err(|e| format!("Invalid site bundle: {e}"))?;
    if bundle.schema_version != 1 {
        return Err(format!(
            "Unsupported site bundle version: {}",
            bundle.schema_version
        ));
    }
    if !matches!(bundle.audience.as_str(), "reader" | "contributor")
        || bundle.title.trim().is_empty()
    {
        return Err("Invalid site audience or title".into());
    }
    if !valid_hash(&bundle.digest)
        || bundle_digest(&bundle)? != bundle.digest
        || encoded(&bundle)? != *bytes
    {
        return Err("Site bundle digest or canonical encoding mismatch".into());
    }
    if bundle.pages.is_empty() {
        return Err("Site must contain at least one page".into());
    }
    let pages: BTreeMap<_, _> = bundle.pages.iter().map(|p| (p.id.as_str(), p)).collect();
    if pages.len() != bundle.pages.len() || pages.keys().any(|id| !crate::model::valid_id(id)) {
        return Err("Duplicate or invalid site page ID".into());
    }
    let nav: BTreeSet<_> = bundle.navigation.iter().map(String::as_str).collect();
    if nav.len() != bundle.navigation.len() || nav != pages.keys().copied().collect() {
        return Err("Invalid recorded site navigation".into());
    }
    let mut resource_ids = BTreeSet::new();
    let mut inventory = BTreeSet::from(["bundle.json".to_owned()]);
    for resource in &bundle.resources {
        crate::paths::validate_resource_path(&resource.path)?;
        if matches!(resource.path.as_str(), "bundle.json" | ".site.json") {
            return Err("Reserved site resource path".into());
        }
        if !pages.contains_key(resource.page_id.as_str())
            || !crate::model::valid_id(&resource.id)
            || !resource_ids.insert((&resource.page_id, &resource.id))
            || !inventory.insert(resource.path.clone())
        {
            return Err("Duplicate, reserved, or invalid site resource identity/path".into());
        }
        crate::Artifact::new(
            Vec::new(),
            &resource.mime,
            "bin",
            &resource.producer,
            &resource.profile,
        )?;
        let bytes = files
            .get(&resource.path)
            .ok_or_else(|| format!("Missing site resource: {}", resource.path))?;
        if bytes.starts_with(b"version https://git-lfs.github.com/spec/v1") {
            return Err(format!("Unhydrated Git LFS pointer: {}", resource.path));
        }
        if !valid_hash(&resource.sha256)
            || resource.sha256 != sha256(bytes)
            || resource.bytes != bytes.len() as u64
        {
            return Err(format!(
                "Site resource hash/length mismatch: {}",
                resource.path
            ));
        }
    }
    if inventory != files.keys().cloned().collect() {
        return Err("Site resource inventory has missing or extra files".into());
    }
    for page in &bundle.pages {
        if page.title.trim().is_empty() {
            return Err("Page title must not be empty".into());
        }
        let declared: BTreeSet<_> = page.anchors.iter().collect();
        if declared.len() != page.anchors.len()
            || declared.iter().any(|id| !crate::model::valid_id(id))
        {
            return Err("Invalid or duplicate site anchors".into());
        }
        if bundle.audience == "reader" && (!page.notes.is_empty() || !page.targets.is_empty()) {
            return Err("Reader site cannot contain contributor notes or target metadata".into());
        }
        let mut observed = Vec::new();
        content::anchors(&page.content, &mut observed);
        let mut referenced = BTreeSet::new();
        content::validate_nodes(&page.content, &bundle, &mut referenced, 0)?;
        let mut seen_targets = BTreeSet::new();
        for target in &page.targets {
            if !target_valid(target) || !seen_targets.insert(&target.id) {
                return Err("Invalid note target catalog".into());
            }
            if target.kind == "block" && !declared.contains(&target.id) {
                return Err("Note target refers to missing block".into());
            }
            if target.kind == "resource" && !resource_ids.contains(&(&page.id, &target.id)) {
                return Err("Note target refers to missing resource".into());
            }
        }
        for note in &page.notes {
            if !crate::model::valid_id(&note.id)
                || note
                    .anchor
                    .as_ref()
                    .is_some_and(|id| !observed.contains(id))
                || note
                    .target
                    .as_ref()
                    .is_some_and(|target| !page.targets.contains(target))
            {
                return Err("Invalid contributor note target/anchor".into());
            }
            observed.push(note.id.clone());
            content::anchors(&note.content, &mut observed);
            content::validate_nodes(&note.content, &bundle, &mut referenced, 0)?;
        }
        if observed.len() != page.anchors.len()
            || observed.iter().collect::<BTreeSet<_>>() != declared
        {
            return Err("Site anchor inventory does not match content".into());
        }
    }
    Ok(Projection {
        bundle,
        files: files.clone(),
    })
}
