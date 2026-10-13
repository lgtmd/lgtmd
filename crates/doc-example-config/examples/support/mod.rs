use config_demo::Config;
use lgtmd::{Artifact, Doc, Document, Result};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

/// Resolve a built CLI without knowing the repository or target directory.
pub fn locate_cli() -> Result<PathBuf> {
    if let Some(binary) = std::env::var_os("CONFIG_DEMO_BIN") {
        return fs::canonicalize(binary)
            .map_err(|error| format!("CONFIG_DEMO_BIN could not be resolved: {error}"));
    }
    let example = std::env::current_exe().map_err(|error| error.to_string())?;
    let directory = example
        .parent()
        .and_then(Path::parent)
        .ok_or("could not locate the example's build directory")?;
    let binary = directory.join(format!("config-demo{}", std::env::consts::EXE_SUFFIX));
    if !binary.is_file() {
        return Err("Build the actual CLI with `cargo build -p doc-example-config --bin config-demo`, or set CONFIG_DEMO_BIN to its path.".into());
    }
    Ok(binary)
}

/// Author prose beside the operations and checks which support its promises.
pub fn guide(binary: &Path) -> Result<Vec<Document>> {
    // Resolve before changing the child's directory. Some emulated hosts report
    // a missing executable as child exit 127 instead of a process-spawn error.
    let binary = fs::canonicalize(binary).map_err(|error| {
        format!(
            "could not run the config-demo CLI at {}: {error}",
            binary.display()
        )
    })?;
    let directory = tempfile::tempdir().map_err(|error| error.to_string())?;
    let output_path = directory.path().join("settings.json");
    let mut doc = Doc::new("configure-a-port", "Save a valid configuration")?;

    doc.markdown(
        r#"Use **config-demo** to validate a JSON configuration before saving it.
The command reports a useful error when a value is invalid and keeps the last
valid output available while you correct the input.

This walkthrough shows how to:

- Save a valid configuration.
- Reject an invalid replacement without changing the saved file.
- Correct the input and retry successfully.

Run the commands from a scratch directory so that `input.json` and
`settings.json` stay together."#,
    )?;
    let default_port = doc.expect_eq("default-port", Config::default().port, 8080)?;
    doc.paragraph((
        "The configuration contains one setting: port. Choose an integer from 1 to 65535. The Rust API's default configuration uses port ",
        &default_port,
        ". The command line reads an explicit configuration file; it does not fill in a missing port.",
    ))?;
    doc.note("This guide exercises the public Config API and the built config-demo executable in an isolated temporary directory. No server is started; the example checks configuration behavior.")?;

    doc.heading(2, "Save a configuration")?;
    let valid_input = b"{\n  \"port\": 9090\n}\n";
    write_fixture(directory.path(), "input.json", valid_input)?;
    let valid_source = doc.resource("valid-input", json_artifact(valid_input.to_vec())?)?;
    doc.paragraph("Create input.json with this content:")?;
    doc.code(&valid_source, "json")?;

    let successful = invoke(&binary, directory.path(), "input.json")?;
    doc.require("successful-exit", successful.output.status.success())?;
    doc.require(
        "successful-stderr-empty",
        successful.output.stderr.is_empty(),
    )?;
    let success_transcript = doc.resource(
        "successful-command",
        text_artifact(successful.transcript.into_bytes())?,
    )?;
    doc.paragraph("Pass the input file and an output path. A successful command saves the validated configuration:")?;
    doc.code(&success_transcript, "text")?;

    let saved_bytes = fs::read(&output_path).map_err(|error| error.to_string())?;
    let saved = Config::load(&output_path).map_err(|error| error.to_string())?;
    let saved_port = doc.expect_eq("saved-port", saved.port, 9090)?;
    let saved_artifact =
        doc.resource("saved-configuration", json_artifact(saved_bytes.clone())?)?;
    doc.paragraph((
        "The saved settings.json now contains port ",
        &saved_port,
        ". Its contents are shown below, and you can also open the ",
        &saved_artifact,
        " file directly.",
    ))?;
    doc.code(&saved_artifact, "json")?;

    doc.heading(2, "Reject an invalid replacement")?;
    doc.paragraph("A rejected input leaves an existing output unchanged. To see this, replace input.json with an invalid port:")?;
    let invalid_input = b"{\n  \"port\": 0\n}\n";
    write_fixture(directory.path(), "input.json", invalid_input)?;
    let invalid_source = doc.resource("invalid-input", json_artifact(invalid_input.to_vec())?)?;
    doc.code(&invalid_source, "json")?;

    let rejected = invoke(&binary, directory.path(), "input.json")?;
    let rejection_code = doc.expect_eq("rejected-exit", rejected.exit_code, 2)?;
    doc.require("rejected-stdout-empty", rejected.output.stdout.is_empty())?;
    doc.require(
        "rejection-explains-port-range",
        String::from_utf8_lossy(&rejected.output.stderr)
            .contains("port must be between 1 and 65535 (received 0)"),
    )?;
    let after_rejection = fs::read(&output_path).map_err(|error| error.to_string())?;
    let preservation = doc.require("rejected-output-unchanged", after_rejection == saved_bytes)?;
    let rejection_transcript = doc.resource(
        "rejected-command",
        text_artifact(rejected.transcript.into_bytes())?,
    )?;
    doc.paragraph("Run the same command again. The error explains which value needs correction:")?;
    doc.code(&rejection_transcript, "text")?;
    doc.paragraph((
        "The command exits unsuccessfully and preserves every byte of settings.json. The ",
        &saved_artifact,
        " from the first command is still the current configuration.",
    ))?;
    doc.note_on(
        &rejection_code,
        "The CLI's rejection status is 2. The scenario also checks that rejected input produces no success output.",
    )?;
    doc.note_on(
        &preservation,
        "The preservation check compares the complete output bytes before and after the rejected subprocess invocation.",
    )?;

    doc.heading(2, "Correct the input and retry")?;
    doc.paragraph("Change the port in input.json to 8080 and rerun the command. The same output path can now be replaced with a valid configuration:")?;
    let recovery_input = b"{\n  \"port\": 8080\n}\n";
    write_fixture(directory.path(), "input.json", recovery_input)?;
    let recovered = invoke(&binary, directory.path(), "input.json")?;
    doc.require("recovery-exit", recovered.output.status.success())?;
    doc.require("recovery-stderr-empty", recovered.output.stderr.is_empty())?;
    let recovery_config = Config::load(&output_path).map_err(|error| error.to_string())?;
    let recovered_port = doc.expect_eq("recovered-port", recovery_config.port, 8080)?;
    let recovery_transcript = doc.resource(
        "recovered-command",
        text_artifact(recovered.transcript.into_bytes())?,
    )?;
    doc.code(&recovery_transcript, "text")?;
    doc.paragraph((
        "The output now uses port ",
        &recovered_port,
        ". When validation fails, correct the input and retry; the last valid output remains available until the correction succeeds.",
    ))?;

    let diagnostics = serde_json::json!({
        "driver": "actual config-demo subprocess",
        "success_exit": successful.output.status.code(),
        "rejected_exit": rejected.output.status.code(),
        "recovery_exit": recovered.output.status.code(),
        "rejected_output_unchanged": after_rejection == saved_bytes,
        "saved_port": saved.port,
        "recovered_port": recovery_config.port,
    });
    let diagnostic_resource = doc.json("execution-checks", &diagnostics)?;
    doc.note_on(
        &rejection_transcript,
        (
            "The transcript comes from the actual command's stdout, stderr, and exit status. Review the ",
            &diagnostic_resource,
            " for the recorded outcomes. This contributor evidence is attached to the same reader artifact.",
        ),
    )?;

    Ok(vec![doc.finish()?])
}

fn write_fixture(directory: &Path, name: &str, bytes: &[u8]) -> Result<()> {
    fs::write(directory.join(name), bytes).map_err(|error| error.to_string())
}

struct Invocation {
    output: Output,
    exit_code: i32,
    transcript: String,
}

fn invoke(binary: &Path, directory: &Path, input: &str) -> Result<Invocation> {
    let arguments = [input, "--output", "settings.json"];
    let output = Command::new(binary)
        .current_dir(directory)
        .args(arguments)
        .output()
        .map_err(|error| format!("could not run the config-demo CLI: {error}"))?;
    let stdout = std::str::from_utf8(&output.stdout).map_err(|error| error.to_string())?;
    let stderr = std::str::from_utf8(&output.stderr).map_err(|error| error.to_string())?;
    let status = output
        .status
        .code()
        .ok_or("config-demo terminated without an exit code")?;
    // Only the executable's display name differs from the actual invocation.
    // Arguments and working-directory-relative paths are preserved verbatim.
    let transcript = format!(
        "$ config-demo {}\n{stdout}{stderr}[exit {status}]\n",
        arguments.join(" ")
    );
    Ok(Invocation {
        output,
        exit_code: status,
        transcript,
    })
}

fn json_artifact(bytes: Vec<u8>) -> Result<Artifact> {
    Artifact::new(bytes, "application/json", "json", "config-demo", "json-v1")
}

fn text_artifact(bytes: Vec<u8>) -> Result<Artifact> {
    Artifact::new(
        bytes,
        "text/plain",
        "txt",
        "config-demo-cli",
        "transcript-v1",
    )
}
