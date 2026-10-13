//! Structured SDK manifest policy over the shared artifact lifecycle.
use crate::{
    Result,
    lifecycle::{self, Ownership},
    manifest::{Manifest, validate_tree},
};
pub use lifecycle::Files;
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};

pub(crate) fn absolute(path: &Path) -> Result<PathBuf> {
    lifecycle::absolute(path)
}

fn compatible(baseline: &Files, candidate: &Files) -> Result<()> {
    validate_tree(baseline, None)?;
    compatible_profiles(baseline, candidate)
}

fn compatible_update(
    baseline: &Files,
    candidate: &Files,
    missing_owned: &BTreeSet<String>,
) -> Result<()> {
    // Explicit retirement removes an old file before update. Its old receipt is
    // necessarily stale until this transaction publishes the complete new tree.
    // Only a missing old artifact absent from the candidate qualifies; changed
    // retained bytes, unrecorded files and missing retained files still fail.
    validate_tree(baseline, Some(candidate))?;
    // A removed file is intentional retirement only when both retained records
    // identify it. Phantom ownership entries must never be silently rewritten;
    // nor may retirement conceal omissions from the ownership marker.
    let old = Manifest::read(baseline)?;
    let mut retired = BTreeSet::new();
    for artifact in &old.artifacts {
        let path = artifact.path();
        if !baseline.contains_key(path) {
            retired.insert(path.to_owned());
        }
    }
    if &retired != missing_owned {
        return Err(format!(
            "Ownership inventory differs from retained manifest: missing owned {missing_owned:?}; retired artifacts {retired:?}"
        ));
    }
    compatible_profiles(baseline, candidate)
}

fn compatible_profiles(baseline: &Files, candidate: &Files) -> Result<()> {
    let old = Manifest::read(baseline)?;
    let new = Manifest::read(candidate)?;
    if old.audience != new.audience {
        return Err(format!(
            "Incompatible audience: baseline={:?}, candidate={:?}; use a separately reviewed baseline",
            old.audience, new.audience
        ));
    }
    // Compatibility belongs to retained resource identities, not the aggregate
    // profile set: new features may introduce a producer, and two retained
    // resources can swap profiles without changing that aggregate set.
    let previous = old.resource_profiles()?;
    let next = new.resource_profiles()?;
    for (identity, profile) in previous {
        if let Some(candidate) = next.get(&identity)
            && *candidate != profile
        {
            return Err(format!(
                "Incompatible producer/comparison profiles for {}/{}: baseline={profile:?}, candidate={candidate:?}; use a separately reviewed baseline",
                identity.0, identity.1,
            ));
        }
    }
    Ok(())
}

fn validate(files: &Files) -> Result<()> {
    validate_tree(files, None)
}

/// Read-only exact check with structured manifest compatibility.
pub fn check(path: &Path, files: &Files) -> Result<()> {
    validate(files)?;
    lifecycle::check(path, files, Ownership::Recorded, compatible)
}

/// Generate a new, independently owned candidate directory.
pub fn build(path: &Path, files: &Files) -> Result<()> {
    validate(files)?;
    lifecycle::build(path, files, Ownership::Recorded)
}

/// Replace a compatible owned baseline only after staging and validation.
pub fn update(path: &Path, files: &Files) -> Result<()> {
    validate(files)?;
    lifecycle::update_with_retirement(path, files, compatible_update)
}

/// Explicitly restore a complete valid backup when its destination is absent.
pub fn recover_backup(path: &Path) -> Result<()> {
    lifecycle::recover_backup(path, Ownership::Recorded, validate)
}
