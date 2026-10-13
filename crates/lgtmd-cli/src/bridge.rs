//! Internal coarse JSON bridge carried by the same executable as the public CLI.
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
    #[serde(rename = "load-candidate")]
    LoadCandidate {
        config: PathBuf,
        candidate_id: String,
    },
    #[serde(rename = "compile-site")]
    CompileSite {
        input: Input,
        title: String,
        #[serde(default)]
        navigation: Option<Vec<String>>,
    },
    #[serde(rename = "validate-site")]
    ValidateSite {
        files: lgtmd::lifecycle::Files,
        #[serde(default)]
        kind: lgtmd::site::store::StoreKind,
    },
    #[serde(rename = "compare-site")]
    CompareSite {
        before: lgtmd::lifecycle::Files,
        after: lgtmd::lifecycle::Files,
    },
    #[serde(rename = "site-store")]
    SiteStore {
        command: String,
        path: PathBuf,
        files: lgtmd::lifecycle::Files,
        #[serde(default)]
        kind: lgtmd::site::store::StoreKind,
    },
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
        Request::LoadCandidate {
            config,
            candidate_id,
        } => {
            let config = lgtmd_cli::config::load_config(Some(&config), false)?;
            serde_json::to_value(lgtmd_cli::candidate::load_candidate(
                &config,
                &candidate_id,
            )?)
            .map_err(|e| e.to_string())
        }
        Request::CompileSite {
            input,
            title,
            navigation,
        } => serde_json::to_value(lgtmd::site::compile(&input, &title, navigation.as_deref())?)
            .map_err(|e| e.to_string()),
        Request::ValidateSite { files, kind } => {
            serde_json::to_value(lgtmd::site::store::validate_files(&files, kind)?)
                .map_err(|e| e.to_string())
        }
        Request::CompareSite { before, after } => {
            serde_json::to_value(lgtmd::review::compare(&before, &after)?)
                .map_err(|e| e.to_string())
        }
        Request::SiteStore {
            command,
            path,
            files,
            kind,
        } => Ok(json!({"files":lgtmd::site::store::publish(&command, &path, &files, kind)?})),
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

pub fn run() {
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
