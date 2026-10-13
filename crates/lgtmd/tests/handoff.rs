use lgtmd::{
    Doc,
    handoff::{self, Handoff},
};
use std::process::Command;

// Running a child test process keeps environment mutation out of parallel tests.
#[test]
fn rust_handoff_child() {
    if std::env::var_os("LGTMD_HANDOFF_CHILD").is_none() {
        return;
    }
    let mut doc = Doc::new("rust-flow", "Rust flow").unwrap();
    doc.paragraph("Completed after project cleanup.").unwrap();
    handoff::complete_run(&[doc.finish().unwrap()]).unwrap();
}
#[test]
fn handoff_is_versioned_frozen_and_exclusive() {
    let temp = tempfile::tempdir().unwrap();
    let output = temp.path().join("completed.json");
    let run = || {
        Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "rust_handoff_child"])
            .env("LGTMD_HANDOFF_CHILD", "1")
            .env("LGTMD_OUTPUT", &output)
            .env("LGTMD_RUN_ID", "isolated-run-token")
            .output()
            .unwrap()
    };
    let first = run();
    assert!(
        first.status.success(),
        "{}",
        String::from_utf8_lossy(&first.stdout)
    );
    let bytes = std::fs::read(&output).unwrap();
    let receipt: Handoff = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(receipt.schema_version, 1);
    assert_eq!(receipt.run_id, "isolated-run-token");
    assert_eq!(receipt.input.documents[0].id, "rust-flow");
    receipt.input.thaw().unwrap();
    assert!(!run().status.success());
    assert_eq!(std::fs::read(&output).unwrap(), bytes);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&output).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
