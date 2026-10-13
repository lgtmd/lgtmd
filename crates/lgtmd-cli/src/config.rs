//! Passive, topology-independent CLI configuration and output preflight.
use lgtmd::{Result, lifecycle, site};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    fs,
    path::{Component, Path, PathBuf},
};

#[derive(Clone, Debug, Serialize)]
pub struct FlowConfig {
    pub command: Option<Vec<String>>,
    pub cwd: PathBuf,
    pub watch: Vec<PathBuf>,
    pub timeout_ms: u64,
}
#[derive(Clone, Debug, Serialize)]
pub struct GitConfig {
    pub base: String,
    pub root: Option<PathBuf>,
}
#[derive(Clone, Debug)]
pub struct Config {
    pub path: PathBuf,
    pub root: PathBuf,
    pub title: String,
    pub flow: FlowConfig,
    pub snapshots: PathBuf,
    pub cache_dir: PathBuf,
    pub out_dir: PathBuf,
    pub base_path: String,
    pub navigation: Option<Vec<String>>,
    pub git: GitConfig,
    /// Presentation-only input; excluded from candidate and configuration identity.
    pub theme_css: Option<PathBuf>,
    pub key: String,
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawConfig {
    schema_version: Option<u32>,
    title: Option<String>,
    flow: Option<RawFlow>,
    snapshots: Option<String>,
    cache_dir: Option<String>,
    out_dir: Option<String>,
    base_path: Option<String>,
    navigation: Option<Vec<String>>,
    git: Option<RawGit>,
    theme: Option<RawTheme>,
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawFlow {
    command: Option<Vec<String>>,
    cwd: Option<String>,
    watch: Option<Vec<String>>,
    timeout_ms: Option<u64>,
}
#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawGit {
    base: Option<String>,
    root: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawTheme {
    css: String,
}

pub fn inside(parent: &Path, path: &Path) -> bool {
    path.starts_with(parent)
}
fn text(value: Option<String>, default: &str, name: &str) -> Result<String> {
    let value = value.unwrap_or_else(|| default.into());
    if value.trim().is_empty() || value.chars().any(|c| matches!(c, '\0' | '\r' | '\n')) {
        return Err(format!("{name} must be nonempty single-line text"));
    }
    Ok(value)
}
pub fn absolute_path(base: &Path, value: &Path) -> PathBuf {
    let joined = if value.is_absolute() {
        value.to_owned()
    } else {
        base.join(value)
    };
    let mut path = PathBuf::new();
    for part in joined.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                path.pop();
            }
            other => path.push(other.as_os_str()),
        }
    }
    path
}
/// Explicit sibling directories are supported; symlink output components are not.
pub fn safe_path(base: &Path, value: &Path) -> Result<PathBuf> {
    let requested = absolute_path(base, value);
    let mut path = PathBuf::new();
    for part in requested.components() {
        path.push(part.as_os_str());
        match fs::symlink_metadata(&path) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(format!(
                    "Symlink is not allowed in an output path: {}",
                    path.display()
                ));
            }
            Ok(_) => {
                path = fs::canonicalize(&path)
                    .map_err(|e| format!("Resolve {}: {e}", path.display()))?
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Inspect {}: {error}", path.display())),
        }
    }
    Ok(path)
}
fn existing_or_absolute(base: &Path, value: &Path) -> Result<PathBuf> {
    let path = absolute_path(base, value);
    match fs::canonicalize(&path) {
        Ok(path) => Ok(path),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(path),
        Err(e) => Err(e.to_string()),
    }
}
fn namespaces(path: &Path) -> Vec<PathBuf> {
    let parent = path.parent().unwrap_or(Path::new("/"));
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let mut all = vec![path.to_owned()];
    all.extend(
        ["lock", "staging", "backup"].map(|suffix| parent.join(format!(".{name}.{suffix}"))),
    );
    all
}
fn reject_nulls(value: &serde_json::Value, name: &str) -> Result<()> {
    if let serde_json::Value::Object(fields) = value {
        for (key, value) in fields {
            if value.is_null() {
                return Err(format!("{name}.{key} cannot be null"));
            }
            reject_nulls(value, &format!("{name}.{key}"))?;
        }
    }
    Ok(())
}
pub fn load_config(file: Option<&Path>, require_flow: bool) -> Result<Config> {
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let file = absolute_path(&cwd, file.unwrap_or(Path::new("lgtmd.config.json")));
    let path = fs::canonicalize(&file)
        .map_err(|e| format!("Read configuration {}: {e}", file.display()))?;
    let root = path
        .parent()
        .ok_or("Configuration has no parent")?
        .to_owned();
    let value: serde_json::Value =
        serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
            .map_err(|e| format!("Invalid configuration: {e}"))?;
    reject_nulls(&value, "configuration")?;
    let raw: RawConfig =
        serde_json::from_value(value).map_err(|e| format!("Invalid configuration: {e}"))?;
    if raw.schema_version.unwrap_or(1) != 1 {
        return Err("Unsupported config schemaVersion; expected 1".into());
    }
    let flow = raw.flow.unwrap_or_default();
    let git = raw.git.unwrap_or_default();
    if (require_flow && flow.command.is_none())
        || flow
            .command
            .as_ref()
            .is_some_and(|v| v.is_empty() || v.iter().any(|s| s.is_empty() || s.contains('\0')))
    {
        return Err("flow.command must be a nonempty argv array".into());
    }
    let timeout_ms = flow.timeout_ms.unwrap_or(600_000);
    if timeout_ms == 0 || timeout_ms > 9_007_199_254_740_991 {
        return Err("flow.timeoutMs must be a positive safely represented integer".into());
    }
    let base_path = text(raw.base_path, "/", "basePath")?;
    if !base_path.starts_with('/')
        || !base_path.ends_with('/')
        || base_path != "/"
            && base_path[1..base_path.len() - 1].split('/').any(|p| {
                p.is_empty()
                    || p == "."
                    || p == ".."
                    || !p
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || b"._~-".contains(&c))
            })
    {
        return Err("basePath must be / or a safe absolute path ending in /".into());
    }
    if let Some(nav) = &raw.navigation
        && (nav.iter().any(|s| s.is_empty() || s.contains('\0'))
            || nav.iter().collect::<BTreeSet<_>>().len() != nav.len())
    {
        return Err("Invalid or duplicate navigation page ID".into());
    }
    let snapshots = safe_path(
        &root,
        Path::new(&text(raw.snapshots, "docs/snapshots", "snapshots")?),
    )?;
    let cache_dir = safe_path(
        &root,
        Path::new(&text(raw.cache_dir, ".cache/lgtmd", "cacheDir")?),
    )?;
    let out_dir = safe_path(
        &root,
        Path::new(&text(raw.out_dir, "build/docs", "outDir")?),
    )?;
    let paths = [&snapshots, &cache_dir, &out_dir];
    for output in paths {
        if inside(output, &root) {
            return Err(
                "An output cannot replace the configuration/source root or its ancestor".into(),
            );
        }
        if output
            .components()
            .any(|p| p.as_os_str() == ".git" || p.as_os_str() == "node_modules")
        {
            return Err("Outputs cannot replace Git or dependencies".into());
        }
    }
    for i in 0..paths.len() {
        for b in &paths[i + 1..] {
            for x in namespaces(paths[i]) {
                for y in namespaces(b) {
                    lifecycle::ensure_separate_paths(&x, &y).map_err(|e| {
                        format!(
                            "Output, cache, snapshot and transaction paths must not overlap: {e}"
                        )
                    })?;
                }
            }
        }
    }
    // Resolve without opening the input. Preview uses frozen output, and exact
    // snapshot checks do not depend on a presentation file being present.
    let theme_css = raw
        .theme
        .map(|theme| {
            text(Some(theme.css), "", "theme.css")
                .map(|path| absolute_path(&root, Path::new(&path)))
        })
        .transpose()?;
    if let Some(input) = &theme_css {
        for output in paths {
            for namespace in namespaces(output) {
                if inside(&namespace, input) || inside(input, &namespace) {
                    return Err("theme.css must be separate from output, cache, snapshot and transaction paths".into());
                }
            }
        }
    }
    let configured_cwd = text(flow.cwd, ".", "flow.cwd")?;
    let flow_cwd = existing_or_absolute(&root, Path::new(&configured_cwd))?;
    if require_flow && !fs::metadata(&flow_cwd).is_ok_and(|m| m.is_dir()) {
        return Err("flow.cwd must be an existing directory".into());
    }
    if paths.iter().any(|output| inside(output, &flow_cwd)) {
        return Err("An output cannot replace the flow working directory or its ancestor".into());
    }
    let watch = flow
        .watch
        .unwrap_or_default()
        .into_iter()
        .map(|p| {
            text(Some(p), "", "flow.watch entry")
                .and_then(|p| existing_or_absolute(&root, Path::new(&p)))
        })
        .collect::<Result<Vec<_>>>()?;
    for input in watch.iter().chain(std::iter::once(&path)) {
        if paths.iter().any(|output| inside(output, input)) {
            return Err("Authoring inputs must not be inside generated output directories".into());
        }
    }
    let flow = FlowConfig {
        command: flow.command,
        cwd: flow_cwd,
        watch,
        timeout_ms,
    };
    let git = GitConfig {
        base: text(git.base, "HEAD", "git.base")?,
        root: git
            .root
            .map(|p| {
                text(Some(p), "", "git.root").and_then(|p| {
                    fs::canonicalize(absolute_path(&root, Path::new(&p))).map_err(|e| e.to_string())
                })
            })
            .transpose()?,
    };
    let title = text(raw.title, "Documentation", "title")?;
    let normalized = serde_json::json!({"title":title,"flow":flow,"snapshots":snapshots,"cacheDir":cache_dir,"outDir":out_dir,"basePath":base_path,"navigation":raw.navigation,"git":git});
    let mut identity = path
        .to_str()
        .ok_or("Non UTF-8 config path")?
        .as_bytes()
        .to_vec();
    identity.push(0);
    identity.extend(site::canonical(&normalized)?);
    Ok(Config {
        path,
        root,
        title,
        flow,
        snapshots,
        cache_dir,
        out_dir,
        base_path,
        navigation: raw.navigation,
        git,
        theme_css,
        key: site::sha256(&identity),
    })
}
/// Read exactly the configured stylesheet, never its directory or dependencies.
/// Recheck the path on every read so replacing a file with a symlink cannot expose
/// another local file through the dev server. CSS syntax is interpreted by browsers.
pub fn read_theme_css(config: &Config) -> Result<Option<Vec<u8>>> {
    let Some(requested) = &config.theme_css else {
        return Ok(None);
    };
    let path = safe_path(&config.root, requested).map_err(|e| format!("Read theme.css: {e}"))?;
    let metadata =
        fs::metadata(&path).map_err(|e| format!("Read theme.css {}: {e}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!(
            "theme.css must be a regular UTF-8 file: {}",
            path.display()
        ));
    }
    let bytes = fs::read(&path).map_err(|e| format!("Read theme.css {}: {e}", path.display()))?;
    std::str::from_utf8(&bytes).map_err(|e| format!("theme.css must be UTF-8: {e}"))?;
    Ok(Some(bytes))
}
pub fn ignored_watch_path(config: &Config, path: &Path) -> bool {
    config.theme_css.as_deref() == Some(path)
        || [&config.cache_dir, &config.out_dir, &config.snapshots]
            .iter()
            .any(|p| {
                namespaces(p)
                    .iter()
                    .any(|generated| inside(generated, path))
            })
        || path.components().any(|p| {
            [".git", "node_modules", "target", ".cache"]
                .iter()
                .any(|name| p.as_os_str() == *name)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(json: serde_json::Value) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("lgtmd.config.json");
        fs::write(&path, serde_json::to_vec(&json).unwrap()).unwrap();
        (dir, path)
    }
    #[test]
    fn rejects_unknown_overlaps_and_transaction_aliases() {
        for value in [
            serde_json::json!({"extra":true}),
            serde_json::json!({"snapshots":"build","outDir":"build/docs"}),
            serde_json::json!({"snapshots":"snaps","outDir":".snaps.backup"}),
            serde_json::json!({"outDir":"."}),
            serde_json::json!({"flow":null}),
        ] {
            let (_dir, path) = fixture(value);
            assert!(load_config(Some(&path), false).is_err());
        }
    }
    #[test]
    fn allows_sibling_layout_and_stable_missing_watch_inputs() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("docs")).unwrap();
        let path = dir.path().join("docs/lgtmd.config.json");
        fs::write(&path, r#"{"flow":{"command":["true"],"cwd":"..","watch":["../source.rs"]},"snapshots":"../records","cacheDir":"../cache","outDir":"../public/docs"}"#).unwrap();
        let a = load_config(Some(&path), true).unwrap();
        assert_eq!(a.snapshots.file_name().unwrap(), "records");
        assert_eq!(a.key, load_config(Some(&path), false).unwrap().key);
    }
    #[test]
    fn theme_is_presentation_only_and_missing_input_does_not_block_config() {
        let (dir, path) = fixture(serde_json::json!({"flow":{"watch":["."]}}));
        let plain = load_config(Some(&path), false).unwrap();
        fs::write(
            &path,
            r#"{"flow":{"watch":["."]},"theme":{"css":"brand.css"}}"#,
        )
        .unwrap();
        let themed = load_config(Some(&path), false).unwrap();
        assert_eq!(plain.key, themed.key);
        let css = dir.path().join("brand.css");
        assert!(read_theme_css(&themed).unwrap_err().contains("theme.css"));
        fs::write(&css, ":root { --lgtmd-accent: purple; }").unwrap();
        assert_eq!(themed.key, load_config(Some(&path), false).unwrap().key);
        let first = crate::flow::watch_fingerprint(&themed).unwrap();
        assert!(ignored_watch_path(
            &themed,
            themed.theme_css.as_deref().unwrap()
        ));
        fs::write(&css, ":root { --lgtmd-accent: blue; }").unwrap();
        assert_eq!(first, crate::flow::watch_fingerprint(&themed).unwrap());
        assert_eq!(
            read_theme_css(&themed).unwrap().unwrap(),
            b":root { --lgtmd-accent: blue; }"
        );
        fs::write(
            &path,
            r#"{"flow":{"watch":["."]},"theme":{"css":"other.css"}}"#,
        )
        .unwrap();
        assert_eq!(plain.key, load_config(Some(&path), false).unwrap().key);
    }
    #[test]
    fn theme_rejects_unknown_options_non_files_non_utf8_and_output_aliases() {
        for theme in [
            serde_json::json!({}),
            serde_json::json!({"css":"brand.css", "extra":true}),
            serde_json::json!({"css":""}),
            serde_json::json!({"css":"build/docs/brand.css"}),
            serde_json::json!({"css":"build/.docs.backup/brand.css"}),
            serde_json::json!({"css":"docs/.snapshots.staging/brand.css"}),
            serde_json::json!({"css":".cache/lgtmd/brand.css"}),
        ] {
            let (_dir, path) = fixture(serde_json::json!({"theme":theme}));
            assert!(load_config(Some(&path), false).is_err(), "{theme}");
        }
        let (dir, path) = fixture(serde_json::json!({"theme":{"css":"brand.css"}}));
        let config = load_config(Some(&path), false).unwrap();
        fs::create_dir(dir.path().join("brand.css")).unwrap();
        assert!(
            read_theme_css(&config)
                .unwrap_err()
                .contains("regular UTF-8 file")
        );
        fs::remove_dir(dir.path().join("brand.css")).unwrap();
        fs::write(dir.path().join("brand.css"), [255]).unwrap();
        assert!(read_theme_css(&config).unwrap_err().contains("UTF-8"));
    }
    #[cfg(unix)]
    #[test]
    fn theme_rechecks_symlinks_on_every_read_and_keeps_explicit_sibling_support() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("site")).unwrap();
        let path = dir.path().join("site/lgtmd.config.json");
        fs::write(&path, r#"{"theme":{"css":"../brand.css"}}"#).unwrap();
        fs::write(dir.path().join("brand.css"), "body {} ").unwrap();
        let config = load_config(Some(&path), false).unwrap();
        assert_eq!(read_theme_css(&config).unwrap().unwrap(), b"body {} ");
        fs::remove_file(dir.path().join("brand.css")).unwrap();
        std::os::unix::fs::symlink(&path, dir.path().join("brand.css")).unwrap();
        assert!(read_theme_css(&config).unwrap_err().contains("Symlink"));
        // Exact evidence operations still do not need this presentation input.
        assert_eq!(config.key, load_config(Some(&path), false).unwrap().key);
    }
    #[cfg(unix)]
    #[test]
    fn refuses_symlink_outputs() {
        let (dir, path) = fixture(serde_json::json!({"outDir":"alias/docs"}));
        fs::create_dir(dir.path().join("other")).unwrap();
        std::os::unix::fs::symlink(dir.path().join("other"), dir.path().join("alias")).unwrap();
        assert!(
            load_config(Some(&path), false)
                .unwrap_err()
                .contains("Symlink")
        );
    }
}
