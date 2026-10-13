//! One request per process, never one request per authoring operation. The Node
//! facade owns execution; Rust owns compilation and the existing strict store.
use lgtmd::{
    Audience, Result,
    runner::{self, RunMode, RunnerConfig},
    transport::{self, Input, Layout},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    io::{self, Read},
    path::PathBuf,
};

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "lowercase", deny_unknown_fields)]
enum Request {
    Compile {
        input: Input,
        #[serde(default)]
        layout: Layout,
    },
    Publish {
        input: Input,
        command: String,
        reader: PathBuf,
        contributor: PathBuf,
        #[serde(default)]
        layout: Layout,
    },
}

fn execute(request: Request) -> Result<Value> {
    match request {
        Request::Compile { input, layout } => {
            let exports = transport::compile(&input, &layout.export_layout()?)?;
            serde_json::to_value(exports).map_err(|e| e.to_string())
        }
        Request::Publish {
            input,
            command,
            reader,
            contributor,
            layout,
        } => {
            let base = std::env::current_dir().map_err(|e| e.to_string())?;
            let config = RunnerConfig::new(base)?
                .output(Audience::Reader, reader, "reader")?
                .output(Audience::Contributor, contributor, "contributor")?
                .layout(layout.export_layout()?);
            // Explicit per-audience paths apply to build as well. Runner's
            // update preflight validates their full transaction namespaces;
            // compilation prepares both trees before store publication below.
            match command.as_str() {
                "check" | "update" => {
                    let mode = if command == "check" {
                        RunMode::Check
                    } else {
                        RunMode::Update
                    };
                    runner::run(
                        &config,
                        mode,
                        &[Audience::Reader, Audience::Contributor],
                        || input.thaw(),
                    )?;
                }
                "build" => {
                    runner::run(
                        &config,
                        RunMode::BuildConfigured,
                        &[Audience::Reader, Audience::Contributor],
                        || input.thaw(),
                    )?;
                }
                _ => return Err("Command must be build, check, or update".into()),
            }
            Ok(json!({"command":command}))
        }
    }
}

fn main() {
    let outcome = (|| {
        let mut input = String::new();
        io::stdin()
            .read_to_string(&mut input)
            .map_err(|e| e.to_string())?;
        let request =
            serde_json::from_str(&input).map_err(|e| format!("Invalid bridge request: {e}"))?;
        execute(request)
    })();
    match outcome {
        Ok(value) => println!("{}", json!({"ok":true,"result":value})),
        Err(error) => {
            println!("{}", json!({"ok":false,"error":error}));
            std::process::exit(1);
        }
    }
}
