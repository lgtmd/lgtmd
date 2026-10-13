//! Versioned, language-neutral frozen document input. No callbacks or host state
//! cross this boundary. Compilation uses the same validation and exporters as
//! native Rust authoring; this is not the export inventory or a viewer schema.

use crate::{
    Artifact, Audience, BindingValue, Doc, Document, ExportLayout, Result, Target,
    lifecycle::Files,
    model::{Content, Inline, Kind, Prose, Reference},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Input {
    pub schema_version: u32,
    pub documents: Vec<FrozenDocument>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FrozenDocument {
    pub id: String,
    pub title: String,
    pub nodes: Vec<Node>,
    #[serde(default)]
    pub observations: Vec<Observation>,
    #[serde(default)]
    pub checks: Vec<Check>,
    #[serde(default)]
    pub resources: Vec<Resource>,
    #[serde(default)]
    pub bindings: Vec<Binding>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Observation {
    pub id: String,
    pub value: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Check {
    pub id: String,
    pub kind: String,
    pub passed: bool,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present_value"
    )]
    pub actual: Option<Value>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present_value"
    )]
    pub expected: Option<Value>,
}

fn present_value<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<Value>, D::Error> {
    Value::deserialize(deserializer).map(Some)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Resource {
    pub id: String,
    pub mime: String,
    pub extension: String,
    pub producer: String,
    pub profile: String,
    #[serde(default)]
    pub bytes: Vec<u8>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present_value"
    )]
    pub json: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Binding {
    pub id: String,
    pub value: BindingValue,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Ref {
    pub id: String,
    pub kind: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum Part {
    Text { text: String },
    Markdown { text: String },
    Reference { target: Ref },
    Image { target: Ref, label: String },
    Link { target: Ref, label: String },
    Code { target: Ref, language: String },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum Node {
    Heading {
        id: String,
        level: u8,
        text: String,
    },
    Paragraph {
        id: String,
        parts: Vec<Part>,
    },
    Markdown {
        id: String,
        parts: Vec<Part>,
    },
    #[serde(rename = "raw-markdown")]
    RawMarkdown {
        id: String,
        text: String,
    },
    Embed {
        id: String,
        target: Ref,
        label: String,
    },
    Code {
        id: String,
        target: Ref,
        language: String,
    },
    Note {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        target: Option<Ref>,
        parts: Vec<Part>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Layout {
    #[serde(default)]
    pub pages: String,
    #[serde(default = "default_resources")]
    pub resources: String,
    #[serde(default)]
    pub page_overrides: BTreeMap<String, String>,
}

fn default_resources() -> String {
    "assets".into()
}

impl Default for Layout {
    fn default() -> Self {
        Self {
            pages: String::new(),
            resources: default_resources(),
            page_overrides: BTreeMap::new(),
        }
    }
}

impl Layout {
    pub fn export_layout(&self) -> Result<ExportLayout> {
        let mut layout = ExportLayout::default()
            .pages_under(&self.pages)?
            .resources_under(&self.resources)?;
        for (id, path) in &self.page_overrides {
            layout = layout.page(id, path)?;
        }
        Ok(layout)
    }
}

/// Both audiences are prepared from one frozen input, before any publication.
#[derive(Serialize)]
pub struct Exports {
    pub reader: Files,
    pub contributor: Files,
}

pub fn compile(input: &Input, layout: &ExportLayout) -> Result<Exports> {
    let documents = input.thaw()?;
    Ok(Exports {
        reader: crate::render_with(&documents, Audience::Reader, layout)?,
        contributor: crate::render_with(&documents, Audience::Contributor, layout)?,
    })
}

impl Input {
    pub fn from_documents(documents: &[Document]) -> Result<Self> {
        Ok(Self {
            schema_version: 1,
            documents: documents
                .iter()
                .map(FrozenDocument::from_document)
                .collect::<Result<_>>()?,
        })
    }

    pub fn thaw(&self) -> Result<Vec<Document>> {
        if self.schema_version != 1 {
            return Err(format!(
                "Unsupported frozen document schema: {}",
                self.schema_version
            ));
        }
        self.documents
            .iter()
            .map(|document| {
                document
                    .thaw()
                    .map_err(|error| format!("Document {}: {error}", document.id))
            })
            .collect()
    }
}

// The JS common-value domain is explicit. Rust-only APIs retain their existing
// serde value domain; crossing the portable boundary rejects lossy integers.
fn portable_value(value: &Value) -> Result<()> {
    match value {
        Value::Number(number) => {
            const LIMIT: u64 = 9_007_199_254_740_991;
            if number.as_u64().is_some_and(|n| n > LIMIT)
                || number.as_i64().is_some_and(|n| n.unsigned_abs() > LIMIT)
                || number
                    .as_f64()
                    .is_some_and(|n| n.fract() == 0.0 && n.abs() > LIMIT as f64)
            {
                return Err(
                    "Portable JSON integers must be within JavaScript's safe integer range".into(),
                );
            }
        }
        Value::Array(values) => {
            for value in values {
                portable_value(value)?;
            }
        }
        Value::Object(values) => {
            for value in values.values() {
                portable_value(value)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn resolve(reference: &Ref, handles: &BTreeMap<String, Reference>) -> Result<Reference> {
    let handle = handles
        .get(&reference.id)
        .ok_or_else(|| format!("Missing reference: {}", reference.id))?;
    if serde_json::to_value(&handle.kind).map_err(|e| e.to_string())? != reference.kind {
        return Err(format!(
            "Wrong-kind reference: {} ({})",
            reference.id, reference.kind
        ));
    }
    Ok(handle.clone())
}

fn parts(parts: &[Part], handles: &BTreeMap<String, Reference>, markdown: bool) -> Result<Prose> {
    Ok(Prose(
        parts
            .iter()
            .map(|part| {
                Ok(match part {
                    Part::Text { text } => Inline::Text(if markdown {
                        crate::markdown::escape(text)
                    } else {
                        text.clone()
                    }),
                    Part::Markdown { text } => {
                        if !markdown {
                            return Err("Literal Markdown parts require a Markdown block".into());
                        }
                        Inline::Text(text.clone())
                    }
                    Part::Reference { target } => Inline::Reference(resolve(target, handles)?),
                    Part::Image { target, label } => {
                        let reference = resolve(target, handles)?;
                        if reference.kind != Kind::Resource {
                            return Err("Image target must be a resource".into());
                        }
                        Inline::Image(reference, label.clone())
                    }
                    Part::Link { target, label } => {
                        let reference = resolve(target, handles)?;
                        if !matches!(reference.kind, Kind::Resource | Kind::Block) {
                            return Err("Link target must be a resource or block".into());
                        }
                        Inline::Link(reference, label.clone())
                    }
                    Part::Code { target, language } => {
                        let reference = resolve(target, handles)?;
                        if reference.kind != Kind::Resource {
                            return Err("Code target must be a resource".into());
                        }
                        Inline::Code(reference, language.clone())
                    }
                })
            })
            .collect::<Result<_>>()?,
    ))
}

impl FrozenDocument {
    fn thaw(&self) -> Result<Document> {
        let mut doc = Doc::new(&self.id, &self.title)?;
        let mut handles = BTreeMap::new();
        for value in &self.observations {
            portable_value(&value.value)?;
            handles.insert(
                value.id.clone(),
                doc.observe(&value.id, &value.value)?.reference(),
            );
        }
        for check in &self.checks {
            if !check.passed {
                return Err(format!("Failed check: {}", check.id));
            }
            let handle = match check.kind.as_str() {
                "predicate" => {
                    if check.actual.is_some() || check.expected.is_some() {
                        return Err("Predicate check must not include equality payloads".into());
                    }
                    doc.require(&check.id, true)?.reference()
                }
                "equality" => {
                    let actual = check
                        .actual
                        .as_ref()
                        .ok_or("Equality check requires actual")?;
                    let expected = check
                        .expected
                        .as_ref()
                        .ok_or("Equality check requires expected")?;
                    portable_value(actual)?;
                    portable_value(expected)?;
                    doc.expect_eq(&check.id, actual, expected)?.reference()
                }
                other => return Err(format!("Unknown check kind: {other}")),
            };
            handles.insert(check.id.clone(), handle);
        }
        for binding in &self.bindings {
            handles.insert(
                binding.id.clone(),
                doc.binding(&binding.id, binding.value.clone())?.reference(),
            );
        }
        for resource in &self.resources {
            let artifact = if let Some(value) = &resource.json {
                if !resource.bytes.is_empty()
                    || resource.mime != "application/json"
                    || resource.extension != "json"
                    || resource.producer != "executable-docs/json"
                    || resource.profile != "json-pretty-v1"
                {
                    return Err("JSON resources require the canonical JSON producer and no competing byte payload".into());
                }
                portable_value(value)?;
                Artifact::json(value)?
            } else {
                Artifact::new(
                    resource.bytes.clone(),
                    &resource.mime,
                    &resource.extension,
                    &resource.producer,
                    &resource.profile,
                )?
            };
            let handle = match &resource.path {
                Some(path) => doc.resource_at(&resource.id, artifact, path)?,
                None => doc.resource(&resource.id, artifact)?,
            };
            handles.insert(resource.id.clone(), handle.reference());
        }
        for node in &self.nodes {
            let (id, content) = match node {
                Node::Heading { id, level, text } => {
                    let handle = doc.heading_with_id(id, *level, text)?;
                    handles.insert(id.clone(), handle.reference());
                    continue;
                }
                Node::Paragraph { id, parts: prose } => {
                    (id, Content::Paragraph(parts(prose, &handles, false)?))
                }
                Node::Markdown { id, parts: prose } => {
                    let prose = parts(prose, &handles, true)?;
                    crate::markdown::validate_markdown_parts(&prose)?;
                    (id, Content::MarkdownParts(prose))
                }
                Node::RawMarkdown { id, text } => {
                    crate::markdown::markdown_links(text)?;
                    (id, Content::Markdown(text.clone()))
                }
                Node::Embed { id, target, label } => {
                    let reference = resolve(target, &handles)?;
                    if reference.kind != Kind::Resource {
                        return Err("Embed target must be a resource".into());
                    }
                    (id, Content::Embed(reference, label.clone()))
                }
                Node::Code {
                    id,
                    target,
                    language,
                } => {
                    let reference = resolve(target, &handles)?;
                    if reference.kind != Kind::Resource {
                        return Err("Code target must be a resource".into());
                    }
                    (id, Content::Code(reference, language.clone()))
                }
                Node::Note {
                    id,
                    target,
                    parts: prose,
                } => (
                    id,
                    Content::Note {
                        target: target
                            .as_ref()
                            .map(|target| resolve(target, &handles))
                            .transpose()?,
                        prose: parts(prose, &handles, false)?,
                    },
                ),
            };
            let handle = doc
                .append_with_id(Some(id), content)
                .map_err(|error| format!("Block {id}: {error}"))?;
            handles.insert(id.clone(), handle.reference());
        }
        doc.finish()
    }

    fn from_document(document: &Document) -> Result<Self> {
        fn reference(reference: &Reference) -> Result<Ref> {
            Ok(Ref {
                id: reference.id.clone(),
                kind: serde_json::to_value(&reference.kind)
                    .map_err(|e| e.to_string())?
                    .as_str()
                    .ok_or("Invalid kind")?
                    .into(),
            })
        }
        fn prose(prose: &Prose, markdown: bool) -> Result<Vec<Part>> {
            prose
                .0
                .iter()
                .map(|part| {
                    Ok(match part {
                        Inline::Text(text) if markdown => Part::Markdown { text: text.clone() },
                        Inline::Text(text) => Part::Text { text: text.clone() },
                        Inline::Reference(target) => Part::Reference {
                            target: reference(target)?,
                        },
                        Inline::Image(target, label) => Part::Image {
                            target: reference(target)?,
                            label: label.clone(),
                        },
                        Inline::Link(target, label) => Part::Link {
                            target: reference(target)?,
                            label: label.clone(),
                        },
                        Inline::Code(target, language) => Part::Code {
                            target: reference(target)?,
                            language: language.clone(),
                        },
                    })
                })
                .collect()
        }
        let nodes = document
            .nodes
            .iter()
            .map(|node| {
                let id = node.id.clone();
                Ok(match &node.content {
                    Content::Heading(level, text) => Node::Heading {
                        id,
                        level: *level,
                        text: text.clone(),
                    },
                    Content::Paragraph(parts) => Node::Paragraph {
                        id,
                        parts: prose(parts, false)?,
                    },
                    Content::Markdown(text) => Node::RawMarkdown {
                        id,
                        text: text.clone(),
                    },
                    Content::MarkdownParts(parts) => Node::Markdown {
                        id,
                        parts: prose(parts, true)?,
                    },
                    Content::Embed(target, label) => Node::Embed {
                        id,
                        target: reference(target)?,
                        label: label.clone(),
                    },
                    Content::Code(target, language) => Node::Code {
                        id,
                        target: reference(target)?,
                        language: language.clone(),
                    },
                    Content::Note {
                        target,
                        prose: parts,
                    } => Node::Note {
                        id,
                        target: target.as_ref().map(reference).transpose()?,
                        parts: prose(parts, false)?,
                    },
                })
            })
            .collect::<Result<_>>()?;
        let result = Self {
            id: document.id.clone(),
            title: document.title.clone(),
            nodes,
            observations: document
                .observations
                .iter()
                .map(|(id, value)| Observation {
                    id: id.clone(),
                    value: value.clone(),
                })
                .collect(),
            checks: document
                .checks
                .values()
                .map(|check| Check {
                    id: check.id.clone(),
                    kind: check.kind.clone(),
                    passed: true,
                    actual: (check.kind == "equality").then(|| check.actual.clone()),
                    expected: (check.kind == "equality").then(|| check.expected.clone()),
                })
                .collect(),
            resources: document
                .artifacts
                .iter()
                .map(|(id, artifact)| Resource {
                    id: id.clone(),
                    bytes: artifact.bytes.clone(),
                    mime: artifact.mime.clone(),
                    extension: artifact.extension.clone(),
                    producer: artifact.producer.clone(),
                    profile: artifact.profile.clone(),
                    path: document.resource_paths.get(id).cloned(),
                    json: None,
                })
                .collect(),
            bindings: document
                .bindings
                .iter()
                .map(|(id, value)| Binding {
                    id: id.clone(),
                    value: value.clone(),
                })
                .collect(),
        };
        result.thaw()?;
        Ok(result)
    }
}
