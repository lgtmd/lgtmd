//! The host owns its project root, fixtures, audience destinations and export layout.
//! Run: configured PROJECT_ROOT BASELINE_ROOT check|update|build [SDK options]
//! PROJECT_ROOT contains fixtures/ports.txt with two nonzero ports, one per line.
use lgtmd::{
    Audience, Doc, Document, ExportLayout, Result, prose,
    runner::{RunnerConfig, run_cli_with},
};
use std::path::Path;

fn main() {
    if let Err(error) = execute() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn execute() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let usage = "Usage: configured PROJECT_ROOT BASELINE_ROOT check|update|build [SDK options]";
    let project = args.next().ok_or(usage)?;
    let baseline = args.next().ok_or(usage)?;
    let project = Path::new(&project)
        .canonicalize()
        .map_err(|error| format!("Cannot resolve the project root: {error}"))?;
    let config = configuration(&project, Path::new(&baseline))?;
    run_cli_with(args, &config, || guide(&project))
}

fn configuration(project: &Path, baseline: &Path) -> Result<RunnerConfig> {
    let layout = ExportLayout::default()
        .pages_under("handbook")?
        .resources_under("downloads/evidence")?
        .page("ports", "manual/network/index.md")?;
    Ok(RunnerConfig::new(project)?
        .output(Audience::Reader, baseline.join("published"), "website")?
        .output(
            Audience::Contributor,
            baseline.join("review-notes"),
            "maintainers",
        )?
        .layout(layout))
}

fn guide(project: &Path) -> Result<Vec<Document>> {
    let text = std::fs::read_to_string(project.join("fixtures/ports.txt"))
        .map_err(|error| format!("Cannot read the project's ports fixture: {error}"))?;
    let ports: Vec<u16> = text
        .lines()
        .map(|line| line.parse::<u16>().map_err(|error| error.to_string()))
        .collect::<Result<_>>()?;
    let mut doc = Doc::new("ports", "Read configured ports")?;
    let count = doc.expect_eq("fixture-port-count", ports.len(), 2)?;
    doc.require("ports-are-nonzero", ports.iter().all(|port| *port != 0))?;
    doc.paragraph(prose!(
        "The fixture supplies {count} nonzero ports.",
        count = &count
    )?)?;
    let input = doc.text_code("input", text, "text")?;
    doc.paragraph(("Download ", &input, " to reuse the fixture."))?;
    let observation = doc.json("private-observation", &ports)?;
    doc.note_on(
        &input,
        (
            "The private parsed-port observation is ",
            &observation,
            ". It is included only in contributor exports.",
        ),
    )?;

    let mut overview = Doc::new("overview", "Fixture contract")?;
    overview.require("fixture-was-parsed", !ports.is_empty())?;
    overview.paragraph("This project reads its own fixture before composing the documents.")?;
    Ok(vec![doc.finish()?, overview.finish()?])
}

#[cfg(test)]
mod tests {
    use super::*;
    use lgtmd::{lifecycle, runner::RunMode, runner::run};
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn project_layout_and_audience_destinations_are_host_owned() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().canonicalize().unwrap();
        let project = root.join("source-only-project");
        let baseline = root.join("external-publisher/retained");
        std::fs::create_dir_all(project.join("fixtures")).unwrap();
        std::fs::create_dir_all(&baseline).unwrap();
        std::fs::write(project.join("fixtures/ports.txt"), "8080\n9090\n").unwrap();
        std::fs::write(baseline.join("publisher-owned.txt"), "Keep this file.\n").unwrap();
        let config = configuration(&project, &baseline).unwrap();
        let audiences = [Audience::Reader, Audience::Contributor];
        let executions = AtomicUsize::new(0);
        let generate = || {
            executions.fetch_add(1, Ordering::SeqCst);
            guide(&project)
        };

        run(&config, RunMode::Update, &audiences, generate).unwrap();
        assert_eq!(executions.load(Ordering::SeqCst), 1);
        run(&config, RunMode::Check, &audiences, generate).unwrap();
        let candidate = root.join("separate-review-output");
        run(
            &config,
            RunMode::Build(candidate.clone()),
            &audiences,
            generate,
        )
        .unwrap();
        assert_eq!(executions.load(Ordering::SeqCst), 3);

        let reader = lifecycle::read_tree(&candidate.join("website")).unwrap();
        let contributor = lifecycle::read_tree(&candidate.join("maintainers")).unwrap();
        assert!(reader.contains_key("manual/network/index.md"));
        assert!(reader.contains_key("handbook/overview.md"));
        assert!(reader.contains_key("downloads/evidence/ports/input.txt"));
        assert!(
            !reader
                .keys()
                .any(|path| path.contains("private-observation"))
        );
        assert!(
            contributor
                .keys()
                .any(|path| path.contains("private-observation"))
        );
        for (name, files) in [("published", reader), ("review-notes", contributor)] {
            assert_eq!(files, lifecycle::read_tree(&baseline.join(name)).unwrap());
            for bytes in files.values() {
                let text = String::from_utf8_lossy(bytes);
                assert!(!text.contains(root.to_str().unwrap()));
            }
        }
        assert_eq!(
            std::fs::read_to_string(baseline.join("publisher-owned.txt")).unwrap(),
            "Keep this file.\n"
        );
        assert!(!project.join("Cargo.toml").exists());
        assert!(!project.join(".git").exists());
        assert!(!candidate.join("reader").exists());
        assert!(!candidate.join("contributor").exists());
    }
}
