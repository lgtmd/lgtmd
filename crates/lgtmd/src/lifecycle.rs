//! Shared exact artifact collection and filesystem publication.
//!
//! Dedicated trees retain their existing file format. Recorded trees add an
//! ownership inventory; neither policy changes application-specific manifests.
//!
//! Each destination publishes independently. Renames and rollback protect against
//! ordinary errors, but this is not a crash-atomic filesystem transaction. An
//! interrupted transaction leaves named recovery material and fails closed.
use crate::Result;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
};

pub type Files = BTreeMap<String, Vec<u8>>;
const OWNERSHIP: &str = ".ownership.json";

/// The adopter explicitly chooses whether its generated tree records ownership.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ownership {
    /// Every existing file belongs to the dedicated generated tree. Updates
    /// reject files absent from the candidate and write no additional metadata.
    Dedicated,
    /// A `.ownership.json` inventory distinguishes generated and unowned files.
    Recorded,
}

/// Finish all generation and validation before calling a publication operation.
/// This catches Rust panics, not process termination or side effects in user code.
pub fn prepare<T>(generate: impl FnOnce() -> Result<T>) -> Result<T> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(generate)).map_err(|payload| {
        let detail = payload
            .downcast_ref::<String>()
            .map(String::as_str)
            .or_else(|| payload.downcast_ref::<&str>().copied())
            .unwrap_or("unknown panic payload");
        format!("Documentation generation panicked; no output was published: {detail}")
    })?
}

/// Insert once, validating the application-owned relative output path.
pub fn insert(files: &mut Files, path: String, bytes: Vec<u8>) -> Result<()> {
    validate_path(&path)?;
    match files.entry(path) {
        std::collections::btree_map::Entry::Vacant(entry) => {
            entry.insert(bytes);
            Ok(())
        }
        std::collections::btree_map::Entry::Occupied(entry) => {
            Err(format!("Duplicate artifact owner: {}", entry.key()))
        }
    }
}

/// Check a complete registration inventory independently of output rendering.
pub fn check_inventory(expected: &BTreeSet<String>, current: &BTreeSet<String>) -> Result<()> {
    if expected == current {
        return Ok(());
    }
    Err(format!(
        "Artifact inventory differs. Missing: {:?}; unregistered: {:?}",
        expected.difference(current).collect::<Vec<_>>(),
        current.difference(expected).collect::<Vec<_>>()
    ))
}

/// Read a dedicated tree verbatim. Absent roots produce an empty inventory.
/// Ownership metadata, when present, is an ordinary file in this raw view.
/// A sibling writer lock or interrupted transaction prevents a partial read.
pub fn read_tree(path: &Path) -> Result<Files> {
    let transaction = Transaction::paths(path)?;
    transaction.readable()?;
    read_all(&transaction.target)
}

/// Compare the complete expected inventory and every byte with a retained tree.
/// Application-specific profile and format checks remain the caller's policy.
pub fn compare(expected: &Files, current: &Files) -> Result<()> {
    let keys: BTreeSet<_> = current.keys().chain(expected.keys()).collect();
    let changed: Vec<_> = keys
        .into_iter()
        .filter_map(|name| match (current.get(name), expected.get(name)) {
            (None, Some(_)) => Some(format!("missing {name}")),
            (Some(_), None) => Some(format!("extra {name}")),
            (Some(a), Some(b)) if a != b => Some(format!("changed {name}")),
            _ => None,
        })
        .collect();
    if changed.is_empty() {
        Ok(())
    } else {
        Err(format!("Documentation drift: {}", changed.join(", ")))
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct OwnershipRecord {
    schema_version: u32,
    files: Vec<String>,
}

fn io_error(action: &str, path: &Path, error: std::io::Error) -> String {
    format!("{action} {}: {error}", path.display())
}

/// Normalize an output path for adapter preflight without creating it.
/// Rejects parent traversal, filesystem roots, and existing symlink components.
/// Publication repeats these checks; this does not reserve the destination.
pub fn absolute(path: &Path) -> Result<PathBuf> {
    let clean = absolute_base(path)?;
    if clean.file_name().is_none() {
        return Err("An output directory must have a name; filesystem roots are forbidden".into());
    }
    Ok(clean)
}

// A path-resolution base may be the filesystem root; an output tree may not.
pub(crate) fn absolute_base(path: &Path) -> Result<PathBuf> {
    let full = if path.is_absolute() {
        path.to_owned()
    } else {
        std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join(path)
    };
    if full.components().any(|p| matches!(p, Component::ParentDir)) {
        return Err(format!(
            "Parent traversal is not allowed: {}",
            path.display()
        ));
    }
    let clean: PathBuf = full
        .components()
        .filter(|p| !matches!(p, Component::CurDir))
        .collect();
    no_symlinks(&clean)?;
    Ok(clean)
}

/// Reject overlapping output trees before generation, without creating paths.
/// Existing targets are compared with the other path's existing ancestors by
/// filesystem identity, so case aliases cannot hide a retained directory.
/// Missing targets have no identity yet and receive lexical checks only. This
/// preflight assumes a cooperative filesystem; it neither reserves paths nor
/// protects against another process changing their identity after the check.
pub fn ensure_separate_paths(left: &Path, right: &Path) -> Result<()> {
    let left = absolute(left)?;
    let right = absolute(right)?;
    let overlap = || {
        format!(
            "Output paths must not overlap: {} and {}",
            left.display(),
            right.display()
        )
    };
    if left.starts_with(&right) || right.starts_with(&left) {
        return Err(overlap());
    }
    for (target, other) in [(&left, &right), (&right, &left)] {
        if !exists(target)? {
            continue;
        }
        for ancestor in other.ancestors() {
            if exists(ancestor)?
                && same_file::is_same_file(target, ancestor)
                    .map_err(|error| io_error("Compare path identity", ancestor, error))?
            {
                return Err(overlap());
            }
        }
    }
    Ok(())
}

fn no_symlinks(path: &Path) -> Result<()> {
    let mut part = PathBuf::new();
    for component in path.components() {
        part.push(component.as_os_str());
        match fs::symlink_metadata(&part) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(format!(
                    "Symlinks are forbidden in output paths: {}",
                    part.display()
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(io_error("Inspect", &part, error)),
        }
    }
    Ok(())
}

fn exists(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(io_error("Inspect", path, error)),
    }
}

pub fn validate_path(key: &str) -> Result<()> {
    if key.is_empty()
        || key.contains('\\')
        || key
            .split('/')
            .any(|s| s.is_empty() || s == "." || s == "..")
        || Path::new(key)
            .components()
            .any(|p| !matches!(p, Component::Normal(_)))
    {
        return Err(format!("Unsafe or reserved output path: {key:?}"));
    }
    Ok(())
}

fn validate(files: &Files, ownership: Ownership) -> Result<()> {
    for key in files.keys() {
        validate_path(key)?;
        if ownership == Ownership::Recorded && key.split('/').next() == Some(OWNERSHIP) {
            return Err(format!("Reserved ownership path: {key}"));
        }
        let mut parent = Path::new(key).parent();
        while let Some(path) = parent.filter(|p| !p.as_os_str().is_empty()) {
            if files.contains_key(path.to_str().ok_or("Non UTF-8 output path")?) {
                return Err(format!(
                    "Output file conflicts with a parent directory: {key}"
                ));
            }
            parent = path.parent();
        }
    }
    Ok(())
}

fn owned_tree(path: &Path, ownership: Ownership) -> Result<Files> {
    let (files, missing) = owned_tree_inventory(path, ownership)?;
    require_complete_ownership(&missing)?;
    Ok(files)
}

fn require_complete_ownership(missing: &BTreeSet<String>) -> Result<()> {
    if let Some(name) = missing.first() {
        return Err(format!("Ownership inventory: missing {name}"));
    }
    Ok(())
}

fn owned_tree_inventory(path: &Path, ownership: Ownership) -> Result<(Files, BTreeSet<String>)> {
    if ownership == Ownership::Dedicated {
        return Ok((read_all(path)?, BTreeSet::new()));
    }
    no_symlinks(path)?;
    let marker = path.join(OWNERSHIP);
    no_symlinks(&marker)?;
    let bytes = fs::read(&marker).map_err(|e| io_error("Read ownership marker", &marker, e))?;
    let record: OwnershipRecord = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Invalid ownership marker {}: {e}", marker.display()))?;
    if record.schema_version != 1 {
        return Err("Unsupported ownership schema".into());
    }
    let mut expected = BTreeSet::new();
    for name in record.files {
        validate_path(&name)?;
        if name.split('/').next() == Some(OWNERSHIP) {
            return Err(format!("Reserved ownership path: {name}"));
        }
        if !expected.insert(name.clone()) {
            return Err(format!("Duplicate owned path: {name}"));
        }
    }
    let mut files = Files::new();
    visit(path, path, Some(&expected), &mut files)?;
    let missing = expected
        .into_iter()
        .filter(|name| !files.contains_key(name))
        .collect();
    Ok((files, missing))
}

fn visit(
    base: &Path,
    dir: &Path,
    expected: Option<&BTreeSet<String>>,
    files: &mut Files,
) -> Result<()> {
    no_symlinks(dir)?;
    for entry in fs::read_dir(dir).map_err(|e| io_error("Read directory", dir, e))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let full = entry.path();
        let name = inventory_path(full.strip_prefix(base).map_err(|e| e.to_string())?)?;
        let kind = entry
            .file_type()
            .map_err(|e| io_error("Inspect", &full, e))?;
        if kind.is_symlink() {
            return Err(format!("Output symlink is forbidden: {}", full.display()));
        }
        if kind.is_dir() {
            if let Some(expected) = expected
                && !expected.iter().any(|p| p.starts_with(&format!("{name}/")))
            {
                return Err(format!("Unowned output directory: {name}"));
            }
            visit(base, &full, expected, files)?;
        } else if kind.is_file() {
            if let Some(expected) = expected {
                if name == OWNERSHIP {
                    continue;
                }
                if !expected.contains(&name) {
                    return Err(format!("Unowned output file: {name}"));
                }
            }
            insert(
                files,
                name,
                fs::read(&full).map_err(|e| io_error("Read", &full, e))?,
            )?;
        } else {
            return Err(format!("Unsupported output file type: {}", full.display()));
        }
    }
    Ok(())
}

// Inventories use `/` on every host, while filesystem paths use the native
// separator. Convert components rather than replacing characters: a literal
// backslash in a Unix filename must still fail the output-path policy.
fn inventory_path(path: &Path) -> Result<String> {
    let name = path
        .components()
        .map(|component| match component {
            Component::Normal(name) => name.to_str().ok_or("Non UTF-8 output path"),
            _ => Err("Unexpected non-relative output path component"),
        })
        .collect::<std::result::Result<Vec<_>, _>>()?
        .join("/");
    validate_path(&name)?;
    Ok(name)
}

fn read_all(path: &Path) -> Result<Files> {
    no_symlinks(path)?;
    let mut files = Files::new();
    if exists(path)? {
        visit(path, path, None, &mut files)?;
    }
    Ok(files)
}

struct Transaction {
    target: PathBuf,
    lock: PathBuf,
    stage: PathBuf,
    backup: PathBuf,
    locked: bool,
}

// Each published tree reserves these sibling paths for its transaction. Runner
// preflight must keep other outputs out of all four locations, not just target.
pub(crate) fn transaction_paths(path: &Path) -> Result<[PathBuf; 4]> {
    let transaction = Transaction::paths(path)?;
    Ok([
        transaction.target.clone(),
        transaction.lock.clone(),
        transaction.stage.clone(),
        transaction.backup.clone(),
    ])
}

impl Transaction {
    fn paths(path: &Path) -> Result<Self> {
        let target = absolute(path)?;
        let name = target
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or("Non UTF-8 destination")?;
        let parent = target.parent().ok_or("Destination has no parent")?;
        Ok(Self {
            lock: parent.join(format!(".{name}.lock")),
            stage: parent.join(format!(".{name}.staging")),
            backup: parent.join(format!(".{name}.backup")),
            target,
            locked: false,
        })
    }

    fn acquire(path: &Path) -> Result<Self> {
        let mut transaction = Self::paths(path)?;
        let parent = transaction.target.parent().unwrap();
        fs::create_dir_all(parent).map_err(|e| io_error("Create output parent", parent, e))?;
        no_symlinks(parent)?;
        for path in [&transaction.lock, &transaction.stage, &transaction.backup] {
            no_symlinks(path)?;
        }
        let mut lock = OpenOptions::new().write(true).create_new(true).open(&transaction.lock)
            .map_err(|e| format!("Output lock unavailable at {}: {e}; inspect an interrupted run before removing a stale lock", transaction.lock.display()))?;
        if let Err(error) = writeln!(lock, "pid={}", std::process::id()) {
            let _ = fs::remove_file(&transaction.lock);
            return Err(io_error("Write output lock", &transaction.lock, error));
        }
        transaction.locked = true;
        Ok(transaction)
    }

    fn clean_state(&self) -> Result<()> {
        for path in [&self.stage, &self.backup] {
            no_symlinks(path)?;
            if exists(path)? {
                return Err(format!(
                    "Interrupted transaction material at {}; preserve and inspect it before retrying (recover_backup restores a valid backup only when the destination is absent)",
                    path.display()
                ));
            }
        }
        Ok(())
    }

    fn readable(&self) -> Result<()> {
        no_symlinks(&self.lock)?;
        if exists(&self.lock)? {
            return Err(format!(
                "Cannot check during an update or stale lock: {}",
                self.lock.display()
            ));
        }
        self.clean_state()
    }
}

impl Drop for Transaction {
    fn drop(&mut self) {
        if self.locked {
            let _ = fs::remove_file(&self.lock);
        }
    }
}

fn write_file(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| io_error("Create staged file", path, e))?;
    file.write_all(bytes)
        .map_err(|e| io_error("Write staged file", path, e))?;
    file.sync_all()
        .map_err(|e| io_error("Sync staged file", path, e))
}

fn stage(transaction: &Transaction, files: &Files, ownership: Ownership) -> Result<()> {
    fs::create_dir(&transaction.stage)
        .map_err(|e| io_error("Create staging directory", &transaction.stage, e))?;
    let result = (|| {
        for (name, bytes) in files {
            let file = transaction.stage.join(name);
            fs::create_dir_all(file.parent().unwrap())
                .map_err(|e| io_error("Create staged directory", &file, e))?;
            write_file(&file, bytes)?;
        }
        if ownership == Ownership::Recorded {
            let marker = serde_json::to_vec_pretty(&OwnershipRecord {
                schema_version: 1,
                files: files.keys().cloned().collect(),
            })
            .map_err(|e| e.to_string())?;
            write_file(&transaction.stage.join(OWNERSHIP), &marker)?;
        }
        if owned_tree(&transaction.stage, ownership)? != *files {
            return Err("Staged output did not match the validated candidate".into());
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&transaction.stage);
    }
    result
}

/// Compare a complete retained output without modifying it or creating a lock.
/// The callback receives (retained, candidate) before exact byte comparison.
pub fn check(
    path: &Path,
    files: &Files,
    ownership: Ownership,
    validate_current: impl FnOnce(&Files, &Files) -> Result<()>,
) -> Result<()> {
    validate(files, ownership)?;
    let transaction = Transaction::paths(path)?;
    transaction.readable()?;
    let current = owned_tree(&transaction.target, ownership)?;
    validate_current(&current, files)?;
    compare(files, &current)
}

/// Write a complete candidate into a new directory; never overwrite an existing one.
pub fn build(path: &Path, files: &Files, ownership: Ownership) -> Result<()> {
    validate(files, ownership)?;
    let transaction = Transaction::acquire(path)?;
    transaction.clean_state()?;
    if exists(&transaction.target)? {
        return Err(format!(
            "Build destination already exists: {}",
            transaction.target.display()
        ));
    }
    stage(&transaction, files, ownership)?;
    if let Err(error) = fs::rename(&transaction.stage, &transaction.target) {
        let _ = fs::remove_dir_all(&transaction.stage);
        return Err(io_error("Publish candidate", &transaction.target, error));
    }
    Ok(())
}

/// Validate and stage all output before replacing a compatible owned baseline.
pub fn update(
    path: &Path,
    files: &Files,
    ownership: Ownership,
    validate_current: impl FnOnce(&Files, &Files) -> Result<()>,
) -> Result<()> {
    update_inner(
        path,
        files,
        ownership,
        |current, candidate, missing| {
            require_complete_ownership(missing)?;
            validate_current(current, candidate)
        },
        || Ok(()),
    )
}

// The structured store can validate explicit retirement against its retained
// manifest. Generic lifecycle callers have no such evidence and remain strict.
pub(crate) fn update_with_retirement(
    path: &Path,
    files: &Files,
    validate_current: impl FnOnce(&Files, &Files, &BTreeSet<String>) -> Result<()>,
) -> Result<()> {
    update_inner(
        path,
        files,
        Ownership::Recorded,
        validate_current,
        || Ok(()),
    )
}

fn update_inner(
    path: &Path,
    files: &Files,
    ownership: Ownership,
    validate_current: impl FnOnce(&Files, &Files, &BTreeSet<String>) -> Result<()>,
    before_publish: impl FnOnce() -> Result<()>,
) -> Result<()> {
    validate(files, ownership)?;
    let transaction = Transaction::acquire(path)?;
    transaction.clean_state()?;
    let had_baseline = exists(&transaction.target)?;
    if had_baseline {
        let (current, missing) = owned_tree_inventory(&transaction.target, ownership)?;
        validate_current(&current, files, &missing)?;
        let obsolete: Vec<_> = current
            .keys()
            .filter(|name| !files.contains_key(*name))
            .collect();
        if !obsolete.is_empty() {
            return Err(format!(
                "Obsolete owned files require explicit removal before update: {obsolete:?}"
            ));
        }
    }
    stage(&transaction, files, ownership)?;
    if had_baseline && let Err(error) = fs::rename(&transaction.target, &transaction.backup) {
        let _ = fs::remove_dir_all(&transaction.stage);
        return Err(io_error(
            "Preserve baseline backup",
            &transaction.backup,
            error,
        ));
    }
    let publication = before_publish().and_then(|()| {
        fs::rename(&transaction.stage, &transaction.target)
            .map_err(|e| io_error("Publish baseline", &transaction.target, e))
    });
    if let Err(error) = publication {
        if had_baseline && let Err(rollback) = fs::rename(&transaction.backup, &transaction.target)
        {
            return Err(format!(
                "{error}; rollback failed: {rollback}; preserved backup: {}; staged candidate: {}",
                transaction.backup.display(),
                transaction.stage.display()
            ));
        }
        let _ = fs::remove_dir_all(&transaction.stage);
        return Err(error);
    }
    if had_baseline {
        fs::remove_dir_all(&transaction.backup).map_err(|e| {
            io_error(
                "Baseline published but backup cleanup failed; inspect preserved backup",
                &transaction.backup,
                e,
            )
        })?;
    }
    Ok(())
}

/// Explicit recovery for the unambiguous interrupted state with no destination.
/// An existing destination is never replaced, and staged candidates are retained.
pub fn recover_backup(
    path: &Path,
    ownership: Ownership,
    validate_backup: impl FnOnce(&Files) -> Result<()>,
) -> Result<()> {
    let transaction = Transaction::acquire(path)?;
    if exists(&transaction.target)? {
        return Err(
            "Recovery refused: destination exists; inspect it and the backup explicitly".into(),
        );
    }
    if !exists(&transaction.backup)? {
        return Err("Recovery refused: no preserved backup exists".into());
    }
    let backup = owned_tree(&transaction.backup, ownership)?;
    validate(&backup, ownership)?;
    validate_backup(&backup)?;
    fs::rename(&transaction.backup, &transaction.target)
        .map_err(|e| io_error("Restore preserved backup", &transaction.target, e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inventory_paths_join_native_components_with_portable_separators() {
        let native = Path::new("assets").join("guide").join("evidence.txt");
        assert_eq!(
            inventory_path(&native).unwrap(),
            "assets/guide/evidence.txt"
        );
        assert!(inventory_path(Path::new("../outside")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn inventory_paths_do_not_reinterpret_unix_backslash_filenames() {
        assert!(inventory_path(Path::new(r"assets\evidence.txt")).is_err());
    }

    #[test]
    fn failed_publication_restores_previous_baseline() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap().join("baseline");
        let mut before = Files::from([
            (
                "manifest.json".into(),
                br#"{"schema_version":1,"audience":"reader","profiles":[],"artifacts":[]}"#
                    .to_vec(),
            ),
            ("page.md".into(), b"before".to_vec()),
        ]);
        update(&root, &before, Ownership::Dedicated, |_, _| Ok(())).unwrap();
        let old = before.clone();
        before.insert("page.md".into(), b"after".to_vec());
        let error = update_inner(
            &root,
            &before,
            Ownership::Dedicated,
            |_, _, _| Ok(()),
            || Err("injected publish I/O failure".into()),
        )
        .unwrap_err();
        assert!(error.contains("injected"));
        check(&root, &old, Ownership::Dedicated, |_, _| Ok(())).unwrap();
        assert!(!root.parent().unwrap().join(".baseline.backup").exists());
        assert!(!root.parent().unwrap().join(".baseline.staging").exists());
    }
}
