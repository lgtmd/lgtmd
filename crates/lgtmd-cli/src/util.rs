use lgtmd::Result;

/// Unpredictable identity for one process session or private file transaction.
pub fn token() -> Result<String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| format!("Generate session identity: {e}"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
