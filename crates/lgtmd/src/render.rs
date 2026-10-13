use crate::model::{BindingValue, Content, Document, Inline, Kind, Node, Prose, Reference};
use crate::{
    Audience, ExportLayout, Result,
    manifest::Manifest,
    markdown::{Rendered, escape, markdown_links, parsed_links},
    paths::{artifact_path, local_target, relative_path, validate_resource_path},
    validation::{validate_document, visible_nodes},
};
use std::collections::{BTreeMap, BTreeSet};

fn node_links(document: &Document, node: &Node, layout: &ExportLayout) -> Result<Vec<String>> {
    let links = match &node.content {
        Content::Markdown(text) => markdown_links(text),
        Content::MarkdownParts(parts) => {
            parsed_links(&render_prose(document, parts, true, layout), &[])
        }
        _ => Ok(Vec::new()),
    };
    links.map_err(|error| {
        format!(
            "Document {} ({}), block {}: {error}",
            document.id,
            layout.page_path(&document.id),
            node.id
        )
    })
}

fn visible_resources(
    document: &Document,
    audience: Audience,
    layout: &ExportLayout,
) -> Result<BTreeSet<String>> {
    let paths: BTreeMap<_, _> = document
        .artifacts
        .keys()
        .map(|id| (layout.resource_path(document, id), id))
        .collect();
    let mut used = BTreeSet::new();
    for node in visible_nodes(document, audience) {
        for reference in node.references() {
            if reference.kind == Kind::Resource {
                used.insert(reference.id.clone());
            }
        }
        for link in node_links(document, node, layout)? {
            if let Some((path, _)) = local_target(&link, &layout.page_path(&document.id))?
                && let Some(id) = paths.get(&path)
            {
                used.insert((*id).clone());
            }
        }
    }
    Ok(used)
}

fn insert_owned_path(paths: &mut BTreeSet<String>, path: String) -> Result<()> {
    validate_resource_path(&path)?;
    if paths.contains(&path) {
        return Err(format!("Duplicate artifact path: {path}"));
    }
    if paths.iter().any(|existing| {
        path.starts_with(&format!("{existing}/")) || existing.starts_with(&format!("{path}/"))
    }) {
        return Err(format!("Artifact file/directory collision: {path}"));
    }
    paths.insert(path);
    Ok(())
}

fn validate_document_with(document: &Document, layout: &ExportLayout) -> Result<()> {
    validate_document(document)?;
    let mut paths = BTreeSet::from(["manifest.json".to_owned()]);
    insert_owned_path(&mut paths, layout.page_path(&document.id))?;
    for id in document.artifacts.keys() {
        insert_owned_path(&mut paths, layout.resource_path(document, id))?;
    }
    let used = visible_resources(document, Audience::Contributor, layout)?;
    let orphaned: Vec<_> = document
        .artifacts
        .keys()
        .filter(|id| !used.contains(*id))
        .collect();
    if !orphaned.is_empty() {
        return Err(format!("Unreferenced resources: {orphaned:?}"));
    }
    Ok(())
}

fn resource_url(document: &Document, reference: &Reference, layout: &ExportLayout) -> String {
    if reference.kind == Kind::Block {
        return format!("#{}", reference.id);
    }
    // Encode bytes before Markdown parses entities or punctuation. The stored
    // artifact path remains unchanged; ownership checks decode this destination.
    relative_path(
        &layout.page_path(&document.id),
        &layout.resource_path(document, &reference.id),
    )
    .bytes()
    .map(|byte| {
        if byte.is_ascii_alphanumeric() || b"/-._~".contains(&byte) {
            (byte as char).to_string()
        } else {
            format!("%{byte:02X}")
        }
    })
    .collect()
}

fn binding_html(tag: &str, text: &str) -> Rendered {
    let mut rendered = Rendered::html(format!("<{tag}>"));
    rendered.push(Rendered::text(escape_html(text)));
    rendered.push(Rendered::html(format!("</{tag}>")));
    rendered
}

fn inline(document: &Document, reference: &Reference, layout: &ExportLayout) -> Rendered {
    Rendered::text(match reference.kind {
        Kind::Resource | Kind::Block => format!(
            "[{}]({})",
            escape(&reference.id),
            resource_url(document, reference, layout)
        ),
        Kind::Claim => format!("`{}`", reference.id),
        Kind::Value | Kind::Observation => {
            let actual = match reference.kind {
                Kind::Value => &document.checks[&reference.id].actual,
                _ => &document.observations[&reference.id],
            };
            escape(
                &actual
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| actual.to_string()),
            )
        }
        Kind::Binding => match &document.bindings[&reference.id] {
            BindingValue::Text(text) => escape(text),
            BindingValue::Code(text) => return binding_html("code", text),
            BindingValue::Keys(keys) => {
                let mut rendered = Rendered::default();
                for (index, key) in keys.iter().enumerate() {
                    if index != 0 {
                        rendered.push(Rendered::text(" + "));
                    }
                    rendered.push(binding_html("kbd", key));
                }
                return rendered;
            }
        },
    })
}

fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
        .replace('|', "&#124;")
        .replace('`', "&#96;")
        .replace('*', "&#42;")
        .replace('_', "&#95;")
        .replace('~', "&#126;")
        .replace('\\', "&#92;")
        .replace('[', "&#91;")
        .replace(']', "&#93;")
        .replace('!', "&#33;")
}

fn render_prose(
    document: &Document,
    prose: &Prose,
    markdown: bool,
    layout: &ExportLayout,
) -> Rendered {
    let mut rendered = Rendered::default();
    for part in &prose.0 {
        rendered.push(match part {
            Inline::Text(text) => {
                Rendered::text(if markdown { text.clone() } else { escape(text) })
            }
            Inline::Reference(reference) => inline(document, reference, layout),
            Inline::Image(reference, alt) => Rendered::text(format!(
                "![{}]({})",
                escape(alt),
                resource_url(document, reference, layout)
            )),
            Inline::Link(reference, label) => Rendered::text(format!(
                "[{}]({})",
                escape(label),
                resource_url(document, reference, layout)
            )),
            Inline::Code(reference, language) => {
                let text = std::str::from_utf8(&document.artifacts[&reference.id].bytes)
                    .expect("Authoring validates code resource UTF-8");
                Rendered::text(format!("{}\n\n", render_code(text, language)))
            }
        });
    }
    rendered
}

fn code_fence(text: &str) -> String {
    let longest = text.split(|c| c != '`').map(str::len).max().unwrap_or(0);
    "`".repeat(longest.max(2) + 1)
}

fn render_code(text: &str, language: &str) -> String {
    let fence = code_fence(text);
    format!(
        "{fence}{language}\n{text}{}{fence}",
        if text.ends_with('\n') { "" } else { "\n" }
    )
}

fn render_page(
    document: &Document,
    audience: Audience,
    fragment: bool,
    layout: &ExportLayout,
) -> Result<(String, Vec<String>)> {
    let mut page = if fragment {
        Rendered::default()
    } else {
        Rendered::text(format!("# {}\n\n", escape(&document.title)))
    };
    let mut boundaries = Vec::new();
    for node in visible_nodes(document, audience) {
        boundaries.push((page.text.len(), node.id.as_str()));
        if !fragment {
            page.push(Rendered::html(format!("<a id=\"{}\"></a>", node.id)));
            page.push(Rendered::text("\n\n"));
        }
        let content = match &node.content {
            Content::Heading(level, text) => {
                Rendered::text(format!("{} {}", "#".repeat((*level).into()), escape(text)))
            }
            Content::Paragraph(text) => render_prose(document, text, false, layout),
            Content::Markdown(text) => Rendered::text(text.clone()),
            Content::MarkdownParts(parts) => render_prose(document, parts, true, layout),
            Content::Embed(reference, caption) => {
                let image = document.artifacts[&reference.id].mime.starts_with("image/");
                Rendered::text(format!(
                    "{}[{}]({})",
                    if image { "!" } else { "" },
                    escape(caption),
                    resource_url(document, reference, layout)
                ))
            }
            Content::Code(reference, language) => {
                let text = std::str::from_utf8(&document.artifacts[&reference.id].bytes)
                    .map_err(|_| "Code resource must be UTF-8")?;
                Rendered::text(render_code(text, language))
            }
            Content::Note { target, prose } => {
                let mut note = Rendered::text("**Contributor note");
                if let Some(reference) = target {
                    note.push(Rendered::text(" on "));
                    note.push(match reference.kind {
                        Kind::Claim | Kind::Value | Kind::Observation => {
                            Rendered::text(format!("`{}`", reference.id))
                        }
                        _ => inline(document, reference, layout),
                    });
                }
                note.push(Rendered::text(":** "));
                note.push(render_prose(document, prose, false, layout));
                note.quote()
            }
        };
        page.push(content);
        if !matches!(node.content, Content::MarkdownParts(_)) {
            page.push(Rendered::text("\n\n"));
        }
    }
    let links = parsed_links(&page, &boundaries).map_err(|error| {
        format!(
            "Document {} ({}): {error}",
            document.id,
            layout.page_path(&document.id)
        )
    })?;
    Ok((page.text, links))
}

pub(crate) fn render_fragment(document: &Document, audience: Audience) -> Result<String> {
    validate_document_with(document, &ExportLayout::default())?;
    for node in visible_nodes(document, audience) {
        if node
            .references()
            .iter()
            .any(|reference| reference.kind == Kind::Block)
        {
            return Err(
                "Fragment rendering omits block anchors; block references are unsupported".into(),
            );
        }
    }
    render_page(document, audience, true, &ExportLayout::default()).map(|(text, _)| text)
}

pub(crate) fn resource_files(
    document: &Document,
    audience: Audience,
) -> Result<BTreeMap<String, Vec<u8>>> {
    validate_document_with(document, &ExportLayout::default())?;
    Ok(
        visible_resources(document, audience, &ExportLayout::default())?
            .into_iter()
            .map(|id| {
                (
                    artifact_path(document, &id),
                    document.artifacts[&id].bytes.clone(),
                )
            })
            .collect(),
    )
}

/// Render ordinary Markdown, immutable resources and a deterministic JSON manifest.
/// Reader output contains neither contributor blocks nor their exclusive resources.
/// Local link fragments must refer to generated block IDs; raw heading slugs are
/// intentionally not assumed to be identical across downstream site renderers.
pub fn render(documents: &[Document], audience: Audience) -> Result<BTreeMap<String, Vec<u8>>> {
    render_with(documents, audience, &ExportLayout::default())
}

/// Render with project-selected bundle paths. Typed links are relative to their
/// containing page; authored links resolve from that same page directory.
/// The complete inventory remains strict across both audiences.
pub fn render_with(
    documents: &[Document],
    audience: Audience,
    layout: &ExportLayout,
) -> Result<BTreeMap<String, Vec<u8>>> {
    layout.validate_documents(documents)?;
    if documents.is_empty() {
        return Err("At least one document is required".into());
    }
    let mut sorted: Vec<_> = documents.iter().collect();
    sorted.sort_by(|a, b| a.id.cmp(&b.id));
    // Ownership is a property of the completed bundle, including contributor-only
    // resources. Selecting Reader must not hide a duplicate declaration.
    let mut owned_paths = BTreeSet::from(["manifest.json".to_owned()]);
    for document in &sorted {
        for path in std::iter::once(layout.page_path(&document.id)).chain(
            document
                .artifacts
                .keys()
                .map(|id| layout.resource_path(document, id)),
        ) {
            insert_owned_path(&mut owned_paths, path)?;
        }
    }
    let mut files = BTreeMap::new();
    let mut ids = BTreeSet::new();
    let mut manifest = Manifest::new(audience);
    let mut anchors = BTreeMap::new();
    let mut page_links = BTreeMap::new();
    for document in &sorted {
        if !ids.insert(&document.id) {
            return Err(format!("Duplicate document ID: {}", document.id));
        }
        validate_document_with(document, layout)?;
        let path = layout.page_path(&document.id);
        let (page, links) = render_page(document, audience, false, layout)?;
        let page = page.into_bytes();
        page_links.insert(&document.id, links);
        manifest.add_page(&document.id, &path, &page);
        if files.insert(path.clone(), page).is_some() {
            return Err(format!("Duplicate artifact path: {path}"));
        }
        anchors.insert(
            path,
            visible_nodes(document, audience)
                .map(|node| node.id.clone())
                .collect::<BTreeSet<_>>(),
        );
        let resources = visible_resources(document, audience, layout)?;
        for id in resources {
            let artifact = &document.artifacts[&id];
            let path = layout.resource_path(document, &id);
            manifest.add_resource(&document.id, &id, &path, artifact);
            if files.insert(path.clone(), artifact.bytes.clone()).is_some() {
                return Err(format!("Duplicate artifact path: {path}"));
            }
        }
        manifest.add_document(document, audience)?;
    }
    // Validate against the actual filtered bundle, never against all collected resources.
    for document in &sorted {
        for link in &page_links[&document.id] {
            if let Some((path, fragment)) = local_target(link, &layout.page_path(&document.id))? {
                if !files.contains_key(&path) {
                    return Err(format!(
                        "Broken or excluded local link in {}: {link}",
                        document.id
                    ));
                }
                if let Some(fragment) = fragment
                    && !anchors
                        .get(&path)
                        .is_some_and(|ids| ids.contains(&fragment))
                {
                    return Err(format!(
                        "Unknown generated block anchor in {}: {link}",
                        document.id
                    ));
                }
            }
        }
    }
    files.insert("manifest.json".into(), manifest.encode()?);
    Ok(files)
}
