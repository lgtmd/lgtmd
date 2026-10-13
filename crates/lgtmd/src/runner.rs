//! Small project-owned runner: execute once, render before publishing, then verify.
use crate::{Audience, Document, ExportLayout, Result, lifecycle, render_with, store};
use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

const USAGE: &str = "Usage: check|update|build --out PATH [--audience reader|contributor|both]";

/// A project may call `run` directly without adopting the supplied CLI syntax.
#[derive(Clone, Debug)]
pub enum RunMode {
    Check,
    Update,
    Build(PathBuf),
    /// Build fresh trees at the explicitly configured audience output paths.
    /// Useful for hosts that choose each candidate path rather than a build root.
    BuildConfigured,
}

struct Options {
    mode: RunMode,
    audiences: Option<Vec<Audience>>,
}

#[derive(Clone, Debug)]
struct Output {
    audience: Audience,
    baseline: PathBuf,
    candidate_dir: PathBuf,
}

/// Caller-owned filesystem and export policy. No repository or Cargo discovery.
/// Relative baseline and build paths resolve against `base_dir`, captured once.
#[derive(Clone, Debug)]
pub struct RunnerConfig {
    base_dir: PathBuf,
    outputs: Vec<Output>,
    layout: ExportLayout,
    defaults: Option<Vec<Audience>>,
    protected_roots: Vec<PathBuf>,
}

impl RunnerConfig {
    pub fn new(base_dir: impl AsRef<Path>) -> Result<Self> {
        Ok(Self {
            base_dir: lifecycle::absolute_base(base_dir.as_ref())?,
            outputs: Vec::new(),
            layout: ExportLayout::default(),
            defaults: None,
            protected_roots: Vec::new(),
        })
    }

    /// Configure one retained tree and its relative directory under a build root.
    /// An empty candidate directory puts a single selected audience at that root.
    pub fn output(
        mut self,
        audience: Audience,
        baseline: impl Into<PathBuf>,
        candidate_dir: impl Into<PathBuf>,
    ) -> Result<Self> {
        if self
            .outputs
            .iter()
            .any(|output| output.audience == audience)
        {
            return Err(format!(
                "Duplicate configured audience: {}",
                audience_name(audience)
            ));
        }
        let candidate_dir = candidate_dir.into();
        if !candidate_dir.as_os_str().is_empty() {
            lifecycle::validate_path(
                candidate_dir
                    .to_str()
                    .ok_or("Candidate directory must be UTF-8")?,
            )?;
        }
        self.outputs.push(Output {
            audience,
            baseline: baseline.into(),
            candidate_dir,
        });
        Ok(self)
    }

    pub fn layout(mut self, layout: ExportLayout) -> Self {
        self.layout = layout;
        self
    }

    /// CLI default selection. Without this override, all configured outputs run.
    pub fn default_audiences(mut self, audiences: impl IntoIterator<Item = Audience>) -> Self {
        self.defaults = Some(audiences.into_iter().collect());
        self
    }

    pub fn base_dir(&self) -> &Path {
        &self.base_dir
    }

    fn resolve(&self, path: &Path) -> Result<PathBuf> {
        store::absolute(&self.base_dir.join(path))
    }
}

fn parse(args: impl IntoIterator<Item = String>) -> Result<Options> {
    let mut args = args.into_iter();
    let mode = args.next().ok_or(USAGE)?;
    if !matches!(mode.as_str(), "check" | "update" | "build") {
        return Err(USAGE.into());
    }
    let mut out = None;
    let mut selected = None;
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--out" if out.is_none() => {
                let value = args.next().ok_or("--out requires a directory")?;
                if value.is_empty() || value.starts_with("--") {
                    return Err("--out requires a directory".into());
                }
                out = Some(PathBuf::from(value));
            }
            "--audience" if selected.is_none() => {
                selected = Some(match args.next().as_deref() {
                    Some("reader") => vec![Audience::Reader],
                    Some("contributor") => vec![Audience::Contributor],
                    Some("both") => vec![Audience::Reader, Audience::Contributor],
                    _ => return Err("--audience requires reader, contributor, or both".into()),
                });
            }
            _ => {
                return Err(format!(
                    "Unknown or duplicate argument {argument:?}. {USAGE}"
                ));
            }
        }
    }
    let mode = match (mode.as_str(), out) {
        ("check", None) => RunMode::Check,
        ("update", None) => RunMode::Update,
        ("build", Some(out)) => RunMode::Build(out),
        ("build", None) => return Err("build requires --out PATH".into()),
        _ => return Err("--out is only valid for build".into()),
    };
    Ok(Options {
        mode,
        audiences: selected,
    })
}

fn audience_name(audience: Audience) -> &'static str {
    match audience {
        Audience::Reader => "reader",
        Audience::Contributor => "contributor",
    }
}

fn existing_ancestor(path: &Path) -> Result<(PathBuf, Vec<OsString>)> {
    let mut ancestor = path;
    let mut missing = Vec::new();
    while !ancestor.try_exists().map_err(|error| error.to_string())? {
        missing.push(
            ancestor
                .file_name()
                .ok_or("Output path has no existing ancestor")?
                .to_owned(),
        );
        ancestor = ancestor.parent().ok_or("Output path has no parent")?;
    }
    missing.reverse();
    Ok((ancestor.to_owned(), missing))
}

// Missing destinations have no filesystem identity yet. A fresh Contributor
// path must not alias a Reader path after its first publication. Existing
// prefixes establish real separation; otherwise require one pair of missing
// components to be distinct ASCII names even on a case-insensitive filesystem.
// Do not guess Unicode normalization/case equivalence: an ASCII distinguishing
// component or preexisting distinct directories keeps those paths usable. Names
// with trailing dots/spaces or DOS-short-name syntax are ambiguous too.
fn ensure_distinct_destinations(left: &Path, right: &Path) -> Result<()> {
    // A candidate at `.manual.backup` can disable checks of `manual`, and an
    // audience inside another audience's staging tree can collide during a later
    // update. Reserve the complete transaction namespace before any generation.
    ensure_distinct_paths(left, right)?;
    for reserved in lifecycle::transaction_paths(left)?.into_iter().skip(1) {
        ensure_distinct_paths(&reserved, right)?;
    }
    for reserved in lifecycle::transaction_paths(right)?.into_iter().skip(1) {
        ensure_distinct_paths(left, &reserved)?;
    }
    Ok(())
}

fn ensure_distinct_paths(left: &Path, right: &Path) -> Result<()> {
    lifecycle::ensure_separate_paths(left, right)?;
    let (left_parent, left_missing) = existing_ancestor(left)?;
    let (right_parent, right_missing) = existing_ancestor(right)?;
    if !same_file::is_same_file(left_parent, right_parent).map_err(|error| error.to_string())? {
        return Ok(());
    }
    if left_missing
        .iter()
        .zip(&right_missing)
        .any(|(left, right)| match (left.to_str(), right.to_str()) {
            (Some(left), Some(right))
                if [left, right].into_iter().all(|component| {
                    component.is_ascii()
                        && !component.ends_with(['.', ' '])
                        && !component.contains('~')
                }) =>
            {
                !left.eq_ignore_ascii_case(right)
            }
            _ => false,
        })
    {
        return Ok(());
    }
    Err(format!(
        "Output paths may overlap through filesystem aliases: {} and {}; use a distinct portable ASCII directory component or precreate distinct directories",
        left.display(),
        right.display()
    ))
}

/// Convenience wrapper retaining the original reader/contributor directory layout
/// and reader-only default. Arguments exclude the executable name.
pub fn run_cli(
    args: impl IntoIterator<Item = String>,
    baseline: &Path,
    generate: impl FnOnce() -> Result<Vec<Document>>,
) -> Result<()> {
    let mut config = RunnerConfig::new(std::env::current_dir().map_err(|e| e.to_string())?)?
        .output(Audience::Reader, baseline.join("reader"), "reader")?
        .output(
            Audience::Contributor,
            baseline.join("contributor"),
            "contributor",
        )?
        .default_audiences([Audience::Reader]);
    // The convenience API historically reserves its entire baseline root.
    // Explicit configurations reserve their individually configured trees.
    config.protected_roots.push(baseline.to_owned());
    run_cli_with(args, &config, generate)
}

/// Use caller-owned paths/layout with the optional standard CLI adapter.
pub fn run_cli_with(
    args: impl IntoIterator<Item = String>,
    config: &RunnerConfig,
    generate: impl FnOnce() -> Result<Vec<Document>>,
) -> Result<()> {
    let options = parse(args)?;
    let audiences = options.audiences.unwrap_or_else(|| {
        config.defaults.clone().unwrap_or_else(|| {
            config
                .outputs
                .iter()
                .map(|output| output.audience)
                .collect()
        })
    });
    run(config, options.mode, &audiences, generate)
}

/// Execute once and prepare every selected export before publishing anything.
/// Destinations are validated before generation. Each audience has an independent
/// transaction; a multi-audience update is not atomic.
pub fn run(
    config: &RunnerConfig,
    mode: RunMode,
    audiences: &[Audience],
    generate: impl FnOnce() -> Result<Vec<Document>>,
) -> Result<()> {
    if audiences.is_empty() {
        return Err("Select at least one configured audience".into());
    }
    let baselines = config
        .outputs
        .iter()
        .map(|output| config.resolve(&output.baseline))
        .collect::<Result<Vec<_>>>()?;
    for (index, path) in baselines.iter().enumerate() {
        for other in &baselines[..index] {
            ensure_distinct_destinations(path, other)?;
        }
    }
    let build_root = if let RunMode::Build(path) = &mode {
        let output = config.resolve(path)?;
        for baseline in &baselines {
            ensure_distinct_destinations(&output, baseline)?;
        }
        for protected in &config.protected_roots {
            ensure_distinct_destinations(&output, &config.resolve(protected)?)?;
        }
        if output.try_exists().map_err(|e| e.to_string())? {
            return Err(format!("Build root already exists: {}", output.display()));
        }
        Some(output)
    } else {
        None
    };
    let mut destinations: Vec<(Audience, PathBuf)> = Vec::new();
    for &audience in audiences {
        if destinations
            .iter()
            .any(|(selected, _)| *selected == audience)
        {
            return Err(format!(
                "Duplicate selected audience: {}",
                audience_name(audience)
            ));
        }
        let index = config
            .outputs
            .iter()
            .position(|output| output.audience == audience)
            .ok_or_else(|| format!("Audience is not configured: {}", audience_name(audience)))?;
        let path = match &build_root {
            Some(root) => store::absolute(&root.join(&config.outputs[index].candidate_dir))?,
            None => baselines[index].clone(),
        };
        for (_, other) in &destinations {
            ensure_distinct_destinations(&path, other)?;
        }
        if matches!(mode, RunMode::BuildConfigured)
            && path.try_exists().map_err(|e| e.to_string())?
        {
            return Err(format!(
                "Build destination already exists: {}",
                path.display()
            ));
        }
        destinations.push((audience, path));
    }
    let prepared = lifecycle::prepare(|| {
        let documents = generate()?;
        let mut prepared = Vec::new();
        for (audience, destination) in destinations {
            let name = audience_name(audience);
            let files = render_with(&documents, audience, &config.layout)
                .map_err(|error| format!("Render {name}: {error}"))?;
            prepared.push((name, destination, files));
        }
        Ok::<_, String>(prepared)
    })?;

    let mut completed = Vec::new();
    for (name, destination, files) in prepared {
        let result = match mode {
            RunMode::Check => store::check(&destination, &files),
            RunMode::Build(_) | RunMode::BuildConfigured => store::build(&destination, &files),
            RunMode::Update => store::update(&destination, &files),
        };
        if let Err(error) = result {
            let previous = if completed.is_empty() {
                String::new()
            } else {
                format!(
                    "; earlier audiences completed independently: {}",
                    completed.join(", ")
                )
            };
            return Err(format!("{name}: {error}{previous}"));
        }
        completed.push(name);
    }
    Ok(())
}
