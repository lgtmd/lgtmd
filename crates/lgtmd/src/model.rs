//! Frozen document data, typed handles, and prose values.

use crate::{Artifact, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, marker::PhantomData};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Audience {
    Reader,
    Contributor,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Kind {
    Block,
    Claim,
    Value,
    Observation,
    Resource,
    Binding,
}

#[derive(Clone, Debug)]
pub struct Reference {
    pub(crate) owner: u64,
    pub(crate) id: String,
    pub(crate) kind: Kind,
}

/// A handle can only originate from this crate and the document that owns it.
pub trait Target: private::Sealed {
    #[doc(hidden)]
    fn reference(&self) -> Reference;
}

mod private {
    pub trait Sealed {}
}

macro_rules! handle {
    ($name:ident) => {
        #[derive(Clone, Debug)]
        pub struct $name(pub(crate) Reference);
        impl private::Sealed for $name {}
        impl Target for $name {
            fn reference(&self) -> Reference {
                self.0.clone()
            }
        }
        impl $name {
            pub fn id(&self) -> &str {
                &self.0.id
            }
        }
        impl IntoProse for &$name {
            fn into_prose(self) -> Prose {
                Prose(vec![Inline::Reference(self.reference())])
            }
        }
        impl IntoProse for $name {
            fn into_prose(self) -> Prose {
                (&self).into_prose()
            }
        }
    };
}

handle!(Block);
handle!(Claim);
handle!(Resource);
handle!(Binding);

impl Block {
    /// Link to this block with a reader-facing label. Reader content cannot link
    /// to contributor-only notes.
    pub fn link(&self, label: &str) -> Prose {
        Prose(vec![Inline::Link(self.reference(), label.into())])
    }
}

/// An observed application label, not a behavioral assertion. The host adapter
/// must establish that the control or canonical shortcut was actually observed.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    content = "value",
    rename_all = "lowercase",
    deny_unknown_fields
)]
pub enum BindingValue {
    Text(String),
    Code(String),
    Keys(Vec<String>),
}

impl Resource {
    /// Place this resource as an image inline. The owning builder checks its MIME.
    pub fn image(&self, alt: &str) -> Prose {
        Prose(vec![Inline::Image(self.reference(), alt.into())])
    }

    /// Link to this resource using a reader-facing label.
    pub fn link(&self, label: &str) -> Prose {
        Prose(vec![Inline::Link(self.reference(), label.into())])
    }

    /// Present a UTF-8 text or JSON resource as a fenced code block in Markdown
    /// parts. The view must occupy its own block, separated by blank lines.
    /// The owning builder validates the language and resource kind.
    pub fn code(&self, language: &str) -> Prose {
        Prose(vec![Inline::Code(self.reference(), language.into())])
    }
}

/// The serialized observation is frozen when the equality check succeeds.
#[derive(Clone, Debug)]
pub struct Checked<T> {
    pub(crate) reference: Reference,
    pub(crate) observed: Value,
    pub(crate) marker: PhantomData<fn() -> T>,
}

impl<T> Checked<T> {
    pub fn id(&self) -> &str {
        &self.reference.id
    }
    pub fn observed(&self) -> &Value {
        &self.observed
    }
}
impl<T> private::Sealed for Checked<T> {}
impl<T> Target for Checked<T> {
    fn reference(&self) -> Reference {
        self.reference.clone()
    }
}
impl<T> IntoProse for &Checked<T> {
    fn into_prose(self) -> Prose {
        Prose(vec![Inline::Reference(self.reference())])
    }
}
impl<T> IntoProse for Checked<T> {
    fn into_prose(self) -> Prose {
        (&self).into_prose()
    }
}

/// A serialized value frozen at registration, without a behavioral assertion.
/// Rendering this handle reports the observation; it never implies a check ran.
#[derive(Clone, Debug)]
pub struct Observed<T> {
    pub(crate) reference: Reference,
    pub(crate) observed: Value,
    pub(crate) marker: PhantomData<fn() -> T>,
}

impl<T> Observed<T> {
    pub fn id(&self) -> &str {
        &self.reference.id
    }
    pub fn observed(&self) -> &Value {
        &self.observed
    }
}
impl<T> private::Sealed for Observed<T> {}
impl<T> Target for Observed<T> {
    fn reference(&self) -> Reference {
        self.reference.clone()
    }
}
impl<T> IntoProse for &Observed<T> {
    fn into_prose(self) -> Prose {
        Prose(vec![Inline::Reference(self.reference())])
    }
}
impl<T> IntoProse for Observed<T> {
    fn into_prose(self) -> Prose {
        (&self).into_prose()
    }
}

#[derive(Clone, Debug)]
pub(crate) enum Inline {
    Text(String),
    Reference(Reference),
    Image(Reference, String),
    Link(Reference, String),
    Code(Reference, String),
}

#[derive(Clone, Debug)]
pub struct Prose(pub(crate) Vec<Inline>);

/// Text is escaped as literal prose; typed references are resolved by the owner.
/// Tuples permit mixed text and references without placeholder names.
pub trait IntoProse {
    fn into_prose(self) -> Prose;
}
impl IntoProse for Prose {
    fn into_prose(self) -> Prose {
        self
    }
}
impl IntoProse for &str {
    fn into_prose(self) -> Prose {
        Prose(vec![Inline::Text(self.into())])
    }
}
impl IntoProse for String {
    fn into_prose(self) -> Prose {
        Prose(vec![Inline::Text(self)])
    }
}
impl IntoProse for &String {
    fn into_prose(self) -> Prose {
        self.as_str().into_prose()
    }
}
impl<T: IntoProse> IntoProse for Vec<T> {
    fn into_prose(self) -> Prose {
        Prose(
            self.into_iter()
                .flat_map(|part| part.into_prose().0)
                .collect(),
        )
    }
}
macro_rules! tuple_prose {
    ($($ty:ident:$field:tt),+) => {
        impl<$($ty: IntoProse),+> IntoProse for ($($ty,)+) {
            fn into_prose(self) -> Prose {
                let mut parts = Vec::new();
                $(parts.extend(self.$field.into_prose().0);)+
                Prose(parts)
            }
        }
    };
}
tuple_prose!(A:0, B:1);
tuple_prose!(A:0, B:1, C:2);
tuple_prose!(A:0, B:1, C:2, D:3);
tuple_prose!(A:0, B:1, C:2, D:3, E:4);
tuple_prose!(A:0, B:1, C:2, D:3, E:4, F:5);
tuple_prose!(A:0, B:1, C:2, D:3, E:4, F:5, G:6);
tuple_prose!(A:0, B:1, C:2, D:3, E:4, F:5, G:6, H:7);

#[derive(Clone, Debug, Serialize)]
pub(crate) struct Check {
    pub id: String,
    pub kind: String,
    pub actual: Value,
    pub expected: Value,
}

#[derive(Clone, Debug)]
pub(crate) enum Content {
    Heading(u8, String),
    Paragraph(Prose),
    Markdown(String),
    MarkdownParts(Prose),
    Embed(Reference, String),
    Code(Reference, String),
    Note {
        target: Option<Reference>,
        prose: Prose,
    },
}

#[derive(Clone, Debug)]
pub(crate) struct Node {
    pub id: String,
    pub content: Content,
}

impl Node {
    pub(crate) fn is_note(&self) -> bool {
        matches!(self.content, Content::Note { .. })
    }
    pub(crate) fn references(&self) -> Vec<&Reference> {
        let mut refs = Vec::new();
        match &self.content {
            Content::Paragraph(prose)
            | Content::MarkdownParts(prose)
            | Content::Note { prose, .. } => {
                refs.extend(prose.0.iter().filter_map(|part| match part {
                    Inline::Reference(r)
                    | Inline::Image(r, _)
                    | Inline::Link(r, _)
                    | Inline::Code(r, _) => Some(r),
                    _ => None,
                }));
            }
            Content::Embed(r, _) | Content::Code(r, _) => refs.push(r),
            _ => {}
        }
        if let Content::Note {
            target: Some(target),
            ..
        } = &self.content
        {
            refs.push(target);
        }
        refs
    }
}

/// An immutable successfully completed scenario/document.
#[derive(Clone, Debug)]
pub struct Document {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) nodes: Vec<Node>,
    pub(crate) checks: BTreeMap<String, Check>,
    pub(crate) observations: BTreeMap<String, Value>,
    pub(crate) artifacts: BTreeMap<String, Artifact>,
    pub(crate) resource_paths: BTreeMap<String, String>,
    pub(crate) bindings: BTreeMap<String, BindingValue>,
}

impl Document {
    pub fn id(&self) -> &str {
        &self.id
    }
    pub fn render_many(
        documents: &[Self],
        audience: Audience,
    ) -> Result<BTreeMap<String, Vec<u8>>> {
        crate::render(documents, audience)
    }

    /// Export a complete bundle using project-selected page and resource paths.
    /// Checks ownership, audience visibility and links against the selected layout.
    pub fn render_many_with(
        documents: &[Self],
        audience: Audience,
        layout: &crate::ExportLayout,
    ) -> Result<BTreeMap<String, Vec<u8>>> {
        crate::render_with(documents, audience, layout)
    }

    /// Export this document as a complete bundle with a selected layout.
    pub fn render_with(
        &self,
        audience: Audience,
        layout: &crate::ExportLayout,
    ) -> Result<BTreeMap<String, Vec<u8>>> {
        Self::render_many_with(std::slice::from_ref(self), audience, layout)
    }

    /// Compose an existing host-owned Markdown page without adding a title or
    /// block anchors. The host must validate links against its complete bundle.
    /// Handles, resources, visibility and binding kinds remain strictly checked.
    pub fn render_fragment(&self, audience: Audience) -> Result<String> {
        crate::render::render_fragment(self, audience)
    }

    /// Copy the frozen resources referenced by this audience, keyed by export path.
    /// Fragment adapters must use the same audience for page text and resources.
    /// This adds no page or manifest and never reruns a resource producer.
    pub fn resource_files(&self, audience: Audience) -> Result<BTreeMap<String, Vec<u8>>> {
        crate::render::resource_files(self, audience)
    }
}

pub(crate) fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 100
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}
