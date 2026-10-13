mod bridge;
use lgtmd::{
    Result,
    site::store::{self, StoreKind},
};
use lgtmd_cli::{args, assets, candidate, config, flow, server};
use serde_json::json;
use std::sync::{
    Arc,
    atomic::{AtomicI32, Ordering},
};
use tokio_util::sync::CancellationToken;

async fn execute(options: args::Options, cancel: CancellationToken) -> Result<()> {
    let runs = ["build", "check"].contains(&options.command.as_str())
        || (options.command == "dev" && !options.reuse);
    let config = config::load_config(options.config.as_deref(), runs)?;
    // Reject a broken presentation input before starting the project's flow.
    // Snapshot operations and preview only consume evidence or built assets.
    let theme_css = if options.command == "build" {
        config::read_theme_css(&config)?
    } else {
        None
    };
    match options.command.as_str() {
        "dev" => {
            let base = options.base.unwrap_or_else(|| config.git.base.clone());
            server::run_dev(
                config,
                server::DevOptions {
                    audience: options.audience,
                    port: options.port,
                    reuse: options.reuse,
                    watch: options.watch,
                    base,
                },
                cancel,
            )
            .await
        }
        "preview" => {
            let validated =
                store::validate_files(&candidate::read_tree(&config.out_dir)?, StoreKind::Static)?;
            let bundle = validated.bundle.ok_or("Missing static site bundle")?;
            if bundle.audience != options.audience {
                return Err(format!(
                    "Static site is {}; select that audience explicitly or rebuild",
                    bundle.audience
                ));
            }
            let state: serde_json::Value = serde_json::from_slice(
                validated
                    .files
                    .get("site.json")
                    .ok_or("Missing site.json")?,
            )
            .map_err(|e| e.to_string())?;
            if state["currentResourceBase"] != config.base_path {
                return Err(format!(
                    "Static site was built for {}; restore that basePath or run lgtmd build again",
                    state["currentResourceBase"]
                ));
            }
            server::run_preview(validated.files, config.base_path, options.port, cancel).await
        }
        "update" => {
            let value = candidate::load_candidate(
                &config,
                options.candidate.as_deref().ok_or("Missing candidate ID")?,
            )?;
            let projection = value.projection(&options.audience);
            let path = config.snapshots.join(&options.audience);
            store::publish("update", &path, &projection.files, StoreKind::Snapshot)?;
            println!(
                "{}",
                json!({"event":"accepted", "id":value.candidate_id,"audience":options.audience,"digest":projection.bundle.digest,"path":path})
            );
            Ok(())
        }
        "build" | "check" => {
            let value = flow::execute_flow(&config, cancel.clone()).await?;
            if cancel.is_cancelled() {
                return Err("Run cancelled before publication".into());
            }
            let projection = value.projection(&options.audience);
            println!(
                "{}",
                json!({"event":"candidate","id":value.candidate_id,"audience":options.audience,"digest":projection.bundle.digest})
            );
            if options.command == "build" {
                store::publish(
                    "update",
                    &config.out_dir,
                    &assets::static_files(projection, &config.base_path, theme_css.as_deref())?,
                    StoreKind::Static,
                )?;
            } else {
                store::publish(
                    "check",
                    &config.snapshots.join(&options.audience),
                    &projection.files,
                    StoreKind::Snapshot,
                )?;
            }
            Ok(())
        }
        _ => Err("Unsupported command".into()),
    }
}

fn install_signals(
    cancel: CancellationToken,
    received: Arc<AtomicI32>,
) -> Result<tokio::task::JoinHandle<()>> {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        // Register synchronously before any project process can be started.
        // Spawning an async registration task leaves a scheduling window where
        // the OS default signal action could exit without cleaning up a flow.
        let mut interrupt =
            signal(SignalKind::interrupt()).map_err(|e| format!("Install SIGINT handler: {e}"))?;
        let mut terminate =
            signal(SignalKind::terminate()).map_err(|e| format!("Install SIGTERM handler: {e}"))?;
        Ok(tokio::spawn(async move {
            let code = tokio::select! { _ = interrupt.recv() => 130, _ = terminate.recv() => 143 };
            received.store(code, Ordering::Release);
            cancel.cancel();
        }))
    }
    #[cfg(not(unix))]
    {
        Ok(tokio::spawn(async move {
            let _ = tokio::signal::ctrl_c().await;
            received.store(130, Ordering::Release);
            cancel.cancel();
        }))
    }
}
fn main() {
    let values: Vec<_> = std::env::args().skip(1).collect();
    if values.first().map(String::as_str) == Some("__bridge") {
        if values.len() != 1 {
            eprintln!("lgtmd: Internal bridge accepts no arguments");
            std::process::exit(1);
        }
        bridge::run();
        return;
    }
    let options = match args::parse(values) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("lgtmd: {e}");
            std::process::exit(1);
        }
    };
    match options.command.as_str() {
        "help" | "--help" | "-h" => {
            print!("{}", args::HELP);
            return;
        }
        "--version" | "-v" => {
            println!("lgtmd {}", env!("CARGO_PKG_VERSION"));
            return;
        }
        _ => {}
    }
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("Start native runtime");
    let code = runtime.block_on(async {
        let cancel = CancellationToken::new();
        let received = Arc::new(AtomicI32::new(0));
        let handler = match install_signals(cancel.clone(), received.clone()) {
            Ok(handler) => handler,
            Err(error) => {
                eprintln!("lgtmd: {error}");
                return 1;
            }
        };
        let result = execute(options, cancel.clone()).await;
        let signal = received.load(Ordering::Acquire);
        handler.abort();
        if signal != 0 {
            signal
        } else if let Err(e) = result {
            eprintln!("lgtmd: {e}");
            1
        } else {
            0
        }
    });
    std::process::exit(code);
}
