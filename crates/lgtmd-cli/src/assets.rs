//! Embedded presentation assets and the browser's audience-filtered wire state.
use lgtmd::{
    Result,
    lifecycle::Files,
    site::{Bundle, Projection},
};
use serde::Serialize;
use serde_json::Value;

pub const THEME_CSS_PATH: &str = "lgtmd-theme.css";

include!(concat!(env!("OUT_DIR"), "/viewer_assets.rs"));

#[derive(Clone, Debug, Serialize)]
pub struct RunState {
    pub status: String,
    pub retained: bool,
    pub stale: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineState {
    pub status: String,
    #[serde(rename = "ref")]
    pub reference: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle: Option<Bundle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_base: Option<String>,
}
impl BaselineState {
    pub fn loading(reference: String) -> Self {
        Self {
            status: "loading".into(),
            reference,
            revision: None,
            message: None,
            bundle: None,
            resource_base: None,
        }
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteState {
    pub mode: String,
    pub title: String,
    pub audience: String,
    pub run: RunState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidate_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<Bundle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_resource_base: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub baseline: Option<BaselineState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comparison: Option<Value>,
    pub can_run: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

pub fn viewer_assets() -> Result<Files> {
    let files = embedded_viewer_assets();
    if !files.contains_key("index.html") || !files.contains_key("manifest.json") {
        return Err("Bundled docs frontend is missing its entry or manifest".into());
    }
    Ok(files)
}
pub fn boot_html(html: &[u8], mode: &str, base_path: &str, theme: bool) -> Result<Vec<u8>> {
    let data = serde_json::to_string(&serde_json::json!({
        "mode": mode,
        "basePath": base_path,
        "dataUrl": format!("{base_path}{}", if mode == "dev" {"__lgtmd/state"} else {"site.json"}),
    }))
    .map_err(|e| e.to_string())?
    .replace('<', "\\u003c");
    let script = format!("<script>window.__LGTMD__={data}</script>");
    let source =
        std::str::from_utf8(html).map_err(|e| format!("Bundled frontend is not UTF-8: {e}"))?;
    if !source.contains("<!-- LGTMD_BOOT -->") {
        return Err("Bundled frontend is missing its boot placeholder".into());
    }
    let mut html = source.replacen("<!-- LGTMD_BOOT -->", &script, 1);
    if theme {
        if !html.contains("</head>") {
            return Err("Bundled frontend is missing its head closing tag".into());
        }
        let href = format!("{base_path}{THEME_CSS_PATH}")
            .replace('&', "&amp;")
            .replace('"', "&quot;")
            .replace('<', "&lt;")
            .replace('>', "&gt;");
        // Loaded after compiled Tailwind assets. Users can override tokens and
        // documented hooks with ordinary, unlayered CSS, without a frontend build.
        html = html.replacen(
            "</head>",
            &format!("<link rel=\"stylesheet\" href=\"{href}\" data-lgtmd-theme>\n</head>"),
            1,
        );
    }
    Ok(html.into_bytes())
}
pub fn static_files(
    projection: &Projection,
    base_path: &str,
    theme_css: Option<&[u8]>,
) -> Result<Files> {
    let state = SiteState {
        mode: "static".into(),
        title: projection.bundle.title.clone(),
        audience: projection.bundle.audience.clone(),
        run: RunState {
            status: "succeeded".into(),
            retained: true,
            stale: false,
            message: None,
        },
        candidate_id: None,
        current: Some(projection.bundle.clone()),
        current_resource_base: Some(base_path.into()),
        baseline: None,
        comparison: None,
        can_run: false,
        token: None,
    };
    let mut files = projection.files.clone();
    for (path, bytes) in viewer_assets()? {
        if files.insert(path.clone(), bytes).is_some() {
            return Err(format!(
                "Viewer asset collides with documentation artifact: {path}"
            ));
        }
    }
    if let Some(bytes) = theme_css
        && files
            .insert(THEME_CSS_PATH.into(), bytes.to_vec())
            .is_some()
    {
        return Err(format!(
            "Theme stylesheet collides with a site artifact: {THEME_CSS_PATH}"
        ));
    }
    if files.contains_key("site.json") {
        return Err("Documentation artifact collides with site.json".into());
    }
    let html = boot_html(
        files
            .get("index.html")
            .ok_or("Bundled viewer index.html is missing")?,
        "static",
        base_path,
        theme_css.is_some(),
    )?;
    files.insert("index.html".into(), html);
    files.insert(
        "site.json".into(),
        serde_json::to_vec(&state).map_err(|e| e.to_string())?,
    );
    Ok(files)
}
pub fn mime(path: &str) -> &'static str {
    match path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "png" => "image/png",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "woff2" => "font/woff2",
        "txt" => "text/plain; charset=utf-8",
        "md" => "text/markdown; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bootstrap_escapes_script_delimiters_and_keeps_subpath() {
        let bytes = boot_html(
            b"<html><!-- LGTMD_BOOT --></html>",
            "static",
            "/docs/</script>",
            false,
        )
        .unwrap();
        let text = String::from_utf8(bytes).unwrap();
        assert_eq!(text.matches("</script>").count(), 1);
        assert!(text.contains("\\u003c/script>"));
        assert!(text.contains("site.json"));
    }
    #[test]
    fn theme_link_is_after_compiled_css_and_escaped() {
        let html = String::from_utf8(boot_html(
            b"<html><head><link rel=\"stylesheet\" href=\"app.css\"></head><body><!-- LGTMD_BOOT --></body></html>",
            "dev", "/docs/", true).unwrap()).unwrap();
        assert!(html.find("app.css").unwrap() < html.find("lgtmd-theme.css").unwrap());
        assert!(html.contains("href=\"/docs/lgtmd-theme.css\" data-lgtmd-theme"));
        let escaped = String::from_utf8(
            boot_html(b"<head></head><!-- LGTMD_BOOT -->", "dev", "/\"<>&/", true).unwrap(),
        )
        .unwrap();
        assert!(escaped.contains("href=\"/&quot;&lt;&gt;&amp;/lgtmd-theme.css\""));
    }
    #[test]
    fn static_theme_is_owned_without_changing_the_evidence_bundle() {
        use lgtmd::{
            Doc,
            site::{
                self,
                store::{self, StoreKind},
            },
            transport::Input,
        };
        let mut doc = Doc::new("intro", "Introduction").unwrap();
        doc.paragraph("Welcome").unwrap();
        let compiled = site::compile(
            &Input::from_documents(&[doc.finish().unwrap()]).unwrap(),
            "Example",
            None,
        )
        .unwrap();
        let plain = static_files(&compiled.reader, "/docs/", None).unwrap();
        let themed =
            static_files(&compiled.reader, "/docs/", Some(b":root { color: red; }")).unwrap();
        assert_eq!(plain["bundle.json"], themed["bundle.json"]);
        assert_eq!(plain["site.json"], themed["site.json"]);
        assert!(!plain.contains_key(THEME_CSS_PATH));
        assert_eq!(themed[THEME_CSS_PATH], b":root { color: red; }");
        let dir = tempfile::tempdir().unwrap();
        let published = store::publish(
            "build",
            &std::fs::canonicalize(dir.path()).unwrap().join("site"),
            &themed,
            StoreKind::Static,
        )
        .unwrap();
        let validated = store::validate_files(&published, StoreKind::Static).unwrap();
        assert_eq!(
            validated.bundle.unwrap().digest,
            compiled.reader.bundle.digest
        );
        let mut collision = compiled.reader.clone();
        collision.files.insert(THEME_CSS_PATH.into(), vec![]);
        assert!(
            static_files(&collision, "/docs/", Some(b"body {}"))
                .unwrap_err()
                .contains("collides")
        );
    }
    #[test]
    fn built_frontend_is_embedded_without_node_or_runtime_paths() {
        let files = viewer_assets().unwrap();
        let manifest: Value = serde_json::from_slice(&files["manifest.json"]).unwrap();
        let main = manifest["index.html"]["file"].as_str().unwrap();
        assert!(files.contains_key(main));
        for field in ["css", "assets"] {
            for item in manifest["index.html"][field].as_array().unwrap() {
                assert!(files.contains_key(item.as_str().unwrap()));
            }
        }
    }
}
