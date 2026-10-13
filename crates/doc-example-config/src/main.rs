use config_demo::Config;
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::ExitCode;

const USAGE: &str = "Usage: config-demo INPUT.json --output OUTPUT.json";

fn main() -> ExitCode {
    match run(std::env::args_os().skip(1).collect()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::from(2)
        }
    }
}

fn run(arguments: Vec<OsString>) -> Result<(), String> {
    if arguments.len() == 1 && arguments[0] == "--help" {
        println!("{USAGE}");
        println!("Validate a configuration and save it only when its port is valid.");
        return Ok(());
    }
    if arguments.len() != 3 || arguments[1] != "--output" {
        return Err(USAGE.to_owned());
    }
    let input = PathBuf::from(&arguments[0]);
    let output = PathBuf::from(&arguments[2]);
    let config =
        Config::load(&input).map_err(|error| format!("Configuration rejected: {error}"))?;
    config
        .save(&output)
        .map_err(|error| format!("Configuration not saved: {error}"))?;
    println!(
        "Saved validated configuration (port {}) to {}.",
        config.port,
        output.display()
    );
    Ok(())
}
