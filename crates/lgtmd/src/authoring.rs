//! Rust authoring operations and evidence acquisition before document freezing.

use crate::{
    Artifact, Result,
    model::{
        Binding, BindingValue, Block, Check, Checked, Claim, Content, Document, Inline, IntoProse,
        Kind, Node, Observed, Reference, Resource, Target, valid_id,
    },
};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::BTreeMap,
    marker::PhantomData,
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT_OWNER: AtomicU64 = AtomicU64::new(1);

pub struct Doc {
    owner: u64,
    ids: BTreeMap<String, Kind>,
    document: Document,
    errors: Vec<String>,
}

impl Doc {
    pub fn new(id: &str, title: &str) -> Result<Self> {
        if !valid_id(id) {
            return Err(format!("Invalid document ID: {id:?}"));
        }
        if title.trim().is_empty() || title.chars().any(char::is_control) {
            return Err("Document title must be nonempty single-line text".into());
        }
        Ok(Self {
            owner: NEXT_OWNER.fetch_add(1, Ordering::Relaxed),
            ids: BTreeMap::new(),
            document: Document {
                id: id.into(),
                title: title.into(),
                nodes: Vec::new(),
                checks: BTreeMap::new(),
                observations: BTreeMap::new(),
                artifacts: BTreeMap::new(),
                resource_paths: BTreeMap::new(),
                bindings: BTreeMap::new(),
            },
            errors: Vec::new(),
        })
    }

    fn guarded<T>(&mut self, result: Result<T>) -> Result<T> {
        result.map_err(|error| {
            let contextual = format!("Document {}: {error}", self.document.id);
            self.errors.push(contextual.clone());
            contextual
        })
    }

    fn reserve(&mut self, id: &str, kind: Kind) -> Result<Reference> {
        if !valid_id(id) {
            return Err(format!("Invalid evidence ID: {id:?}"));
        }
        if self.ids.contains_key(id) {
            return Err(format!("Duplicate evidence ID: {id}"));
        }
        self.ids.insert(id.into(), kind.clone());
        Ok(Reference {
            owner: self.owner,
            id: id.into(),
            kind,
        })
    }

    fn validate_reference(&self, reference: &Reference) -> Result<()> {
        if reference.owner != self.owner {
            return Err(format!("Foreign document/run handle: {}", reference.id));
        }
        if self.ids.get(&reference.id) != Some(&reference.kind) {
            return Err(format!("Missing or wrong-kind reference: {}", reference.id));
        }
        Ok(())
    }

    fn append(&mut self, content: Content) -> Result<Block> {
        self.append_with_id(None, content)
    }

    pub(crate) fn append_with_id(&mut self, id: Option<&str>, content: Content) -> Result<Block> {
        let result = (|| {
            let note = matches!(content, Content::Note { .. });
            let count = self
                .document
                .nodes
                .iter()
                .filter(|node| node.is_note() == note)
                .count();
            let prefix = if note { "note" } else { "block" };
            let node = Node {
                id: id
                    .map(str::to_owned)
                    .unwrap_or_else(|| format!("{prefix}-{:04}", count + 1)),
                content,
            };
            for reference in node.references() {
                self.validate_reference(reference)?;
            }
            match &node.content {
                Content::Code(reference, language) => {
                    self.validate_code_resource(reference, language)?;
                }
                Content::Embed(reference, _) if reference.kind != Kind::Resource => {
                    return Err("Embedded content requires a resource reference".into());
                }
                _ => {}
            }
            if let Content::Paragraph(prose)
            | Content::MarkdownParts(prose)
            | Content::Note { prose, .. } = &node.content
            {
                for part in &prose.0 {
                    if let Inline::Image(reference, _) = part
                        && (reference.kind != Kind::Resource
                            || !self.document.artifacts[&reference.id]
                                .mime
                                .starts_with("image/"))
                    {
                        return Err(format!(
                            "Resource {} is not declared as an image",
                            reference.id
                        ));
                    }
                    if let Inline::Code(reference, language) = part {
                        if !matches!(node.content, Content::MarkdownParts(_)) {
                            return Err(
                                "Code resource views require Markdown parts; use Doc::code for a standalone block"
                                    .into(),
                            );
                        }
                        self.validate_code_resource(reference, language)?;
                    }
                }
                validate_code_placement(prose)?;
            }
            let reference = self.reserve(&node.id, Kind::Block)?;
            self.document.nodes.push(node);
            Ok(Block(reference))
        })();
        self.guarded(result)
    }

    pub fn heading(&mut self, level: u8, text: &str) -> Result<Block> {
        self.append_heading(None, level, text)
    }

    /// Give a section an explicit anchor that survives inserting other blocks.
    /// IDs share the document's evidence namespace; duplicates fail. Other
    /// headings retain their positional IDs unless explicitly named here.
    pub fn heading_with_id(&mut self, id: &str, level: u8, text: &str) -> Result<Block> {
        self.append_heading(Some(id), level, text)
    }

    fn append_heading(&mut self, id: Option<&str>, level: u8, text: &str) -> Result<Block> {
        if !(1..=6).contains(&level) || text.trim().is_empty() || text.chars().any(char::is_control)
        {
            return self.guarded(Err(
                "Heading requires level 1..6 and nonempty single-line text".into(),
            ));
        }
        self.append_with_id(id, Content::Heading(level, text.into()))
    }

    pub fn paragraph(&mut self, prose: impl IntoProse) -> Result<Block> {
        self.append(Content::Paragraph(prose.into_prose()))
    }

    /// CommonMark plus tables and strikethrough. Reference links and code are parsed
    /// by pulldown-cmark; unresolved references and raw HTML fail explicitly.
    /// Local links target emitted files or explicit block anchors. External
    /// http(s)/mailto links are not network-verified.
    pub fn markdown(&mut self, text: &str) -> Result<Block> {
        let parsed = crate::markdown::markdown_links(text);
        if let Err(error) = parsed {
            return self.guarded(Err(error));
        }
        self.append(Content::Markdown(text.into()))
    }

    /// Preserve literal Markdown bytes while inserting typed values, bindings and
    /// resource views. No separator is appended. Literal HTML is still rejected;
    /// only typed Code/Keys bindings can generate the corresponding safe HTML.
    pub fn markdown_parts(&mut self, parts: impl IntoProse) -> Result<Block> {
        let parts = parts.into_prose();
        let validation = crate::markdown::validate_markdown_parts(&parts);
        self.guarded(validation)?;
        self.append(Content::MarkdownParts(parts))
    }

    pub fn binding(&mut self, id: &str, value: BindingValue) -> Result<Binding> {
        let result = (|| {
            match &value {
                BindingValue::Text(text) | BindingValue::Code(text) => {
                    if text.is_empty() || text.chars().any(char::is_control) {
                        return Err("Binding labels must be nonempty single-line text".into());
                    }
                }
                BindingValue::Keys(keys) => {
                    if keys.is_empty()
                        || keys
                            .iter()
                            .any(|text| text.is_empty() || text.chars().any(char::is_control))
                    {
                        return Err("Key bindings require nonempty single-line key labels".into());
                    }
                }
            }
            let reference = self.reserve(id, Kind::Binding)?;
            self.document.bindings.insert(id.into(), value);
            Ok(Binding(reference))
        })();
        self.guarded(result)
    }

    pub fn note(&mut self, prose: impl IntoProse) -> Result<Block> {
        self.append(Content::Note {
            target: None,
            prose: prose.into_prose(),
        })
    }

    pub fn note_on(&mut self, target: &impl Target, prose: impl IntoProse) -> Result<Block> {
        self.append(Content::Note {
            target: Some(target.reference()),
            prose: prose.into_prose(),
        })
    }

    pub fn expect_eq<T: PartialEq + Serialize>(
        &mut self,
        id: &str,
        actual: T,
        expected: T,
    ) -> Result<Checked<T>> {
        let result = (|| {
            let reference = self.reserve(id, Kind::Value)?;
            let mut actual_json = serde_json::to_value(&actual)
                .map_err(|e| format!("Cannot freeze observed value {id}: {e}"))?;
            let mut expected_json = serde_json::to_value(&expected)
                .map_err(|e| format!("Cannot freeze expected value {id}: {e}"))?;
            // Cargo can unify serde_json's preserve_order feature through the
            // host. Freeze all object keys in canonical order in either mode.
            actual_json.sort_all_objects();
            expected_json.sort_all_objects();
            if actual != expected {
                return Err(format!(
                    "Check {id} failed: observed {actual_json}, expected {expected_json}"
                ));
            }
            self.document.checks.insert(
                id.into(),
                Check {
                    id: id.into(),
                    kind: "equality".into(),
                    actual: actual_json.clone(),
                    expected: expected_json,
                },
            );
            Ok(Checked {
                reference,
                observed: actual_json,
                marker: PhantomData,
            })
        })();
        self.guarded(result)
    }

    /// Freeze an observed value for prose and contributor notes. This records no
    /// check and makes no verification claim. Later mutation of the source value
    /// cannot change its serialized snapshot.
    pub fn observe<T: Serialize>(&mut self, id: &str, value: T) -> Result<Observed<T>> {
        let result = (|| {
            let reference = self.reserve(id, Kind::Observation)?;
            let mut observed = serde_json::to_value(value)
                .map_err(|e| format!("Cannot freeze observed value {id}: {e}"))?;
            // A host may enable preserve_order; canonicalize nested objects too.
            observed.sort_all_objects();
            self.document
                .observations
                .insert(id.into(), observed.clone());
            Ok(Observed {
                reference,
                observed,
                marker: PhantomData,
            })
        })();
        self.guarded(result)
    }

    pub fn require(&mut self, id: &str, condition: bool) -> Result<Claim> {
        let result = (|| {
            let reference = self.reserve(id, Kind::Claim)?;
            if !condition {
                return Err(format!("Claim {id} failed"));
            }
            self.document.checks.insert(
                id.into(),
                Check {
                    id: id.into(),
                    kind: "predicate".into(),
                    actual: Value::Bool(true),
                    expected: Value::Bool(true),
                },
            );
            Ok(Claim(reference))
        })();
        self.guarded(result)
    }

    pub fn resource(&mut self, id: &str, artifact: Artifact) -> Result<Resource> {
        let result = (|| {
            let reference = self.reserve(id, Kind::Resource)?;
            self.document.artifacts.insert(id.into(), artifact);
            Ok(Resource(reference))
        })();
        self.guarded(result)
    }

    /// Register a resource at a safe host-owned relative path. The complete
    /// renderer also rejects collisions across documents and generated pages.
    pub fn resource_at(&mut self, id: &str, artifact: Artifact, path: &str) -> Result<Resource> {
        let result = (|| {
            crate::paths::validate_resource_path(path)?;
            if self
                .document
                .resource_paths
                .values()
                .any(|existing| existing == path)
            {
                return Err(format!("Duplicate artifact path: {path}"));
            }
            let reference = self.reserve(id, Kind::Resource)?;
            self.document.resource_paths.insert(id.into(), path.into());
            self.document.artifacts.insert(id.into(), artifact);
            Ok(Resource(reference))
        })();
        self.guarded(result)
    }

    /// Register and place a text resource without replacing its producer metadata.
    /// The returned handle can be referenced or annotated again without executing
    /// the producer or copying the artifact into the document a second time.
    pub fn resource_code(
        &mut self,
        id: &str,
        artifact: Artifact,
        language: &str,
    ) -> Result<Resource> {
        let resource = self.resource(id, artifact)?;
        self.code(&resource, language)?;
        Ok(resource)
    }

    /// Freeze UTF-8 text with the built-in text producer.
    pub fn text(&mut self, id: &str, text: impl Into<String>) -> Result<Resource> {
        // Persisted encoder IDs remain stable across package renames, as for JSON below.
        let artifact = Artifact::new(
            text.into().into_bytes(),
            "text/plain",
            "txt",
            "executable-docs/text",
            "utf8-v1",
        );
        let artifact = self.guarded(artifact)?;
        self.resource(id, artifact)
    }

    /// Freeze a JSON value with the built-in deterministic JSON producer.
    pub fn json(&mut self, id: &str, value: &impl Serialize) -> Result<Resource> {
        let artifact = self.guarded(Artifact::json(value))?;
        self.resource(id, artifact)
    }

    pub fn text_code(
        &mut self,
        id: &str,
        text: impl Into<String>,
        language: &str,
    ) -> Result<Resource> {
        let resource = self.text(id, text)?;
        self.code(&resource, language)?;
        Ok(resource)
    }

    pub fn json_code(&mut self, id: &str, value: &impl Serialize) -> Result<Resource> {
        let resource = self.json(id, value)?;
        self.code(&resource, "json")?;
        Ok(resource)
    }

    pub fn embed(&mut self, resource: &Resource, caption: &str) -> Result<Block> {
        self.append(Content::Embed(resource.reference(), caption.into()))
    }

    pub fn code(&mut self, resource: &Resource, language: &str) -> Result<Block> {
        self.append(Content::Code(resource.reference(), language.into()))
    }

    fn validate_code_resource(&self, reference: &Reference, language: &str) -> Result<()> {
        self.validate_reference(reference)?;
        if reference.kind != Kind::Resource {
            return Err("Code content requires a resource reference".into());
        }
        if !language
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_+-".contains(&b))
        {
            return Err("Code language must be an ASCII identifier".into());
        }
        let artifact = &self.document.artifacts[&reference.id];
        if !(artifact.mime.starts_with("text/") || artifact.mime == "application/json") {
            return Err(format!(
                "Resource {} is not declared as text/JSON",
                reference.id
            ));
        }
        std::str::from_utf8(&artifact.bytes)
            .map_err(|_| format!("Resource {} is not UTF-8", reference.id))?;
        Ok(())
    }

    /// Freeze authored content and intrinsic references. Explanations and
    /// observations do not require checks; successful completion never invents
    /// verification evidence. Any failed operation still prevents finishing.
    /// Export validates layout-dependent resource ownership and local links against its complete
    /// bundle; finishing alone does not mean the document is publishable.
    pub fn finish(self) -> Result<Document> {
        if !self.errors.is_empty() {
            return Err(format!(
                "Document {} is tainted by failed operations: {}",
                self.document.id,
                self.errors.join("; ")
            ));
        }
        // Publication paths and cross-document links depend on the selected export layout.
        crate::validation::validate_document(&self.document)?;
        Ok(self.document)
    }
}

fn validate_code_placement(prose: &crate::model::Prose) -> Result<()> {
    use pulldown_cmark::{Event, Parser, Tag};
    if !prose.0.iter().any(|part| matches!(part, Inline::Code(..))) {
        return Ok(());
    }
    let mut template = String::new();
    let mut code_offsets = Vec::new();
    for part in &prose.0 {
        if matches!(part, Inline::Code(..)) {
            code_offsets.push(template.len());
        }
        template.push_str(match part {
            Inline::Text(text) => text,
            _ => "LGTMD_REFERENCE",
        });
    }
    for &offset in &code_offsets {
        let before = &template[..offset];
        let after = &template[offset + "LGTMD_REFERENCE".len()..];
        let separated = |text: &str| text.is_empty() || text.bytes().all(|byte| byte == b'\n');
        if !(separated(before) || before.ends_with("\n\n"))
            || !(separated(after) || after.starts_with("\n\n"))
        {
            return Err(
                "Code resource views must occupy their own blank-line-separated Markdown block"
                    .into(),
            );
        }
    }
    for (event, range) in Parser::new(&template).into_offset_iter() {
        if matches!(
            event,
            Event::Code(_) | Event::Start(Tag::CodeBlock(_) | Tag::HtmlBlock)
        ) && code_offsets.iter().any(|offset| range.contains(offset))
        {
            return Err(
                "Code resource views cannot be placed inside existing code or HTML syntax".into(),
            );
        }
    }
    Ok(())
}
