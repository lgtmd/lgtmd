use crate::{Prose, Result, model::Inline};
use std::collections::{BTreeMap, BTreeSet};

impl Prose {
    /// Compose named typed parts without flattening their evidence references.
    /// Supports `{name}` and escaped `{{`/`}}`; format specifiers are unsupported.
    /// Prefer the named form of `prose!` at authoring call sites.
    pub fn interpolate<const N: usize>(text: &str, bindings: [(&str, Self); N]) -> Result<Self> {
        let mut names = BTreeMap::new();
        for (name, value) in bindings {
            if name.is_empty() || name.chars().any(|c| c.is_whitespace() || "{}:".contains(c)) {
                return Err(format!("Invalid prose binding name: {name:?}"));
            }
            if names.insert(name, value).is_some() {
                return Err(format!("Duplicate prose binding: {name}"));
            }
        }
        let mut used = BTreeSet::new();
        let mut parts = Vec::new();
        let mut literal = String::new();
        let mut remaining = text;
        while let Some(index) = remaining.find(['{', '}']) {
            literal.push_str(&remaining[..index]);
            remaining = &remaining[index..];
            if remaining.starts_with("{{") || remaining.starts_with("}}") {
                literal.push(remaining.as_bytes()[0] as char);
                remaining = &remaining[2..];
                continue;
            }
            if remaining.starts_with('}') {
                return Err("Unmatched closing brace in prose; use }} for a literal brace".into());
            }
            let end = remaining.find('}').ok_or("Unclosed prose binding")?;
            let name = &remaining[1..end];
            let value = names
                .get(name)
                .ok_or_else(|| format!("Unknown prose binding: {name:?}"))?;
            if !literal.is_empty() {
                parts.push(Inline::Text(std::mem::take(&mut literal)));
            }
            parts.extend(value.0.iter().cloned());
            used.insert(name);
            remaining = &remaining[end + 1..];
        }
        literal.push_str(remaining);
        if !literal.is_empty() {
            parts.push(Inline::Text(literal));
        }
        let unused: Vec<_> = names.keys().filter(|name| !used.contains(**name)).collect();
        if !unused.is_empty() {
            return Err(format!("Unused prose bindings: {unused:?}"));
        }
        Ok(Self(parts))
    }
}
