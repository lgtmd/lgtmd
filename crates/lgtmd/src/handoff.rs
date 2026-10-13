//! Host completion handoff. The CLI still requires a successful process exit;
//! writing this receipt cannot conceal a later error or failed teardown.
use crate::{Document, Result, transport::Input};
use serde::{Deserialize, Serialize};
use std::{fs::OpenOptions, io::Write};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Handoff {
    pub schema_version: u32,
    pub run_id: String,
    pub input: Input,
}
/// Call only after project cleanup has completed. Output is exclusive and uses
/// the one-run path/token provided by `lgtmd dev`, `build`, or `check`.
pub fn complete_run(documents: &[Document]) -> Result<()> {
    let path = std::env::var_os("LGTMD_OUTPUT")
        .ok_or("LGTMD_OUTPUT is required; run this flow through lgtmd")?;
    let run_id = std::env::var("LGTMD_RUN_ID").map_err(|_| "LGTMD_RUN_ID is required")?;
    if run_id.is_empty() {
        return Err("LGTMD_RUN_ID must not be empty".into());
    }
    let bytes = serde_json::to_vec(&Handoff {
        schema_version: 1,
        run_id,
        input: Input::from_documents(documents)?,
    })
    .map_err(|e| e.to_string())?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut output = options
        .open(path)
        .map_err(|e| format!("Create completed handoff: {e}"))?;
    output
        .write_all(&bytes)
        .and_then(|()| output.sync_all())
        .map_err(|e| format!("Write completed handoff: {e}"))
}
