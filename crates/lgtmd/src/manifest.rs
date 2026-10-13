//! The existing export receipt: typed emission and tolerant, strict validation.
//! Unknown JSON fields remain accepted; validation retains the original protocol
//! rules before typed metadata is used by publication compatibility checks.
use crate::{
    Artifact, Audience, Result,
    lifecycle::{self, Files},
    model::{Content, Document, Node},
    validation::visible_nodes,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

#[derive(Serialize, Deserialize)]
pub(crate) struct Manifest {
    schema_version: u64,
    pub(crate) audience: String,
    profiles: Vec<Profile>,
    documents: Vec<DocumentRecord>,
    pub(crate) artifacts: Vec<ArtifactRecord>,
}
#[derive(Serialize, Deserialize)]
struct Profile {
    producer: String,
    profile: String,
}
#[derive(Serialize, Deserialize)]
struct DocumentRecord {
    id: String,
    title: String,
    checks: Vec<CheckRecord>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    observations: Vec<ObservationRecord>,
    blocks: Vec<BlockRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    bindings: Option<BTreeMap<String, Value>>,
}
#[derive(Serialize, Deserialize)]
struct ObservationRecord {
    id: String,
    value: Value,
}
#[derive(Serialize, Deserialize)]
struct CheckRecord {
    id: String,
    kind: String,
    passed: bool,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present_value"
    )]
    actual: Option<Value>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present_value"
    )]
    expected: Option<Value>,
}
// JSON null is a present observation, distinct from an omitted private payload.
fn present_value<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<Value>, D::Error> {
    Value::deserialize(deserializer).map(Some)
}
#[derive(Serialize, Deserialize)]
struct BlockRecord {
    id: String,
    kind: String,
    references: Vec<ReferenceRecord>,
}
#[derive(Serialize, Deserialize)]
struct ReferenceRecord {
    id: String,
    kind: String,
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(crate) enum ArtifactRecord {
    Page {
        path: String,
        document: String,
        mime: String,
        bytes: u64,
        sha256: String,
    },
    Resource {
        path: String,
        document: String,
        id: String,
        mime: String,
        producer: String,
        profile: String,
        bytes: u64,
        sha256: String,
    },
}
impl ArtifactRecord {
    pub(crate) fn path(&self) -> &str {
        match self {
            Self::Page { path, .. } | Self::Resource { path, .. } => path,
        }
    }
}
fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
impl Manifest {
    pub(crate) fn new(audience: Audience) -> Self {
        Self {
            schema_version: 1,
            audience: match audience {
                Audience::Reader => "reader",
                Audience::Contributor => "contributor",
            }
            .into(),
            profiles: Vec::new(),
            documents: Vec::new(),
            artifacts: Vec::new(),
        }
    }
    pub(crate) fn add_page(&mut self, document: &str, path: &str, bytes: &[u8]) {
        self.artifacts.push(ArtifactRecord::Page {
            path: path.into(),
            document: document.into(),
            mime: "text/markdown".into(),
            bytes: bytes.len() as u64,
            sha256: sha256(bytes),
        });
    }
    pub(crate) fn add_resource(
        &mut self,
        document: &str,
        id: &str,
        path: &str,
        artifact: &Artifact,
    ) {
        self.artifacts.push(ArtifactRecord::Resource {
            path: path.into(),
            document: document.into(),
            id: id.into(),
            mime: artifact.mime.clone(),
            producer: artifact.producer.clone(),
            profile: artifact.profile.clone(),
            bytes: artifact.bytes.len() as u64,
            sha256: sha256(&artifact.bytes),
        });
    }
    pub(crate) fn add_document(&mut self, document: &Document, audience: Audience) -> Result<()> {
        let reader_refs: BTreeSet<_> = document
            .nodes
            .iter()
            .filter(|node| !node.is_note())
            .flat_map(Node::references)
            .map(|r| &r.id)
            .collect();
        let checks = document
            .checks
            .values()
            .map(|check| {
                let reveal = audience == Audience::Contributor || reader_refs.contains(&check.id);
                CheckRecord {
                    id: check.id.clone(),
                    kind: check.kind.clone(),
                    passed: true,
                    actual: reveal.then(|| check.actual.clone()),
                    expected: reveal.then(|| check.expected.clone()),
                }
            })
            .collect();
        let observations = document
            .observations
            .iter()
            .filter(|(id, _)| audience == Audience::Contributor || reader_refs.contains(id))
            .map(|(id, value)| ObservationRecord {
                id: id.clone(),
                value: value.clone(),
            })
            .collect();
        let blocks = visible_nodes(document, audience)
            .map(|node| {
                let kind = match &node.content {
                    Content::Heading(..) => "heading",
                    Content::Paragraph(..) => "paragraph",
                    Content::Markdown(..) => "markdown",
                    Content::MarkdownParts(..) => "markdown-parts",
                    Content::Embed(..) => "embed",
                    Content::Code(..) => "code",
                    Content::Note { .. } => "note",
                };
                let references = node
                    .references()
                    .into_iter()
                    .map(|r| {
                        Ok(ReferenceRecord {
                            id: r.id.clone(),
                            kind: serde_json::to_value(&r.kind)
                                .map_err(|e| e.to_string())?
                                .as_str()
                                .ok_or("Invalid reference kind")?
                                .into(),
                        })
                    })
                    .collect::<Result<Vec<_>>>()?;
                Ok(BlockRecord {
                    id: node.id.clone(),
                    kind: kind.into(),
                    references,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let visible_refs: BTreeSet<_> = visible_nodes(document, audience)
            .flat_map(Node::references)
            .map(|r| &r.id)
            .collect();
        let bindings = document
            .bindings
            .iter()
            .filter(|(id, _)| visible_refs.contains(id))
            .map(|(id, value)| {
                Ok((
                    id.clone(),
                    serde_json::to_value(value).map_err(|e| e.to_string())?,
                ))
            })
            .collect::<Result<BTreeMap<_, _>>>()?;
        self.documents.push(DocumentRecord {
            id: document.id.clone(),
            title: document.title.clone(),
            checks,
            observations,
            blocks,
            bindings: (!bindings.is_empty()).then_some(bindings),
        });
        Ok(())
    }
    pub(crate) fn encode(mut self) -> Result<Vec<u8>> {
        self.artifacts.sort_by(|a, b| a.path().cmp(b.path()));
        let profiles: BTreeSet<_> = self
            .artifacts
            .iter()
            .filter_map(|artifact| match artifact {
                ArtifactRecord::Resource {
                    producer, profile, ..
                } => Some((producer.clone(), profile.clone())),
                _ => None,
            })
            .collect();
        self.profiles = profiles
            .into_iter()
            .map(|(producer, profile)| Profile { producer, profile })
            .collect();
        let mut value = serde_json::to_value(self).map_err(|e| e.to_string())?;
        value.sort_all_objects();
        let mut bytes = serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?;
        bytes.push(b'\n');
        Ok(bytes)
    }
    pub(crate) fn read(files: &Files) -> Result<Self> {
        serde_json::from_value(raw_manifest(files)?)
            .map_err(|e| format!("Invalid manifest.json: {e}"))
    }
    pub(crate) fn resource_profiles(&self) -> Result<BTreeMap<(String, String), (String, String)>> {
        let mut profiles = BTreeMap::new();
        for artifact in &self.artifacts {
            if let ArtifactRecord::Resource {
                document,
                id,
                producer,
                profile,
                ..
            } = artifact
            {
                let identity = (document.clone(), id.clone());
                if profiles
                    .insert(identity.clone(), (producer.clone(), profile.clone()))
                    .is_some()
                {
                    return Err(format!(
                        "Duplicate resource manifest identity: {identity:?}"
                    ));
                }
            }
        }
        Ok(profiles)
    }
}

fn raw_manifest(files: &Files) -> Result<serde_json::Value> {
    let bytes = files.get("manifest.json").ok_or("Missing manifest.json")?;
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|e| format!("Invalid manifest.json: {e}"))?;
    if value["schema_version"] != 1 {
        return Err(format!(
            "Unsupported manifest schema: {}",
            value["schema_version"]
        ));
    }
    if !matches!(value["audience"].as_str(), Some("reader" | "contributor")) {
        return Err("Manifest audience must be reader or contributor".into());
    }
    if !value["profiles"].is_array() {
        return Err("Manifest profiles must be an array".into());
    }
    Ok(value)
}

fn field<'a>(record: &'a Value, name: &str) -> Result<&'a str> {
    record[name]
        .as_str()
        .filter(|text| !text.is_empty())
        .ok_or_else(|| format!("Manifest requires nonempty string field {name}"))
}

fn array<'a>(record: &'a Value, name: &str) -> Result<&'a Vec<Value>> {
    record[name]
        .as_array()
        .ok_or_else(|| format!("Manifest {name} must be an array"))
}

fn identity(identities: &mut BTreeMap<String, String>, id: &str, kind: &str) -> Result<()> {
    if !crate::model::valid_id(id) {
        return Err(format!("Invalid manifest evidence ID: {id}"));
    }
    if identities.insert(id.into(), kind.into()).is_some() {
        return Err(format!("Duplicate manifest evidence identity: {id}"));
    }
    Ok(())
}

pub(crate) fn validate_tree(files: &Files, retired_from: Option<&Files>) -> Result<()> {
    // Check map paths before reading metadata, so no malformed candidate can
    // reach staging merely by omitting that path from its artifact inventory.
    for path in files.keys() {
        lifecycle::validate_path(path)?;
        if path.split('/').next() == Some(".ownership.json") {
            return Err(format!("Reserved ownership path: {path}"));
        }
        for parent in Path::new(path)
            .ancestors()
            .skip(1)
            .filter(|p| !p.as_os_str().is_empty())
        {
            if files.contains_key(parent.to_str().ok_or("Non UTF-8 output path")?) {
                return Err(format!(
                    "Output file conflicts with a parent directory: {path}"
                ));
            }
        }
    }
    let manifest = raw_manifest(files)?;
    let documents = array(&manifest, "documents")?;
    if documents.is_empty() {
        return Err("Manifest must contain at least one document".into());
    }
    let mut identities = BTreeMap::new();
    for document in documents {
        let id = field(document, "id")?;
        if !crate::model::valid_id(id) {
            return Err(format!("Invalid manifest document ID: {id}"));
        }
        field(document, "title")?;
        let mut local = BTreeMap::new();
        let checks = array(document, "checks")?;
        for check in checks {
            let kind = match field(check, "kind")? {
                "equality" => "value",
                "predicate" => "claim",
                other => return Err(format!("Unknown manifest check kind: {other}")),
            };
            identity(&mut local, field(check, "id")?, kind)?;
            if check["passed"] != true {
                return Err(format!(
                    "Manifest document {id} contains a failed or missing check result"
                ));
            }
            if check.get("actual").is_some() != check.get("expected").is_some() {
                return Err(
                    "Manifest check must include both actual and expected payloads, or neither"
                        .into(),
                );
            }
        }
        if document.get("observations").is_some() {
            for observation in array(document, "observations")? {
                identity(&mut local, field(observation, "id")?, "observation")?;
                if observation.get("value").is_none() {
                    return Err("Manifest observation requires a value; null is a value".into());
                }
            }
        }
        for block in array(document, "blocks")? {
            let kind = field(block, "kind")?;
            if !matches!(
                kind,
                "heading" | "paragraph" | "markdown" | "markdown-parts" | "embed" | "code" | "note"
            ) {
                return Err(format!("Unknown manifest block kind: {kind}"));
            }
            if manifest["audience"] == "reader" && kind == "note" {
                return Err("Reader manifest cannot contain contributor notes".into());
            }
            identity(&mut local, field(block, "id")?, "block")?;
            array(block, "references")?;
        }
        if let Some(bindings) = document.get("bindings") {
            for (binding, value) in bindings
                .as_object()
                .ok_or("Manifest bindings must be an object")?
            {
                identity(&mut local, binding, "binding")?;
                let valid_label =
                    |label: &str| !label.is_empty() && !label.chars().any(char::is_control);
                let valid = match field(value, "kind")? {
                    "text" | "code" => value["value"].as_str().is_some_and(valid_label),
                    "keys" => value["value"].as_array().is_some_and(|keys| {
                        !keys.is_empty()
                            && keys.iter().all(|key| key.as_str().is_some_and(valid_label))
                    }),
                    _ => false,
                };
                if !valid {
                    return Err(format!("Invalid manifest binding: {binding}"));
                }
            }
        }
        if identities.insert(id.to_owned(), local).is_some() {
            return Err(format!("Duplicate manifest document identity: {id}"));
        }
    }
    let mut paths = BTreeSet::new();
    let mut pages = BTreeSet::new();
    let mut profiles = BTreeSet::new();
    for artifact in array(&manifest, "artifacts")? {
        let path = field(artifact, "path")?;
        crate::paths::validate_resource_path(path)?;
        if path.split('/').next() == Some(".ownership.json") {
            return Err(format!("Reserved ownership path in manifest: {path}"));
        }
        if !paths.insert(path.to_owned()) {
            return Err(format!("Duplicate manifest artifact path: {path}"));
        }
        let document = field(artifact, "document")?;
        let local = identities
            .get_mut(document)
            .ok_or_else(|| format!("Artifact {path} references unknown document {document}"))?;
        let mime = field(artifact, "mime")?;
        match field(artifact, "kind")? {
            "page" => {
                // The manifest binds each document to its exported page. Page
                // placement belongs to the adopter, not to the document ID.
                if mime != "text/markdown" {
                    return Err(format!("Invalid document page MIME: {path}"));
                }
                if !pages.insert(document.to_owned()) {
                    return Err(format!("Duplicate document page identity: {document}"));
                }
            }
            "resource" => {
                identity(local, field(artifact, "id")?, "resource")?;
                let producer = field(artifact, "producer")?;
                let profile = field(artifact, "profile")?;
                crate::Artifact::new(Vec::new(), mime, "bin", producer, profile)?;
                profiles.insert((producer.to_owned(), profile.to_owned()));
            }
            other => return Err(format!("Unknown manifest artifact kind: {other}")),
        }
        let size = artifact["bytes"]
            .as_u64()
            .ok_or_else(|| format!("Manifest artifact {path} requires a byte length"))?;
        let digest = field(artifact, "sha256")?;
        if digest.len() != 64
            || !digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(format!(
                "Manifest artifact {path} requires a lowercase SHA-256"
            ));
        }
        if let Some(bytes) = files.get(path) {
            if size != bytes.len() as u64 || digest != format!("{:x}", Sha256::digest(bytes)) {
                return Err(format!("Manifest artifact size/hash mismatch: {path}"));
            }
        } else if retired_from.is_none_or(|candidate| candidate.contains_key(path)) {
            return Err(format!("Manifest artifact inventory: missing {path}"));
        }
    }
    if pages != identities.keys().cloned().collect() {
        return Err("Manifest must own exactly one page for every document".into());
    }
    let extra: Vec<_> = files
        .keys()
        .filter(|path| path.as_str() != "manifest.json" && !paths.contains(*path))
        .collect();
    if !extra.is_empty() {
        return Err(format!(
            "Manifest artifact inventory: unrecorded paths {extra:?}"
        ));
    }
    let mut declared_profiles = BTreeSet::new();
    for profile in array(&manifest, "profiles")? {
        let pair = (
            field(profile, "producer")?.to_owned(),
            field(profile, "profile")?.to_owned(),
        );
        if !declared_profiles.insert(pair) {
            return Err("Duplicate manifest producer/profile pair".into());
        }
    }
    if profiles != declared_profiles {
        return Err(
            "Manifest producer/profile inventory does not match its resource metadata".into(),
        );
    }
    for document in documents {
        let id = field(document, "id")?;
        let local = &identities[id];
        for block in array(document, "blocks")? {
            for reference in array(block, "references")? {
                let target = field(reference, "id")?;
                if local.get(target).map(String::as_str) != Some(field(reference, "kind")?) {
                    return Err(format!(
                        "Manifest reference from {id} is missing or has the wrong kind: {target}"
                    ));
                }
            }
        }
    }
    Ok(())
}
