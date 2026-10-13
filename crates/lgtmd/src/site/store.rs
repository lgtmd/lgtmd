//! Strict site inventory policy over the shared guarded output transaction.
use super::{Projection, canonical, encoded, sha256, validate};
use crate::{
    Result,
    lifecycle::{self, Files, Ownership},
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path};

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StoreKind {
    #[default]
    Snapshot,
    Static,
    Markdown,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    bytes: u64,
    sha256: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Receipt {
    schema_version: u32,
    audience: String,
    digest: String,
    files: BTreeMap<String, Entry>,
}
#[derive(Serialize)]
pub struct Validated {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle: Option<super::Bundle>,
    pub files: Files,
}
fn inventory(files: &Files) -> BTreeMap<String, Entry> {
    files
        .iter()
        .filter(|(path, _)| path.as_str() != ".site.json")
        .map(|(path, bytes)| {
            (
                path.clone(),
                Entry {
                    bytes: bytes.len() as u64,
                    sha256: sha256(bytes),
                },
            )
        })
        .collect()
}
fn subset(files: &Files) -> Result<Files> {
    let bytes = files.get("bundle.json").ok_or("Missing site bundle.json")?;
    let bundle: super::Bundle = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    let mut owned = Files::from([("bundle.json".into(), bytes.clone())]);
    for resource in &bundle.resources {
        owned.insert(
            resource.path.clone(),
            files
                .get(&resource.path)
                .ok_or_else(|| format!("Missing resource: {}", resource.path))?
                .clone(),
        );
    }
    Ok(owned)
}
fn paths(files: &Files) -> Result<()> {
    for path in files.keys() {
        lifecycle::validate_path(path)?;
        if path.split('/').next() == Some(".ownership.json") {
            return Err("Ownership marker is managed by the store".into());
        }
        for parent in Path::new(path)
            .ancestors()
            .skip(1)
            .filter(|p| !p.as_os_str().is_empty())
        {
            if files.contains_key(parent.to_str().ok_or("Non UTF-8 file path")?) {
                return Err("File/directory collision in site output".into());
            }
        }
    }
    Ok(())
}
pub fn validate_files(files: &Files, kind: StoreKind) -> Result<Validated> {
    let clean = lifecycle::strip_ownership(files)?;
    let files = &clean;
    paths(files)?;
    let bundle = match kind {
        StoreKind::Snapshot => Some(validate(files)?.bundle),
        StoreKind::Markdown => {
            crate::manifest::validate_tree(files, None)?;
            None
        }
        StoreKind::Static => {
            if !files.contains_key("index.html") {
                return Err("Static site requires index.html".into());
            }
            let bytes = files
                .get(".site.json")
                .ok_or("Missing static site receipt .site.json")?;
            let receipt: Receipt = serde_json::from_slice(bytes)
                .map_err(|e| format!("Invalid static site receipt: {e}"))?;
            if receipt.schema_version != 1
                || canonical(&receipt.files)? != canonical(&inventory(files))?
                || encoded(&receipt)? != *bytes
            {
                return Err("Static site inventory/hash mismatch".into());
            }
            let projection = validate(&subset(files)?)?;
            if receipt.audience != projection.bundle.audience
                || receipt.digest != projection.bundle.digest
            {
                return Err("Static site audience/digest mismatch".into());
            }
            Some(projection.bundle)
        }
    };
    Ok(Validated {
        bundle,
        files: files.clone(),
    })
}
fn prepare(files: &Files, kind: StoreKind) -> Result<Files> {
    paths(files)?;
    let mut files = files.clone();
    if matches!(kind, StoreKind::Static) {
        if files.contains_key(".site.json") {
            validate_files(&files, kind)?;
            files.remove(".site.json");
        }
        let Projection { bundle, .. } = validate(&subset(&files)?)?;
        let receipt = Receipt {
            schema_version: 1,
            audience: bundle.audience,
            digest: bundle.digest,
            files: inventory(&files),
        };
        files.insert(".site.json".into(), encoded(&receipt)?);
    }
    validate_files(&files, kind)?;
    Ok(files)
}
fn compatible(current: &Files, candidate: &Files, kind: StoreKind) -> Result<()> {
    let old = validate_files(current, kind)?;
    let new = validate_files(candidate, kind)?;
    if matches!(kind, StoreKind::Snapshot)
        && old.bundle.as_ref().map(|b| &b.audience) != new.bundle.as_ref().map(|b| &b.audience)
    {
        return Err("Snapshot audience mismatch".into());
    }
    if matches!(kind, StoreKind::Markdown) {
        let old = crate::manifest::Manifest::read(current)?;
        let new = crate::manifest::Manifest::read(candidate)?;
        if old.audience != new.audience {
            return Err("Markdown recording audience mismatch".into());
        }
    }
    Ok(())
}
/// Input bytes are validated once and that exact immutable set is staged. Static
/// output alone permits explicit audience replacement; its old inventory still
/// has to be complete, so private files cannot survive a Reader rebuild.
pub fn publish(command: &str, path: &Path, files: &Files, kind: StoreKind) -> Result<Files> {
    let files = prepare(files, kind)?;
    match command {
        "build" => lifecycle::build(path, &files, Ownership::Recorded)?,
        "update" => lifecycle::replace_owned(path, &files, |old, new| compatible(old, new, kind))?,
        "check" => lifecycle::check(path, &files, Ownership::Recorded, |old, new| {
            compatible(old, new, kind)
        })?,
        _ => return Err("Site store command must be build, update, or check".into()),
    }
    Ok(files)
}
