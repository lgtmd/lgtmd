use crate::model::{Document, valid_id};
use crate::{Result, paths::validate_resource_path};
use std::collections::BTreeMap;

/// Bundle-relative Markdown paths, independent of a repository or build system.
///
/// Defaults preserve the ordinary `<document>.md` and
/// `assets/<document>/<resource>.<extension>` layout. Explicit
/// [`crate::Doc::resource_at`] paths remain relative to the bundle root and are
/// never prefixed or rewritten. `manifest.json` and `.ownership.json` (including
/// their subtrees) are reserved at the bundle root by the export protocol.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExportLayout {
    pages: String,
    resources: String,
    page_overrides: BTreeMap<String, String>,
}

impl Default for ExportLayout {
    fn default() -> Self {
        Self {
            pages: String::new(),
            resources: "assets".into(),
            page_overrides: BTreeMap::new(),
        }
    }
}

impl ExportLayout {
    /// Place default document pages under this bundle-relative directory.
    /// An empty string selects the bundle root. Overrides set by [`Self::page`]
    /// remain exact paths, independent of this prefix.
    pub fn pages_under(mut self, path: &str) -> Result<Self> {
        validate_directory(path)?;
        self.pages = path.into();
        Ok(self)
    }

    /// Place automatically named resources under this bundle-relative directory.
    /// An empty string selects the bundle root. Explicit resource paths are unchanged.
    pub fn resources_under(mut self, path: &str) -> Result<Self> {
        validate_directory(path)?;
        self.resources = path.into();
        Ok(self)
    }

    /// Set one document's exact bundle-relative page path. Duplicate assignments
    /// are errors, including identical assignments. Rendering rejects overrides
    /// for document IDs absent from the supplied bundle.
    pub fn page(mut self, document_id: &str, path: &str) -> Result<Self> {
        if !valid_id(document_id) {
            return Err(format!(
                "Invalid document ID in export layout: {document_id:?}"
            ));
        }
        validate_resource_path(path)?;
        if self.page_overrides.contains_key(document_id) {
            return Err(format!(
                "Duplicate page override for document: {document_id}"
            ));
        }
        self.page_overrides.insert(document_id.into(), path.into());
        Ok(self)
    }

    /// Resolve a document's page path without accessing a filesystem.
    pub fn page_path(&self, document_id: &str) -> String {
        self.page_overrides
            .get(document_id)
            .cloned()
            .unwrap_or_else(|| under(&self.pages, &format!("{document_id}.md")))
    }

    pub(crate) fn resource_path(&self, document: &Document, id: &str) -> String {
        document.resource_paths.get(id).cloned().unwrap_or_else(|| {
            under(
                &self.resources,
                &format!(
                    "{}/{}.{}",
                    document.id, id, document.artifacts[id].extension
                ),
            )
        })
    }

    pub(crate) fn validate_documents(&self, documents: &[Document]) -> Result<()> {
        for id in self.page_overrides.keys() {
            if !documents.iter().any(|document| &document.id == id) {
                return Err(format!("Page override names an unknown document: {id}"));
            }
        }
        Ok(())
    }
}

fn validate_directory(path: &str) -> Result<()> {
    if path.is_empty() {
        Ok(())
    } else {
        validate_resource_path(path)
    }
}

fn under(directory: &str, path: &str) -> String {
    if directory.is_empty() {
        path.into()
    } else {
        format!("{directory}/{path}")
    }
}
