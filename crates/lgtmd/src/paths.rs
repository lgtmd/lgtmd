//! Bundle paths and local URL resolution, independent of Markdown export.
use crate::{ExportLayout, Result, model::Document};

pub(crate) fn validate_resource_path(path: &str) -> Result<()> {
    if path.is_empty()
        || matches!(
            path.split('/').next(),
            Some("manifest.json" | ".ownership.json")
        )
        || path
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || "\\:%?#()[]<>\"".contains(c))
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(format!("Unsafe or reserved artifact path: {path:?}"));
    }
    Ok(())
}

pub(crate) fn artifact_path(document: &Document, id: &str) -> String {
    ExportLayout::default().resource_path(document, id)
}

/// Decode URL escapes before checking local ownership, so encoded traversal and
/// encoded audience-hidden resource links receive the same checks as plain ones.
fn decode_path(text: &str) -> Result<String> {
    let bytes = text.as_bytes();
    let mut decoded = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return Err(format!("Malformed percent escape in link: {text}"));
            }
            let hex =
                std::str::from_utf8(&bytes[i + 1..i + 3]).map_err(|_| "Invalid URL escape")?;
            decoded.push(
                u8::from_str_radix(hex, 16)
                    .map_err(|_| format!("Malformed percent escape in link: {text}"))?,
            );
            i += 3;
        } else {
            decoded.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(decoded).map_err(|_| "Local link is not UTF-8".into())
}

/// Produce a page-relative URL path while keeping ownership paths bundle-relative.
pub(crate) fn relative_path(page: &str, target: &str) -> String {
    let mut directory: Vec<_> = page.split('/').collect();
    directory.pop();
    let target: Vec<_> = target.split('/').collect();
    let common = directory
        .iter()
        .zip(&target)
        .take_while(|(a, b)| a == b)
        .count();
    std::iter::repeat_n("..", directory.len() - common)
        .chain(target[common..].iter().copied())
        .collect::<Vec<_>>()
        .join("/")
}

pub(crate) fn local_target(link: &str, page: &str) -> Result<Option<(String, Option<String>)>> {
    if link.chars().any(char::is_control) {
        return Err("Link contains control characters".into());
    }
    for scheme in ["https://", "http://"] {
        if let Some(rest) = link.strip_prefix(scheme) {
            if rest.is_empty() || rest.starts_with('/') || rest.chars().any(char::is_whitespace) {
                return Err(format!("Malformed external link: {link}"));
            }
            return Ok(None);
        }
    }
    if let Some(rest) = link.strip_prefix("mailto:") {
        if rest.is_empty() || rest.chars().any(char::is_whitespace) {
            return Err(format!("Malformed mail link: {link}"));
        }
        return Ok(None);
    }
    let (path, fragment) = link
        .split_once('#')
        .map_or((link, None), |(path, fragment)| (path, Some(fragment)));
    let path = decode_path(path)?;
    if path.contains(['\\', ':', '?'])
        || path.starts_with('/')
        || (!path.is_empty() && path.split('/').any(str::is_empty))
        || path.chars().any(char::is_control)
    {
        return Err(format!("Unsafe or unsupported local link: {link}"));
    }
    let fragment = fragment.map(decode_path).transpose()?;
    if path.is_empty() && fragment.as_deref().is_none_or(str::is_empty) {
        return Err("An empty link does not identify evidence".into());
    }
    let resolved = if path.is_empty() {
        page.to_owned()
    } else {
        let mut components: Vec<_> = page.split('/').collect();
        components.pop();
        for component in path.split('/') {
            match component {
                "." => {}
                ".." => {
                    if components.pop().is_none() {
                        return Err(format!("Local link escapes the export bundle: {link}"));
                    }
                }
                _ => components.push(component),
            }
        }
        if components.is_empty() {
            return Err(format!("Local link does not identify a file: {link}"));
        }
        components.join("/")
    };
    Ok(Some((resolved, fragment)))
}
