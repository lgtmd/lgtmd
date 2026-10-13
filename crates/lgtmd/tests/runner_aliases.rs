use lgtmd::{
    Audience, Doc, Document,
    runner::{RunMode, RunnerConfig, run},
};
use std::{cell::Cell, fs, path::PathBuf};

fn root() -> (tempfile::TempDir, PathBuf) {
    let temporary = tempfile::tempdir().unwrap();
    let path = temporary.path().canonicalize().unwrap();
    (temporary, path)
}

fn guide() -> Vec<Document> {
    let mut doc = Doc::new("guide", "Guide").unwrap();
    doc.require("completed", true).unwrap();
    doc.paragraph("Public explanation").unwrap();
    let secret = doc.text("secret", "private evidence").unwrap();
    doc.note(("Contributor attachment: ", &secret)).unwrap();
    vec![doc.finish().unwrap()]
}

#[test]
fn missing_audience_aliases_fail_before_generation_in_either_order() {
    for (reader, contributor) in [
        ("Manual", "manual"),
        ("Manual", "manual/internal"),
        ("Reader", "Reader."),
        ("Reader", "Reader "),
        ("LongDirectory", "LONGDI~1"),
        ("caf\u{e9}", "cafe\u{301}"),
        ("\u{c5}", "\u{e5}"),
    ] {
        for audiences in [
            [Audience::Reader, Audience::Contributor],
            [Audience::Contributor, Audience::Reader],
        ] {
            let (_temporary, root) = root();
            let config = RunnerConfig::new(&root)
                .unwrap()
                .output(Audience::Reader, reader, "public")
                .unwrap()
                .output(Audience::Contributor, contributor, "internal")
                .unwrap();
            let invoked = Cell::new(false);
            let error = run(&config, RunMode::Update, &audiences, || {
                invoked.set(true);
                Ok(guide())
            })
            .unwrap_err();
            assert!(error.contains("overlap"), "{error}");
            assert!(!invoked.get());
            assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        }
    }
}

#[test]
fn candidate_aliases_and_unselected_baseline_aliases_fail_without_writes() {
    let (_temporary, root) = root();
    let config = RunnerConfig::new(&root)
        .unwrap()
        .output(Audience::Reader, "Manual", "Site")
        .unwrap()
        .output(Audience::Contributor, "Private", "site")
        .unwrap();
    for (destination, audiences) in [
        ("candidate", vec![Audience::Contributor, Audience::Reader]),
        ("manual/candidate", vec![Audience::Reader]),
        ("private/candidate", vec![Audience::Reader]),
    ] {
        let invoked = Cell::new(false);
        let error = run(
            &config,
            RunMode::Build(destination.into()),
            &audiences,
            || {
                invoked.set(true);
                Ok(guide())
            },
        )
        .unwrap_err();
        assert!(error.contains("overlap"), "{error}");
        assert!(!invoked.get());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
    }
}

#[test]
fn existing_unicode_parents_and_ascii_discriminators_support_unicode_paths() {
    let (_temporary, root) = root();
    let project = root.join("\u{51fa}\u{7248}\u{793e}");
    fs::create_dir(&project).unwrap();
    let config = RunnerConfig::new(&project)
        .unwrap()
        .output(
            Audience::Reader,
            "public/\u{516c}\u{958b}",
            "public/\u{516c}\u{958b}",
        )
        .unwrap()
        .output(
            Audience::Contributor,
            "private/\u{5185}\u{90e8}",
            "private/\u{5185}\u{90e8}",
        )
        .unwrap();
    run(
        &config,
        RunMode::Update,
        &[Audience::Contributor, Audience::Reader],
        || Ok(guide()),
    )
    .unwrap();
    assert!(project.join("public/\u{516c}\u{958b}/guide.md").is_file());
    assert!(
        !project
            .join("public/\u{516c}\u{958b}/assets/guide/secret.txt")
            .exists()
    );
    assert!(
        project
            .join("private/\u{5185}\u{90e8}/assets/guide/secret.txt")
            .is_file()
    );
}

#[test]
fn precreated_distinct_directories_prove_separation_without_ascii_names() {
    let (_temporary, root) = root();
    let reader = root.join("\u{516c}\u{958b}");
    let contributor = root.join("\u{5185}\u{90e8}");
    fs::create_dir(&reader).unwrap();
    fs::create_dir(&contributor).unwrap();
    assert!(!same_file::is_same_file(&reader, &contributor).unwrap());
    let config = RunnerConfig::new(&root)
        .unwrap()
        .output(Audience::Reader, reader.join("output"), "public")
        .unwrap()
        .output(Audience::Contributor, contributor.join("output"), "private")
        .unwrap();
    run(
        &config,
        RunMode::Update,
        &[Audience::Contributor, Audience::Reader],
        || Ok(guide()),
    )
    .unwrap();
    assert!(reader.join("output/guide.md").is_file());
    assert!(!reader.join("output/assets/guide/secret.txt").exists());
    assert!(contributor.join("output/assets/guide/secret.txt").is_file());
}

#[test]
fn distinct_existing_ancestor_and_descendant_can_own_separate_missing_branches() {
    let (_temporary, root) = root();
    fs::create_dir(root.join("existing")).unwrap();
    let config = RunnerConfig::new(&root)
        .unwrap()
        .output(Audience::Reader, "public", "site")
        .unwrap()
        .output(Audience::Contributor, "existing/private", "review")
        .unwrap();
    run(
        &config,
        RunMode::Update,
        &[Audience::Reader, Audience::Contributor],
        || Ok(guide()),
    )
    .unwrap();
    assert!(root.join("public/guide.md").is_file());
    assert!(root.join("existing/private/guide.md").is_file());
}

#[test]
fn existing_case_distinctions_follow_filesystem_identity() {
    let (_temporary, root) = root();
    let upper = root.join("Existing");
    let lower = root.join("existing");
    fs::create_dir(&upper).unwrap();
    let aliases = lower.exists();
    if !aliases {
        fs::create_dir(&lower).unwrap();
    }
    let config = RunnerConfig::new(&root)
        .unwrap()
        .output(Audience::Reader, upper.join("Manual"), "site")
        .unwrap()
        .output(Audience::Contributor, lower.join("manual"), "review")
        .unwrap();
    let invoked = Cell::new(false);
    let result = run(
        &config,
        RunMode::Update,
        &[Audience::Contributor, Audience::Reader],
        || {
            invoked.set(true);
            Ok(guide())
        },
    );
    if aliases {
        assert!(result.unwrap_err().contains("overlap"));
        assert!(!invoked.get());
        assert!(!upper.join("Manual").exists());
    } else {
        result.unwrap();
        assert!(invoked.get());
        assert!(upper.join("Manual/guide.md").is_file());
        assert!(!upper.join("Manual/assets/guide/secret.txt").exists());
        assert!(lower.join("manual/assets/guide/secret.txt").is_file());
    }
}
