//! Immutable completed candidates and the separately published last-success pointer.
use crate::{config::Config, util};
use lgtmd::{
    Result,
    lifecycle::{self, Files},
    site::{
        self, Projection,
        store::{self, StoreKind},
    },
    transport,
};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Markdown {
    pub reader: Files,
    pub contributor: Files,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Candidate {
    pub reader: Projection,
    pub contributor: Projection,
    pub markdown: Markdown,
    pub candidate_id: String,
}
impl From<site::Compiled> for Candidate {
    fn from(value: site::Compiled) -> Self {
        Self {
            reader: value.reader,
            contributor: value.contributor,
            markdown: Markdown {
                reader: value.markdown.reader,
                contributor: value.markdown.contributor,
            },
            candidate_id: value.candidate_id,
        }
    }
}
impl Candidate {
    pub fn projection(&self, audience: &str) -> &Projection {
        if audience == "contributor" {
            &self.contributor
        } else {
            &self.reader
        }
    }
    pub fn markdown(&self, audience: &str) -> &Files {
        if audience == "contributor" {
            &self.markdown.contributor
        } else {
            &self.markdown.reader
        }
    }
}
fn id_valid(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
pub fn identity(value: &Candidate) -> Result<String> {
    site::candidate_id(
        &value.reader,
        &value.contributor,
        &transport::Exports {
            reader: value.markdown.reader.clone(),
            contributor: value.markdown.contributor.clone(),
        },
    )
}
pub fn validate(value: &Candidate) -> Result<()> {
    if !id_valid(&value.candidate_id) || identity(value)? != value.candidate_id {
        return Err("Candidate identity mismatch or tampered candidate".into());
    }
    let reader = site::validate(&value.reader.files)?;
    let contributor = site::validate(&value.contributor.files)?;
    if reader.bundle.audience != "reader"
        || contributor.bundle.audience != "contributor"
        || reader.bundle != value.reader.bundle
        || contributor.bundle != value.contributor.bundle
    {
        return Err("Candidate bundle does not match its validated bytes".into());
    }
    store::validate_files(&value.markdown.reader, StoreKind::Markdown)?;
    store::validate_files(&value.markdown.contributor, StoreKind::Markdown)?;
    Ok(())
}
pub fn private_dir(path: &Path) -> Result<()> {
    lifecycle::absolute(path)?;
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .create(path)
        .map_err(|e| format!("Create private directory {}: {e}", path.display()))
}
fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|e| format!("Create {}: {e}", path.display()))?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|e| format!("Write {}: {e}", path.display()))
}
pub fn ensure_active(cancel: Option<&CancellationToken>) -> Result<()> {
    if cancel.is_some_and(CancellationToken::is_cancelled) {
        Err("Run cancelled before publication".into())
    } else {
        Ok(())
    }
}
pub fn atomic_json(
    path: &Path,
    value: &impl Serialize,
    cancel: Option<&CancellationToken>,
) -> Result<()> {
    ensure_active(cancel)?;
    private_dir(path.parent().ok_or("JSON destination has no parent")?)?;
    let temp = path.with_file_name(format!(
        "{}.{}.tmp",
        path.file_name().unwrap_or_default().to_string_lossy(),
        util::token()?
    ));
    let outcome = (|| {
        write_private(
            &temp,
            &serde_json::to_vec(value).map_err(|e| e.to_string())?,
        )?;
        ensure_active(cancel)?;
        // Publication is this rename; no fallible cleanup follows success.
        fs::rename(&temp, path).map_err(|e| format!("Publish {}: {e}", path.display()))
    })();
    if outcome.is_err() {
        let _ = fs::remove_file(&temp);
    }
    outcome
}
pub fn load_candidate(config: &Config, id: &str) -> Result<Candidate> {
    if !id_valid(id) {
        return Err("Candidate ID must be a complete SHA-256 identity".into());
    }
    let path = config
        .cache_dir
        .join("candidates")
        .join(id)
        .join("candidate.json");
    lifecycle::absolute(&path)?;
    let meta = fs::symlink_metadata(&path).map_err(|e| format!("Read candidate {id}: {e}"))?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 512 * 1024 * 1024 {
        return Err("Invalid or oversized candidate file".into());
    }
    let value: Candidate = serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Invalid candidate: {e}"))?;
    validate(&value)?;
    if value.candidate_id != id {
        return Err("Candidate path identity mismatch".into());
    }
    Ok(value)
}
pub fn admit_candidate(
    config: &Config,
    value: &Candidate,
    cancel: Option<&CancellationToken>,
    publish: bool,
) -> Result<()> {
    ensure_active(cancel)?;
    validate(value)?;
    ensure_active(cancel)?;
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    if bytes.len() > 512 * 1024 * 1024 {
        return Err("Candidate exceeds the v1 512 MiB retained-file budget".into());
    }
    let parent = config.cache_dir.join("candidates");
    private_dir(&parent)?;
    let target = parent.join(&value.candidate_id);
    match fs::symlink_metadata(&target) {
        Ok(_) => {
            load_candidate(config, &value.candidate_id)?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let staging = parent.join(format!(".pending-{}", util::token()?));
            private_dir(&staging)?;
            let result = (|| {
                write_private(&staging.join("candidate.json"), &bytes)?;
                match fs::rename(&staging, &target) {
                    Ok(()) => Ok(()),
                    Err(e)
                        if matches!(
                            e.kind(),
                            std::io::ErrorKind::AlreadyExists
                                | std::io::ErrorKind::DirectoryNotEmpty
                        ) =>
                    {
                        load_candidate(config, &value.candidate_id).map(|_| ())
                    }
                    Err(e) => Err(e.to_string()),
                }
            })();
            if staging.exists() {
                fs::remove_dir_all(&staging).map_err(|e| e.to_string())?;
            }
            result?;
        }
        Err(e) => return Err(e.to_string()),
    }
    if publish {
        publish_candidate(config, value, cancel)?;
    }
    Ok(())
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LastSuccess {
    schema_version: u32,
    candidate_id: String,
}
fn last_path(config: &Config) -> PathBuf {
    config
        .cache_dir
        .join("last-success")
        .join(format!("{}.json", config.key))
}
pub fn publish_candidate(
    config: &Config,
    value: &Candidate,
    cancel: Option<&CancellationToken>,
) -> Result<()> {
    atomic_json(
        &last_path(config),
        &LastSuccess {
            schema_version: 1,
            candidate_id: value.candidate_id.clone(),
        },
        cancel,
    )
}
pub fn latest_candidate(config: &Config) -> Result<Candidate> {
    let path = last_path(config);
    lifecycle::absolute(&path)?;
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err("No retained candidate: run lgtmd dev first".into());
        }
        Err(e) => return Err(format!("Read retained candidate receipt: {e}")),
    };
    let receipt: LastSuccess = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Invalid retained candidate receipt: {e}"))?;
    if receipt.schema_version != 1 {
        return Err("Unsupported retained candidate receipt".into());
    }
    load_candidate(config, &receipt.candidate_id)
}
pub fn read_tree(path: &Path) -> Result<Files> {
    if !path.exists() {
        return Err(format!("Missing artifact directory: {}", path.display()));
    }
    lifecycle::read_tree(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::load_config;
    fn fixture() -> (tempfile::TempDir, Config) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("lgtmd.config.json");
        fs::write(&path, "{}").unwrap();
        let config = load_config(Some(&path), false).unwrap();
        (dir, config)
    }
    fn candidate(text: &str) -> Candidate {
        let mut doc = lgtmd::Doc::new("hello", "Hello").unwrap();
        doc.paragraph(text).unwrap();
        doc.note("PRIVATE NOTE").unwrap();
        Candidate::from(
            site::compile(
                &transport::Input::from_documents(&[doc.finish().unwrap()]).unwrap(),
                "Example",
                None,
            )
            .unwrap(),
        )
    }
    #[test]
    fn validates_immutable_evidence_and_scopes_last_success() {
        let (_dir, config) = fixture();
        let value = candidate("Public");
        admit_candidate(&config, &value, None, true).unwrap();
        assert_eq!(
            latest_candidate(&config).unwrap().candidate_id,
            value.candidate_id
        );
        assert!(
            !String::from_utf8(site::canonical(&value.reader).unwrap())
                .unwrap()
                .contains("PRIVATE NOTE")
        );
        let mut other = config.clone();
        other.key = "other".into();
        assert!(
            latest_candidate(&other)
                .unwrap_err()
                .starts_with("No retained candidate:")
        );
        let path = config
            .cache_dir
            .join("candidates")
            .join(&value.candidate_id)
            .join("candidate.json");
        let mut damaged = value.clone();
        damaged.reader.bundle.title = "Tampered".into();
        fs::write(path, serde_json::to_vec(&damaged).unwrap()).unwrap();
        assert!(
            load_candidate(&config, &value.candidate_id)
                .unwrap_err()
                .contains("validated bytes")
        );
    }
    #[test]
    fn aborted_admission_or_final_publication_preserves_previous_success() {
        let (_dir, config) = fixture();
        let before = candidate("Before");
        let after = candidate("After");
        admit_candidate(&config, &before, None, true).unwrap();
        let cancel = CancellationToken::new();
        cancel.cancel();
        assert!(admit_candidate(&config, &after, Some(&cancel), true).is_err());
        admit_candidate(&config, &after, None, false).unwrap();
        assert!(publish_candidate(&config, &after, Some(&cancel)).is_err());
        assert_eq!(
            latest_candidate(&config).unwrap().candidate_id,
            before.candidate_id
        );
    }
}
