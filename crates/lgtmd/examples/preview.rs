//! Disposable static rendering for human review, separate from guide generation.
use lgtmd::{
    Result,
    lifecycle::{self, Files, Ownership},
};
use pulldown_cmark::{Event, Options, Parser, Tag, html};
use std::{
    collections::{BTreeMap, BTreeSet},
    env,
    path::Path,
};

fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    if args.len() != 2 {
        return Err("Usage: preview EXPORT_DIRECTORY NEW_PREVIEW_DIRECTORY".into());
    }
    let destination = Path::new(&args[1]);
    preview(Path::new(&args[0]), destination)?;
    println!("Preview: {}", destination.display());
    Ok(())
}

fn preview(source: &Path, destination: &Path) -> Result<()> {
    let source = source.canonicalize().map_err(|error| error.to_string())?;
    let destination = lifecycle::absolute(destination)?;
    lifecycle::ensure_separate_paths(&source, &destination)?;
    if !source.is_dir() {
        return Err("Preview source must be an exported directory".into());
    }
    if destination.exists() {
        return Err("Preview destination must be new; preserve earlier review evidence".into());
    }
    let mut files = lifecycle::read_tree(&source)?;
    files.remove(".ownership.json");
    // Validate the complete tree before rendering. In particular, a private or
    // unrecorded file added to a Reader export must never become a preview asset.
    lgtmd::store::check(&source, &files)?;
    let output = preview_files(&files)?;
    lifecycle::build(&destination, &output, Ownership::Dedicated)
}

fn preview_link(destination: &str, page: &str, pages: &BTreeMap<String, String>) -> Result<String> {
    if destination.contains(':') || destination.starts_with("//") {
        return Ok(destination.to_owned());
    }
    let (path, fragment) = destination
        .split_once('#')
        .map_or((destination, None), |(path, fragment)| {
            (path, Some(fragment))
        });
    if path.is_empty() {
        return Ok(destination.to_owned());
    }
    let decoded = decode_path(path)?;
    let mut target: Vec<_> = page.split('/').collect();
    target.pop();
    for part in decoded.split('/') {
        match part {
            "." => {}
            ".." => {
                target
                    .pop()
                    .ok_or_else(|| format!("Preview link escapes export: {destination}"))?;
            }
            _ => target.push(part),
        }
    }
    let Some(output) = pages.get(&target.join("/")) else {
        return Ok(destination.to_owned());
    };
    let mut directory: Vec<_> = pages[page].split('/').collect();
    directory.pop();
    let output: Vec<_> = output.split('/').collect();
    let common = directory
        .iter()
        .zip(&output)
        .take_while(|(left, right)| left == right)
        .count();
    let relative = std::iter::repeat_n("..", directory.len() - common)
        .chain(output[common..].iter().copied())
        .collect::<Vec<_>>()
        .join("/");
    let mut link: String = relative
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || b"/-._~".contains(&byte) {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect();
    if let Some(fragment) = fragment {
        link.push('#');
        link.push_str(fragment);
    }
    Ok(link)
}

fn decode_path(path: &str) -> Result<String> {
    let mut bytes = Vec::new();
    let mut position = 0;
    while position < path.len() {
        if path.as_bytes()[position] == b'%' {
            let escape = path
                .get(position + 1..position + 3)
                .ok_or_else(|| format!("Malformed preview link escape: {path}"))?;
            bytes.push(
                u8::from_str_radix(escape, 16)
                    .map_err(|_| format!("Malformed preview link escape: {path}"))?,
            );
            position += 3;
        } else {
            bytes.push(path.as_bytes()[position]);
            position += 1;
        }
    }
    String::from_utf8(bytes).map_err(|_| format!("Preview link is not UTF-8: {path}"))
}

fn preview_files(files: &Files) -> Result<Files> {
    let manifest: serde_json::Value =
        serde_json::from_slice(&files["manifest.json"]).map_err(|error| error.to_string())?;
    let artifacts = manifest["artifacts"]
        .as_array()
        .ok_or("Manifest artifacts must be an array")?;
    // The store already owns schema validation. This review tool only needs the
    // inventory's page identities; extensions say nothing about artifact kind.
    let pages: BTreeMap<_, _> = artifacts
        .iter()
        .filter(|artifact| artifact["kind"] == "page")
        .map(|artifact| {
            let path = artifact["path"]
                .as_str()
                .ok_or("Manifest artifact requires a path")?;
            let output = Path::new(path).with_extension("html");
            Ok((
                path.to_owned(),
                output.to_str().ok_or("Non UTF-8 preview path")?.to_owned(),
            ))
        })
        .collect::<Result<_>>()?;
    let mut paths = BTreeSet::new();
    for path in files.keys().filter(|path| path.as_str() != "manifest.json") {
        let output = pages.get(path).unwrap_or(path);
        if paths.iter().any(|existing: &String| {
            existing == output
                || output.starts_with(&format!("{existing}/"))
                || existing.starts_with(&format!("{output}/"))
        }) {
            return Err(format!("Preview output collision: {output}"));
        }
        paths.insert(output.to_owned());
    }
    let mut output = Files::new();
    for (path, bytes) in files
        .iter()
        .filter(|(path, _)| path.as_str() != "manifest.json")
    {
        let Some(output_path) = pages.get(path) else {
            output.insert(path.clone(), bytes.clone());
            continue;
        };
        let source =
            std::str::from_utf8(bytes).map_err(|error| format!("Preview page {path}: {error}"))?;
        let parser = Parser::new_ext(
            source,
            Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH,
        )
        .map(|event| match event {
            Event::Start(Tag::Link {
                link_type,
                dest_url,
                title,
                id,
            }) => Ok(Event::Start(Tag::Link {
                link_type,
                dest_url: preview_link(&dest_url, path, &pages)?.into(),
                title,
                id,
            })),
            other => Ok(other),
        })
        .collect::<Result<Vec<_>>>()?;
        let mut body = String::new();
        html::push_html(&mut body, parser.into_iter());
        output.insert(output_path.clone(), format!(
            "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Executable documentation review</title><style>{STYLE}</style><main>{body}</main></html>"
        ).into_bytes());
    }
    Ok(output)
}

const STYLE: &str = r#"
html { color-scheme: light; background: #f5f6f8; color: #17212b; }
body { margin: 0; font: 17px/1.65 -apple-system, BlinkMacSystemFont, sans-serif; }
main { max-width: 800px; margin: 42px auto; padding: 36px 48px; background: white; border: 1px solid #dde2e7; border-radius: 12px; }
h1, h2, h3 { line-height: 1.2; color: #0b243c; } h1 { font-size: 34px; } h2 { margin-top: 38px; }
a { color: #005d9f; } code { font: 0.88em/1.5 ui-monospace, monospace; background: #f1f3f6; padding: 2px 5px; border-radius: 3px; }
pre { overflow: auto; padding: 18px; border: 1px solid #dce3e9; border-radius: 6px; background: #f7f9fb; } pre code { padding: 0; background: transparent; }
blockquote { margin: 24px 0; border-left: 4px solid #ae7c19; background: #fff8e6; padding: 8px 20px; }
img { max-width: 100%; } table { border-collapse: collapse; width: 100%; } th, td { text-align: left; border: 1px solid #dce3e9; padding: 8px; }
@media(max-width: 700px) { main { margin: 0; padding: 22px; border: 0; } }
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use lgtmd::{Artifact, Audience, Doc, Document, ExportLayout};
    use std::fs;

    fn doc(id: &str) -> Doc {
        let mut doc = Doc::new(id, id).unwrap();
        doc.require("executed", true).unwrap();
        doc
    }

    fn text(bytes: &[u8], extension: &str) -> Artifact {
        Artifact::new(bytes, "text/plain", extension, "preview-test", "v1").unwrap()
    }

    fn export(source: &Path, document: Document) {
        let files = document
            .render_with(Audience::Reader, &ExportLayout::default())
            .unwrap();
        lgtmd::store::build(source, &files).unwrap();
    }

    #[test]
    fn preview_rejects_overlapping_trees_before_creating_output() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().canonicalize().unwrap();
        let source = root.join("export");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("guide.md"), "Retain the source.").unwrap();
        for destination in [&source, &source.join("preview"), &root] {
            assert!(preview(&source, destination).is_err());
        }
        assert_eq!(fs::read_dir(&source).unwrap().count(), 1);
        assert_eq!(
            fs::read_to_string(source.join("guide.md")).unwrap(),
            "Retain the source."
        );
    }

    #[test]
    fn preview_uses_inventory_for_pages_downloads_and_both_audiences() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().canonicalize().unwrap();
        let mut first = doc("start");
        first.heading_with_id("intro", 2, "Start here").unwrap();
        first
            .markdown(
                "~~Old wording~~\n\n| Option | Value |\n| --- | --- |\n| Retries | 3 |\n\n\
            [Other](nested/other.source#target)\n[Self](#intro)\n\
            [Remote](https://example.com/other.md#section)\n\
            [Email](mailto:editor@example.md)",
            )
            .unwrap();
        let markdown_download =
            b"# Download remains Markdown\n[Other](../manual/nested/other.source#target)\n";
        let download = first
            .resource_at(
                "download",
                text(markdown_download, "md"),
                "downloads/raw.md",
            )
            .unwrap();
        first.paragraph(download.link("Download source")).unwrap();
        let hidden = first
            .resource_at(
                "hidden",
                text(b"A documented hidden file", "txt"),
                ".fixture.txt",
            )
            .unwrap();
        first.paragraph(hidden.link("Hidden filename")).unwrap();
        let private = first
            .resource_at(
                "private",
                text(b"Private context", "txt"),
                "internal/session.txt",
            )
            .unwrap();
        first
            .note(("Private rationale: ", private.link("Session")))
            .unwrap();
        let mut other = doc("other");
        other.heading_with_id("target", 2, "Other").unwrap();
        other
            .markdown("[Back](../start.guide#intro)\n[Download](../../downloads/raw.md)")
            .unwrap();
        let documents = [first.finish().unwrap(), other.finish().unwrap()];
        let layout = ExportLayout::default()
            .page("start", "manual/start.guide")
            .unwrap()
            .page("other", "manual/nested/other.source")
            .unwrap();
        for (audience, name) in [
            (Audience::Reader, "reader"),
            (Audience::Contributor, "contributor"),
        ] {
            let source = root.join(format!("{name}-export"));
            let destination = root.join(format!("{name}-preview"));
            let files = lgtmd::render_with(&documents, audience, &layout).unwrap();
            lgtmd::store::build(&source, &files).unwrap();
            let retained = lifecycle::read_tree(&source).unwrap();
            preview(&source, &destination).unwrap();
            let html = fs::read_to_string(destination.join("manual/start.html")).unwrap();
            for target in [
                "nested/other.html#target",
                "#intro",
                "../downloads/raw.md",
                "https://example.com/other.md#section",
                "mailto:editor@example.md",
            ] {
                assert!(html.contains(&format!("href=\"{target}\"")), "{html}");
            }
            assert!(html.contains("<del>Old wording</del>"), "{html}");
            assert!(html.contains("<table>"), "{html}");
            assert!(html.contains("<a id=\"intro\"></a>"), "{html}");
            let nested = fs::read_to_string(destination.join("manual/nested/other.html")).unwrap();
            assert!(nested.contains("href=\"../start.html#intro\""), "{nested}");
            assert!(
                nested.contains("href=\"../../downloads/raw.md\""),
                "{nested}"
            );
            assert_eq!(
                fs::read(destination.join("downloads/raw.md")).unwrap(),
                markdown_download
            );
            assert!(!destination.join("downloads/raw.html").exists());
            assert_eq!(
                fs::read(destination.join(".fixture.txt")).unwrap(),
                b"A documented hidden file"
            );
            assert_eq!(
                html.contains("Private rationale"),
                audience == Audience::Contributor
            );
            assert_eq!(
                destination.join("internal/session.txt").exists(),
                audience == Audience::Contributor
            );
            assert!(!destination.join(".ownership.json").exists());
            assert!(!destination.join("manifest.json").exists());
            assert!(!destination.join("manual/start.guide").exists());
            assert_eq!(lifecycle::read_tree(&source).unwrap(), retained);
        }
    }

    #[test]
    fn preview_preserves_external_urls_and_resolves_encoded_page_names() {
        let pages = BTreeMap::from([
            ("manual/start.guide".into(), "manual/start.html".into()),
            (
                "manual/入口/other.source".into(),
                "manual/入口/other.html".into(),
            ),
        ]);
        let page = "manual/start.guide";
        assert_eq!(
            preview_link("%E5%85%A5%E5%8F%A3/other.source#target", page, &pages).unwrap(),
            "%E5%85%A5%E5%8F%A3/other.html#target"
        );
        for link in [
            "https://example.com/other.md#section",
            "mailto:editor@example.md",
            "//example.com/other.md",
        ] {
            assert_eq!(preview_link(link, page, &pages).unwrap(), link);
        }
    }

    #[test]
    fn preview_rejects_page_resource_and_directory_collisions_before_publication() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().canonicalize().unwrap();
        for (index, path) in ["guide.html", "guide.html/download.txt"]
            .into_iter()
            .enumerate()
        {
            let source = root.join(format!("export-{index}"));
            let destination = root.join(format!("preview-{index}"));
            let mut guide = doc("guide");
            let resource = guide
                .resource_at("collision", text(b"Retained bytes", "txt"), path)
                .unwrap();
            guide.paragraph(resource.link("Download")).unwrap();
            export(&source, guide.finish().unwrap());
            let error = preview(&source, &destination).unwrap_err();
            assert!(error.contains("Preview output collision"), "{error}");
            assert!(!destination.exists());
            assert_eq!(fs::read(source.join(path)).unwrap(), b"Retained bytes");
        }
    }

    #[test]
    fn preview_rejects_pages_that_map_to_the_same_html_path() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().canonicalize().unwrap();
        let source = root.join("export");
        let destination = root.join("preview");
        let documents = [
            doc("first").finish().unwrap(),
            doc("second").finish().unwrap(),
        ];
        let layout = ExportLayout::default()
            .page("first", "guide.md")
            .unwrap()
            .page("second", "guide.source")
            .unwrap();
        let files = lgtmd::render_with(&documents, Audience::Reader, &layout).unwrap();
        lgtmd::store::build(&source, &files).unwrap();
        assert!(
            preview(&source, &destination)
                .unwrap_err()
                .contains("Preview output collision")
        );
        assert!(!destination.exists());
    }

    #[test]
    fn preview_rejects_changed_or_unrecorded_source_files_and_preserves_existing_review() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().canonicalize().unwrap();
        let source = root.join("export");
        let destination = root.join("preview");
        let mut guide = doc("guide");
        guide.paragraph("Retain the source.").unwrap();
        export(&source, guide.finish().unwrap());
        fs::write(source.join("private.txt"), "Must never leak").unwrap();
        assert!(
            preview(&source, &destination)
                .unwrap_err()
                .contains("unrecorded")
        );
        assert!(!destination.exists());
        fs::remove_file(source.join("private.txt")).unwrap();
        fs::write(source.join("guide.md"), "Changed after export").unwrap();
        assert!(
            preview(&source, &destination)
                .unwrap_err()
                .contains("size/hash mismatch")
        );
        assert!(!destination.exists());
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("review.txt"), "Earlier evidence").unwrap();
        assert!(
            preview(&source, &destination)
                .unwrap_err()
                .contains("must be new")
        );
        assert_eq!(
            fs::read(destination.join("review.txt")).unwrap(),
            b"Earlier evidence"
        );
    }

    #[cfg(unix)]
    #[test]
    fn preview_rejects_symlinks_in_export_and_destination_components() {
        use std::os::unix::fs::symlink;
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().canonicalize().unwrap();
        let source = root.join("export");
        export(&source, doc("guide").finish().unwrap());
        symlink(source.join("guide.md"), source.join("linked.md")).unwrap();
        let destination = root.join("preview");
        assert!(
            preview(&source, &destination)
                .unwrap_err()
                .contains("symlink")
        );
        assert!(!destination.exists());
        fs::remove_file(source.join("linked.md")).unwrap();
        let alias = root.join("alias");
        symlink(&root, &alias).unwrap();
        assert!(
            preview(&source, &alias.join("preview"))
                .unwrap_err()
                .to_lowercase()
                .contains("symlink")
        );
        assert!(!destination.exists());
    }
}
