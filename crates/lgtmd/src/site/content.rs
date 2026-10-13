use super::{Bundle, Node, Resource};
use crate::Result;
use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag};
use std::collections::BTreeSet;

fn append(stack: &mut [Node], node: Node) -> Result<()> {
    stack
        .last_mut()
        .ok_or("Invalid content stack")?
        .children
        .push(node);
    Ok(())
}
fn close(stack: &mut Vec<Node>) -> Result<()> {
    let mut node = stack.pop().ok_or("Invalid content close")?;
    if stack.is_empty() {
        return Err("Unbalanced content close".into());
    }
    if node.kind == "document"
        || node.kind == "paragraph" && node.children.iter().all(|child| child.kind == "anchor")
    {
        for child in node.children {
            append(stack, child)?;
        }
    } else {
        if node.kind == "image" {
            node.text = Some(plain(&node.children));
            node.children.clear();
        }
        append(stack, node)?;
    }
    Ok(())
}
fn plain(nodes: &[Node]) -> String {
    nodes
        .iter()
        .map(|n| n.text.clone().unwrap_or_else(|| plain(&n.children)))
        .collect()
}

pub(super) fn parse(
    markdown: &str,
    page: &str,
    pages: &[String],
    resources: &[Resource],
) -> Result<Vec<Node>> {
    let mut stack = vec![Node::new("document")];
    for event in Parser::new_ext(
        markdown,
        Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH,
    ) {
        match event {
            Event::Start(tag) => {
                let image = matches!(&tag, Tag::Image { .. });
                let node = match tag {
                    Tag::Paragraph => Node::new("paragraph"),
                    Tag::Heading { level, .. } => {
                        let mut node = Node::new("heading");
                        node.level = Some(level as u8);
                        node
                    }
                    Tag::BlockQuote(_) => Node::new("blockquote"),
                    Tag::CodeBlock(kind) => {
                        let mut node = Node::new("code_block");
                        if let CodeBlockKind::Fenced(language) = kind {
                            node.language = Some(language.into_string());
                        }
                        node
                    }
                    Tag::List(start) => {
                        let mut node = Node::new("list");
                        node.start = start;
                        node
                    }
                    Tag::Item => Node::new("item"),
                    Tag::Emphasis => Node::new("emphasis"),
                    Tag::Strong => Node::new("strong"),
                    Tag::Strikethrough => Node::new("strikethrough"),
                    Tag::Table(align) => {
                        let mut node = Node::new("table");
                        node.align = align
                            .iter()
                            .map(|v| format!("{v:?}").to_lowercase())
                            .collect();
                        node
                    }
                    Tag::TableHead => Node::new("table_head"),
                    Tag::TableRow => Node::new("table_row"),
                    Tag::TableCell => Node::new("table_cell"),
                    Tag::Link {
                        dest_url, title, ..
                    }
                    | Tag::Image {
                        dest_url, title, ..
                    } => {
                        let mut node = Node::new(if image { "image" } else { "link" });
                        if !title.is_empty() {
                            node.title = Some(title.into_string());
                        }
                        match crate::paths::local_target(&dest_url, page)? {
                            None => {
                                node.url = Some(dest_url.into_string());
                                if image {
                                    node.kind = "link".into();
                                }
                            }
                            Some((path, fragment)) => {
                                if let Some(resource) =
                                    resources.iter().find(|resource| resource.path == path)
                                {
                                    if fragment.is_some() {
                                        return Err("Resource URL fragments are unsupported".into());
                                    }
                                    node.resource_id = Some(resource.id.clone());
                                    node.page_id = Some(resource.page_id.clone());
                                } else if let Some(id) =
                                    pages.iter().find(|id| format!("{id}.md") == path)
                                {
                                    if image {
                                        return Err(
                                            "Images must reference an image resource".into()
                                        );
                                    }
                                    node.page_id = Some(id.clone());
                                    node.id = fragment;
                                } else {
                                    return Err(format!("Unknown site link target: {dest_url}"));
                                }
                            }
                        }
                        node
                    }
                    Tag::HtmlBlock => Node::new("document"),
                    _ => return Err("Unsupported CommonMark container in site output".into()),
                };
                stack.push(node);
            }
            Event::End(_) => close(&mut stack)?,
            Event::Text(text) => {
                let mut node = Node::new("text");
                node.text = Some(text.into_string());
                append(&mut stack, node)?;
            }
            Event::Code(text) => {
                let mut node = Node::new("code");
                node.text = Some(text.into_string());
                append(&mut stack, node)?;
            }
            Event::SoftBreak => append(&mut stack, Node::new("soft_break"))?,
            Event::HardBreak => append(&mut stack, Node::new("hard_break"))?,
            Event::Rule => append(&mut stack, Node::new("rule"))?,
            Event::Html(html) | Event::InlineHtml(html) => {
                let html = html.trim();
                if let Some(id) = html.strip_prefix("<a id=\"").and_then(|html| {
                    html.strip_suffix("\"></a>")
                        .or_else(|| html.strip_suffix("\">"))
                }) {
                    if !crate::model::valid_id(id) {
                        return Err("Invalid generated anchor".into());
                    }
                    let mut node = Node::new("anchor");
                    node.id = Some(id.into());
                    append(&mut stack, node)?;
                } else if html == "</a>" {
                } else if matches!(html, "<kbd>" | "<code>") {
                    stack.push(Node::new(if html == "<kbd>" { "key" } else { "code" }));
                } else if matches!(html, "</kbd>" | "</code>") {
                    let expected = if html == "</kbd>" { "key" } else { "code" };
                    if stack.last().is_none_or(|node| node.kind != expected) {
                        return Err("Unbalanced generated inline binding".into());
                    }
                    close(&mut stack)?;
                } else if !html.is_empty() {
                    return Err(format!("Unsupported HTML in site content: {html}"));
                }
            }
            _ => return Err("Unsupported CommonMark event in site output".into()),
        }
    }
    if stack.len() != 1 {
        return Err("Unbalanced site content".into());
    }
    Ok(stack.pop().unwrap().children)
}

pub(super) fn anchors(nodes: &[Node], output: &mut Vec<String>) {
    for node in nodes {
        if node.kind == "anchor"
            && let Some(id) = &node.id
        {
            output.push(id.clone());
        }
        anchors(&node.children, output);
    }
}
pub(super) fn note(nodes: &[Node], id: &str) -> Result<Vec<Node>> {
    fn contains_anchor(node: &Node, id: &str) -> bool {
        node.kind == "anchor" && node.id.as_deref() == Some(id)
            || node.children.iter().any(|child| contains_anchor(child, id))
    }
    // A MarkdownParts block may have no trailing whitespace, so the generated
    // note anchor can finish its paragraph. The note's quote starts after that
    // enclosing block; parse the complete page rather than the authored pieces.
    let Some(start) = nodes.iter().position(|node| contains_anchor(node, id)) else {
        return Err(format!("Contributor note anchor not found: {id}"));
    };
    let end = nodes[start + 1..]
        .iter()
        .position(|node| node.kind == "anchor")
        .map_or(nodes.len(), |offset| start + 1 + offset);
    let result = nodes[start + 1..end].to_vec();
    if result.is_empty() {
        return Err(format!("Empty contributor note content: {id}"));
    }
    Ok(result)
}

pub(super) fn validate_nodes(
    nodes: &[Node],
    bundle: &Bundle,
    referenced: &mut BTreeSet<(String, String)>,
    depth: usize,
) -> Result<()> {
    if depth > 128 {
        return Err("Site content nesting exceeds 128 levels".into());
    }
    for node in nodes {
        let kind = node.kind.as_str();
        if !matches!(
            kind,
            "document"
                | "paragraph"
                | "heading"
                | "blockquote"
                | "list"
                | "item"
                | "emphasis"
                | "strong"
                | "strikethrough"
                | "link"
                | "image"
                | "code_block"
                | "table"
                | "table_head"
                | "table_row"
                | "table_cell"
                | "key"
                | "code"
                | "text"
                | "soft_break"
                | "hard_break"
                | "rule"
                | "anchor"
        ) {
            return Err(format!("Unsupported site node: {kind}"));
        }
        if node.text.is_some() && !matches!(kind, "text" | "code" | "image")
            || node.level.is_some() && kind != "heading"
            || node.start.is_some() && kind != "list"
            || node.url.is_some() && !matches!(kind, "link" | "image")
            || node.title.is_some() && !matches!(kind, "link" | "image")
            || node.language.is_some() && kind != "code_block"
            || node.id.is_some() && !matches!(kind, "anchor" | "link")
            || (node.resource_id.is_some() || node.page_id.is_some())
                && !matches!(kind, "link" | "image")
            || !node.align.is_empty() && kind != "table"
        {
            return Err(format!("Invalid properties on site {kind}"));
        }
        if matches!(kind, "text" | "image") && node.text.is_none()
            || kind == "heading" && node.level.is_none_or(|v| !(1..=6).contains(&v))
            || kind == "anchor"
                && node
                    .id
                    .as_ref()
                    .is_none_or(|id| !crate::model::valid_id(id))
        {
            return Err(format!("Missing or invalid properties on site {kind}"));
        }
        if matches!(
            kind,
            "text" | "image" | "anchor" | "soft_break" | "hard_break" | "rule"
        ) && !node.children.is_empty()
            || node.text.is_some() && !node.children.is_empty()
        {
            return Err(format!("Invalid child content on site {kind}"));
        }
        if node
            .align
            .iter()
            .any(|align| !matches!(align.as_str(), "none" | "left" | "center" | "right"))
        {
            return Err("Invalid table alignment".into());
        }
        if matches!(kind, "link" | "image") {
            if let Some(url) = &node.url {
                if kind == "image"
                    || node.page_id.is_some()
                    || node.resource_id.is_some()
                    || node.id.is_some()
                    || crate::paths::local_target(url, "page.md")?.is_some()
                {
                    return Err("Invalid external site link".into());
                }
            } else {
                let page = node
                    .page_id
                    .as_ref()
                    .and_then(|id| bundle.pages.iter().find(|p| p.id == *id))
                    .ok_or("Site link references a missing page")?;
                if let Some(id) = &node.resource_id {
                    let resource = bundle
                        .resources
                        .iter()
                        .find(|r| r.page_id == page.id && r.id == *id)
                        .ok_or("Site link references a missing resource")?;
                    if node.id.is_some() || kind == "image" && !resource.mime.starts_with("image/")
                    {
                        return Err("Invalid image resource or resource fragment".into());
                    }
                    referenced.insert((page.id.clone(), id.clone()));
                } else if kind == "image"
                    || node
                        .id
                        .as_ref()
                        .is_some_and(|id| !page.anchors.contains(id))
                {
                    return Err("Site link references a missing anchor or image".into());
                }
            }
        }
        validate_nodes(&node.children, bundle, referenced, depth + 1)?;
    }
    Ok(())
}
