//! This example is both the authored guide and its executable evidence producer.
//! Build `config-demo` first so the guide can exercise the actual CLI.

mod support;

use lgtmd::runner::run_cli;
use std::path::Path;

fn main() {
    let baseline = Path::new(env!("CARGO_MANIFEST_DIR")).join("baseline/config");
    let result = run_cli(std::env::args().skip(1), &baseline, || {
        let binary = support::locate_cli()?;
        support::guide(&binary)
    });
    if let Err(error) = result {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
