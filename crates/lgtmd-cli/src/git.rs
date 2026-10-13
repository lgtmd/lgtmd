//! Read immutable recorded evidence through Git objects, never historical code.
use crate::config::Config;
use lgtmd::{
    Result,
    lifecycle::Files,
    site::{self, Projection},
};
use serde::Serialize;
use std::{path::Path, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
};

const MAX_BLOB: usize = 64 * 1024 * 1024;
const MAX_SNAPSHOT: usize = 256 * 1024 * 1024;
#[derive(Clone, Debug, Serialize)]
pub struct GitBaseline {
    pub status: String,
    #[serde(rename = "ref")]
    pub reference: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub projection: Option<Projection>,
}
impl GitBaseline {
    fn unavailable(
        reference: &str,
        revision: Option<String>,
        code: &str,
        message: impl Into<String>,
    ) -> Self {
        Self {
            status: "unavailable".into(),
            reference: reference.into(),
            revision,
            message: Some(message.into()),
            code: Some(code.into()),
            projection: None,
        }
    }
}
async fn limited(reader: impl AsyncRead + Unpin, limit: usize) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|e| e.to_string())?;
    if bytes.len() > limit {
        return Err("Git object output exceeds the review budget".into());
    }
    Ok(bytes)
}
async fn git(cwd: &Path, args: &[&str], limit: usize) -> Result<Vec<u8>> {
    let mut command = Command::new("git");
    command
        .args(["--no-pager", "--literal-pathspecs"])
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // The config selects the repository. Inherited Git redirects and replacement
    // objects must not turn an exact revision into a different object namespace.
    for (key, _) in std::env::vars_os() {
        if key.to_string_lossy().starts_with("GIT_") {
            command.env_remove(key);
        }
    }
    command
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_NO_REPLACE_OBJECTS", "1")
        .env("GIT_NO_LAZY_FETCH", "1")
        .env("GIT_ALLOW_PROTOCOL", "");
    let mut child = command
        .spawn()
        .map_err(|e| format!("Git unavailable: {e}"))?;
    let stdout = child.stdout.take().ok_or("Git stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("Git stderr unavailable")?;
    let outcome = tokio::time::timeout(Duration::from_secs(15), async {
        tokio::try_join!(limited(stdout, limit), limited(stderr, 64 * 1024), async {
            child.wait().await.map_err(|e| e.to_string())
        })
    })
    .await;
    match outcome {
        Ok(Ok((stdout, _stderr, status))) if status.success() => Ok(stdout),
        Ok(Ok((_, stderr, _))) => Err(format!(
            "Git failed: {}",
            String::from_utf8_lossy(&stderr).trim()
        )),
        failure => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            Err(match failure {
                Ok(Err(error)) => error,
                _ => "Git read timed out".into(),
            })
        }
    }
}
fn text(bytes: Vec<u8>) -> Result<String> {
    String::from_utf8(bytes)
        .map(|s| s.trim().to_owned())
        .map_err(|_| "Git returned a non-UTF-8 path or object identity".into())
}
fn hex_object(value: &str) -> bool {
    (value.len() == 40 || value.len() == 64)
        && value
            .bytes()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

pub async fn read_baseline(config: &Config, audience: &str, reference: &str) -> GitBaseline {
    if reference.trim().is_empty()
        || reference.len() > 1024
        || reference.contains(['\0', '\r', '\n'])
    {
        return GitBaseline::unavailable(
            reference,
            None,
            "unknown-revision",
            "Invalid Git revision",
        );
    }
    match tokio::time::timeout(
        Duration::from_secs(30),
        read_inner(config, audience, reference),
    )
    .await
    {
        Ok(value) => value,
        Err(_) => GitBaseline::unavailable(
            reference,
            None,
            "unavailable-history",
            "Git review exceeded its 30 second read budget",
        ),
    }
}
async fn read_inner(config: &Config, audience: &str, reference: &str) -> GitBaseline {
    let cwd = config.git.root.as_deref().unwrap_or(&config.root);
    let root = match git(cwd, &["rev-parse", "--show-toplevel"], 64 * 1024)
        .await
        .and_then(text)
    {
        Ok(root) => std::path::PathBuf::from(root),
        Err(_) => {
            return GitBaseline::unavailable(
                reference,
                None,
                "no-git",
                "Git review is unavailable outside a Git repository.",
            );
        }
    };
    let snapshot = config.snapshots.join(audience);
    let Ok(relative) = snapshot.strip_prefix(&root) else {
        return GitBaseline::unavailable(
            reference,
            None,
            "invalid-path",
            "Configured snapshots must be inside the selected Git repository.",
        );
    };
    let expression = format!("{reference}^{{commit}}");
    let revision = match git(
        &root,
        &["rev-parse", "--verify", "--end-of-options", &expression],
        64 * 1024,
    )
    .await
    .and_then(text)
    {
        Ok(value) if hex_object(&value) => value,
        _ => {
            return GitBaseline::unavailable(
                reference,
                None,
                "unknown-revision",
                format!("Git revision is unknown or unavailable: {reference}"),
            );
        }
    };
    let Some(relative) = relative.to_str() else {
        return GitBaseline::unavailable(
            reference,
            Some(revision),
            "invalid-path",
            "Snapshot path is not UTF-8",
        );
    };
    let prefix = format!("{}/", relative.replace('\\', "/"));
    let result = read_snapshot(&root, &revision, &prefix, audience).await;
    match result {
        Ok(Some(projection)) => GitBaseline {
            status: "available".into(),
            reference: reference.into(),
            revision: Some(revision),
            message: None,
            code: None,
            projection: Some(projection),
        },
        Ok(None) => GitBaseline::unavailable(
            reference,
            Some(revision),
            "missing-snapshot",
            "No recorded docs at this revision.",
        ),
        Err(error) => GitBaseline::unavailable(
            reference,
            Some(revision),
            "invalid-snapshot",
            format!("Cannot compare this recorded snapshot: {error}"),
        ),
    }
}
async fn read_snapshot(
    root: &Path,
    revision: &str,
    prefix: &str,
    audience: &str,
) -> Result<Option<Projection>> {
    let inventory = git(
        root,
        &["ls-tree", "-r", "-z", "--full-tree", revision, "--", prefix],
        MAX_BLOB,
    )
    .await?;
    if inventory.is_empty() {
        return Ok(None);
    }
    let mut files = Files::new();
    let mut total = 0;
    for record in inventory.split(|b| *b == 0).filter(|r| !r.is_empty()) {
        if files.len() >= 10000 {
            return Err("Historical snapshot exceeds the v1 10000 artifact review budget".into());
        }
        let line = std::str::from_utf8(record).map_err(|_| "Non-UTF-8 historical artifact path")?;
        let (metadata, path) = line.split_once('\t').ok_or("Invalid Git tree entry")?;
        let fields: Vec<_> = metadata.split(' ').collect();
        if fields.len() != 3
            || !matches!(fields[0], "100644" | "100755")
            || fields[1] != "blob"
            || !hex_object(fields[2])
        {
            return Err("Historical snapshot contains a symlink or unsupported object".into());
        }
        let key = path
            .strip_prefix(prefix)
            .ok_or("Git returned a path outside the snapshot")?;
        if key.is_empty()
            || key.contains('\\')
            || key
                .split('/')
                .any(|p| p.is_empty() || p == "." || p == "..")
        {
            return Err("Unsafe historical artifact path".into());
        }
        let content = git(root, &["cat-file", "blob", fields[2]], MAX_BLOB).await?;
        if content.starts_with(b"version https://git-lfs.github.com/spec/v1") {
            return Err(format!(
                "Unhydrated Git LFS pointer: {key}. Fetching LFS content is not automatic."
            ));
        }
        total += content.len();
        if total > MAX_SNAPSHOT {
            return Err("Historical snapshot exceeds the v1 256 MiB review budget".into());
        }
        if files.insert(key.into(), content).is_some() {
            return Err("Duplicate historical artifact path".into());
        }
    }
    let clean = lgtmd::lifecycle::strip_ownership(&files)?;
    let projection = tokio::task::spawn_blocking(move || site::validate(&clean))
        .await
        .map_err(|e| e.to_string())??;
    if projection.bundle.audience != audience {
        return Err("Historical snapshot audience mismatch".into());
    }
    Ok(Some(projection))
}
