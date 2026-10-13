use lgtmd::{
    Audience, Doc, Document, ExportLayout,
    runner::{RunMode, RunnerConfig, run, run_cli_with},
};
use std::{cell::Cell, fs, path::Path};

fn guide() -> Vec<Document> {
    let mut doc = Doc::new("setup", "Setup").unwrap();
    let value = doc
        .expect_eq("trimmed", "  ready ".trim(), "ready")
        .unwrap();
    doc.paragraph(("Status: ", &value)).unwrap();
    let private = doc.text("internal", "not for readers").unwrap();
    doc.note(("Review ", &private)).unwrap();
    vec![doc.finish().unwrap()]
}

fn root() -> (tempfile::TempDir, std::path::PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().canonicalize().unwrap();
    (temp, path)
}

#[test]
fn configured_roots_and_nested_exports_work_without_project_discovery() {
    let (_temp, root) = root();
    let project = root.join("application");
    fs::create_dir(&project).unwrap();
    fs::write(project.join("owned-by-adopter"), "preserve").unwrap();
    let layout = ExportLayout::default()
        .page("setup", "handbook/start/index.md")
        .unwrap()
        .resources_under("evidence")
        .unwrap();
    let config = RunnerConfig::new(&project)
        .unwrap()
        .output(Audience::Reader, "published-manual", "site")
        .unwrap()
        .output(
            Audience::Contributor,
            root.join("private-review"),
            "review/internal",
        )
        .unwrap()
        .layout(layout);
    let calls = Cell::new(0);
    let generate = || {
        calls.set(calls.get() + 1);
        Ok(guide())
    };
    run_cli_with(["update"].map(str::to_owned), &config, generate).unwrap();
    assert_eq!(
        calls.get(),
        1,
        "both configured defaults reuse one execution"
    );
    run(
        &config,
        RunMode::Check,
        &[Audience::Reader, Audience::Contributor],
        generate,
    )
    .unwrap();
    run_cli_with(
        ["build", "--out", "review-candidate"].map(str::to_owned),
        &config,
        generate,
    )
    .unwrap();
    assert_eq!(calls.get(), 3);
    for directory in [
        project.join("published-manual"),
        project.join("review-candidate/site"),
    ] {
        assert!(directory.join("handbook/start/index.md").is_file());
        assert!(!directory.join("evidence/setup/internal.txt").exists());
        assert!(
            !fs::read_to_string(directory.join("manifest.json"))
                .unwrap()
                .contains("internal")
        );
    }
    assert!(
        root.join("private-review/evidence/setup/internal.txt")
            .is_file()
    );
    assert!(
        project
            .join("review-candidate/review/internal/evidence/setup/internal.txt")
            .is_file()
    );
    assert_eq!(
        fs::read_to_string(project.join("owned-by-adopter")).unwrap(),
        "preserve"
    );
    assert!(!project.join("reader").exists());
    assert!(!project.join("contributor").exists());
}

#[test]
fn single_audience_can_publish_directly_at_a_build_root() {
    let (_temp, root) = root();
    let config = RunnerConfig::new(&root)
        .unwrap()
        .output(Audience::Contributor, "retained", "")
        .unwrap();
    run_cli_with(
        ["build", "--out", "candidate"].map(str::to_owned),
        &config,
        || Ok(guide()),
    )
    .unwrap();
    assert!(root.join("candidate/setup.md").is_file());
    assert!(!root.join("candidate/contributor").exists());
}

#[test]
fn filesystem_root_is_a_valid_base_but_never_an_output() {
    let (_temp, root) = root();
    let filesystem_root = root.ancestors().last().unwrap();
    let config = RunnerConfig::new(filesystem_root)
        .unwrap()
        .output(Audience::Reader, root.join("retained"), "")
        .unwrap();
    assert_eq!(config.base_dir(), filesystem_root);
    run(
        &config,
        RunMode::Build(root.join("candidate")),
        &[Audience::Reader],
        || Ok(guide()),
    )
    .unwrap();
    let invoked = Cell::new(false);
    assert!(
        run(
            &config,
            RunMode::Build(filesystem_root.to_owned()),
            &[Audience::Reader],
            || {
                invoked.set(true);
                Ok(guide())
            }
        )
        .is_err()
    );
    assert!(!invoked.get());
}

#[test]
fn invalid_destination_selection_fails_before_user_generation() {
    let (_temp, root) = root();
    let config = RunnerConfig::new(&root)
        .unwrap()
        .output(Audience::Reader, "retained", "")
        .unwrap()
        .output(Audience::Contributor, "private", "review")
        .unwrap();
    let invoked = Cell::new(false);
    let generate = || {
        invoked.set(true);
        Ok(guide())
    };
    for (mode, audiences) in [
        (
            RunMode::Build("candidate".into()),
            vec![Audience::Reader, Audience::Contributor],
        ),
        (RunMode::Check, vec![Audience::Reader, Audience::Reader]),
        (RunMode::Check, vec![]),
        (
            RunMode::Build("private/candidate".into()),
            vec![Audience::Reader],
        ),
        (RunMode::Build("../outside".into()), vec![Audience::Reader]),
    ] {
        assert!(run(&config, mode, &audiences, generate).is_err());
        assert!(!invoked.get());
    }
    assert!(!root.join("candidate").exists());
    let overlapping = RunnerConfig::new(&root)
        .unwrap()
        .output(Audience::Reader, "retained", "site")
        .unwrap()
        .output(Audience::Contributor, "retained/private", "review")
        .unwrap();
    assert!(run(&overlapping, RunMode::Update, &[Audience::Reader], generate).is_err());
    assert!(!invoked.get());
    assert!(!root.join("retained").exists());
}

#[test]
fn invalid_candidate_directories_and_duplicate_configurations_reject() {
    let (_temp, root) = root();
    for path in ["../outside", "/absolute", "a/../b", "./current"] {
        assert!(
            RunnerConfig::new(&root)
                .unwrap()
                .output(Audience::Reader, "retained", Path::new(path))
                .is_err()
        );
    }
    assert!(
        RunnerConfig::new(&root)
            .unwrap()
            .output(Audience::Reader, "one", "one")
            .unwrap()
            .output(Audience::Reader, "two", "two")
            .is_err()
    );
}

#[test]
fn explicit_default_selection_does_not_publish_other_views() {
    let (_temp, root) = root();
    let config = RunnerConfig::new(&root)
        .unwrap()
        .output(Audience::Reader, "retained", "site")
        .unwrap()
        .output(Audience::Contributor, "private", "review")
        .unwrap()
        .default_audiences([Audience::Reader]);
    run_cli_with(["update"].map(str::to_owned), &config, || Ok(guide())).unwrap();
    assert!(root.join("retained/setup.md").exists());
    assert!(!root.join("private").exists());
    let missing = RunnerConfig::new(&root)
        .unwrap()
        .output(Audience::Reader, "retained", "site")
        .unwrap();
    let invoked = Cell::new(false);
    assert!(
        run_cli_with(
            ["check", "--audience", "contributor"].map(str::to_owned),
            &missing,
            || {
                invoked.set(true);
                Ok(guide())
            }
        )
        .is_err()
    );
    assert!(!invoked.get());
}

#[test]
fn builds_cannot_occupy_retained_transaction_paths() {
    let (_temporary, root) = root();
    let config = RunnerConfig::new(&root)
        .unwrap()
        .output(Audience::Reader, "manual", "")
        .unwrap();
    run(
        &config,
        RunMode::Update,
        &[Audience::Reader],
        || Ok(guide()),
    )
    .unwrap();
    for destination in [
        ".manual.lock",
        ".manual.staging",
        ".manual.backup",
        ".manual.staging/review",
        ".MANUAL.backup",
        ".MANUAL.backup/review",
    ] {
        let called = Cell::new(false);
        let error = run(
            &config,
            RunMode::Build(destination.into()),
            &[Audience::Reader],
            || {
                called.set(true);
                Ok(guide())
            },
        )
        .unwrap_err();
        assert!(error.contains("overlap"), "{destination}: {error}");
        assert!(!called.get(), "{destination}");
        assert!(!root.join(destination).exists(), "{destination}");
        run(&config, RunMode::Check, &[Audience::Reader], || Ok(guide())).unwrap();
    }
}

#[test]
fn configured_audiences_cannot_occupy_each_others_transaction_paths() {
    for reserved in [
        ".manual.lock",
        ".manual.staging",
        ".manual.backup",
        ".manual.backup/review",
    ] {
        for (reader, contributor) in [("manual", reserved), (reserved, "manual")] {
            let (_temporary, root) = root();
            let config = RunnerConfig::new(&root)
                .unwrap()
                .output(Audience::Reader, reader, "public")
                .unwrap()
                .output(Audience::Contributor, contributor, "internal")
                .unwrap();
            let called = Cell::new(false);
            let error = run(&config, RunMode::Update, &[Audience::Reader], || {
                called.set(true);
                Ok(guide())
            })
            .unwrap_err();
            assert!(error.contains("overlap"), "{error}");
            assert!(!called.get());
            assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        }
    }
}

#[test]
fn candidate_audience_paths_reserve_their_own_transaction_paths() {
    for reserved in [
        ".public.lock",
        ".public.staging",
        ".public.backup",
        ".public.backup/review",
    ] {
        let (_temporary, root) = root();
        let config = RunnerConfig::new(&root)
            .unwrap()
            .output(Audience::Reader, "manual", "public")
            .unwrap()
            .output(Audience::Contributor, "private", reserved)
            .unwrap();
        let called = Cell::new(false);
        let error = run(
            &config,
            RunMode::Build("candidate".into()),
            &[Audience::Reader, Audience::Contributor],
            || {
                called.set(true);
                Ok(guide())
            },
        )
        .unwrap_err();
        assert!(error.contains("overlap"), "{error}");
        assert!(!called.get());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
    }
}
