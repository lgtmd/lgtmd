use config_demo::Config;
use std::fs;
use std::process::{Command, Output};

fn run(directory: &std::path::Path, input: &str) -> Output {
    Command::new(env!("CARGO_BIN_EXE_config-demo"))
        .current_dir(directory)
        .args([input, "--output", "settings.json"])
        .output()
        .unwrap()
}

#[test]
fn actual_cli_rejects_without_replacing_and_recovers_after_correction() {
    let directory = tempfile::tempdir().unwrap();
    let input = directory.path().join("input.json");
    let output = directory.path().join("settings.json");
    fs::write(&input, r#"{"port":9090}"#).unwrap();

    let success = run(directory.path(), "input.json");
    assert!(success.status.success());
    assert_eq!(Config::load(&output).unwrap().port, 9090);
    let original = fs::read(&output).unwrap();

    fs::write(&input, r#"{"port":0}"#).unwrap();
    let rejected = run(directory.path(), "input.json");
    assert_eq!(rejected.status.code(), Some(2));
    assert!(rejected.stdout.is_empty());
    assert!(
        String::from_utf8(rejected.stderr)
            .unwrap()
            .contains("port must be between 1 and 65535")
    );
    assert_eq!(fs::read(&output).unwrap(), original);

    fs::write(&input, r#"{"port":8080}"#).unwrap();
    let recovered = run(directory.path(), "input.json");
    assert!(recovered.status.success());
    assert_eq!(Config::load(&output).unwrap().port, 8080);
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 2);
}

#[test]
fn malformed_input_does_not_create_output() {
    let directory = tempfile::tempdir().unwrap();
    fs::write(directory.path().join("input.json"), "{unfinished").unwrap();
    let rejected = run(directory.path(), "input.json");
    assert_eq!(rejected.status.code(), Some(2));
    assert!(!directory.path().join("settings.json").exists());
}
