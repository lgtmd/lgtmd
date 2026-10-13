//! Execute project-owned flows, guard completion, and watch complete inputs.
use crate::{
    candidate::{self, Candidate},
    config::{Config, ignored_watch_path},
    util,
};
use lgtmd::{Result, site, transport::Input};
use serde::Deserialize;
use std::{
    collections::BTreeMap,
    fs,
    path::Path,
    process::Stdio,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::Command,
    task::JoinHandle,
};
use tokio_util::sync::CancellationToken;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    schema_version: u32,
    run_id: String,
    input: Input,
}
fn clock_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
#[cfg(unix)]
fn signal_group(pid: u32, signal: i32) -> Result<()> {
    // The child was explicitly started in a new group with its own PID.
    if unsafe { libc::kill(-(pid as i32), signal) } == -1 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() != Some(libc::ESRCH) {
            return Err(format!("Signal owned flow process group: {error}"));
        }
    }
    Ok(())
}
#[cfg(not(unix))]
fn signal_group(_pid: u32, _signal: i32) -> Result<()> {
    Err("Flow process groups are supported on Unix targets in v1".into())
}
struct GroupGuard {
    pid: u32,
    armed: bool,
}
impl Drop for GroupGuard {
    fn drop(&mut self) {
        if self.armed {
            let _ = signal_group(self.pid, libc::SIGKILL);
        }
    }
}
struct OutputTasks {
    stdout: JoinHandle<Result<()>>,
    stderr: JoinHandle<Result<()>>,
}
impl Drop for OutputTasks {
    fn drop(&mut self) {
        self.stdout.abort();
        self.stderr.abort();
    }
}
async fn read_output(mut stream: impl AsyncRead + Unpin, log: Arc<Mutex<Vec<u8>>>) -> Result<()> {
    let mut chunk = [0_u8; 8192];
    loop {
        let count = stream
            .read(&mut chunk)
            .await
            .map_err(|e| format!("Read flow output: {e}"))?;
        if count == 0 {
            return Ok(());
        }
        {
            let mut kept = log.lock().map_err(|_| "Flow log poisoned")?;
            kept.extend_from_slice(&chunk[..count]);
            let excess = kept.len().saturating_sub(65536);
            if excess > 0 {
                kept.drain(..excess);
            }
        }
        tokio::io::stderr()
            .write_all(&chunk[..count])
            .await
            .map_err(|e| format!("Forward flow output: {e}"))?;
    }
}
fn joined(result: std::result::Result<Result<()>, tokio::task::JoinError>) -> Result<()> {
    result.map_err(|e| format!("Flow output task failed: {e}"))?
}
async fn run_process(
    config: &Config,
    output: &Path,
    id: &str,
    cancel: &CancellationToken,
    log: Arc<Mutex<Vec<u8>>>,
) -> Result<()> {
    let argv = config
        .flow
        .command
        .as_ref()
        .filter(|a| !a.is_empty())
        .ok_or("flow.command is required")?;
    candidate::ensure_active(Some(cancel))?;
    let mut command = Command::new(&argv[0]);
    command
        .args(&argv[1..])
        .current_dir(&config.flow.cwd)
        .env("LGTMD_OUTPUT", output)
        .env("LGTMD_RUN_ID", id)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Start flow {}: {e}", argv[0]))?;
    let pid = child.id().ok_or("Flow has no process ID")?;
    let mut guard = GroupGuard { pid, armed: true };
    let stdout = tokio::spawn(read_output(
        child.stdout.take().ok_or("Missing flow stdout")?,
        log.clone(),
    ));
    let stderr = tokio::spawn(read_output(
        child.stderr.take().ok_or("Missing flow stderr")?,
        log,
    ));
    let mut outputs = OutputTasks { stdout, stderr };
    let outcome = tokio::select! {
        status=child.wait()=>status.map_err(|e|format!("Wait for flow: {e}")),
        ()=cancel.cancelled()=>Err("Run cancelled".into()),
        ()=tokio::time::sleep(Duration::from_millis(config.flow.timeout_ms))=>Err(format!("Flow exceeded {}ms timeout",config.flow.timeout_ms)),
    };
    signal_group(pid, libc::SIGTERM)?;
    if outcome.is_err()
        && tokio::time::timeout(Duration::from_secs(1), child.wait())
            .await
            .is_err()
    {
        signal_group(pid, libc::SIGKILL)?;
        child.wait().await.map_err(|e| e.to_string())?;
    }
    let output_result = tokio::time::timeout(Duration::from_secs(1), async {
        let (a, b) = tokio::join!(&mut outputs.stdout, &mut outputs.stderr);
        joined(a)?;
        joined(b)
    })
    .await;
    signal_group(pid, libc::SIGKILL)?;
    guard.armed = false;
    let status = outcome?;
    output_result.map_err(|_| "Flow descendants kept output pipes open after shutdown")??;
    if !status.success() {
        return Err(format!("Flow failed ({status})"));
    }
    candidate::ensure_active(Some(cancel))
}
/// A successful child close is necessary before handoff bytes become a candidate.
pub async fn execute_flow(config: &Config, cancel: CancellationToken) -> Result<Candidate> {
    candidate::ensure_active(Some(&cancel))?;
    let runs = config.cache_dir.join("runs");
    candidate::private_dir(&runs)?;
    let id = util::token()?;
    let staging = runs.join(format!(".run-{id}"));
    candidate::private_dir(&staging)?;
    let output = staging.join("handoff.json");
    let started = clock_ms();
    let log = Arc::new(Mutex::new(Vec::new()));
    let result=async {
        run_process(config,&output,&id,&cancel,log.clone()).await?;
        let meta=fs::symlink_metadata(&output).map_err(|e|format!("Missing flow handoff: {e}"))?;
        if !meta.is_file() || meta.file_type().is_symlink() || meta.len()>256*1024*1024 { return Err("Invalid or oversized flow handoff".into()); }
        let envelope: Envelope=serde_json::from_slice(&fs::read(&output).map_err(|e|e.to_string())?).map_err(|e|format!("Invalid flow handoff: {e}"))?;
        if envelope.schema_version!=1 || envelope.run_id!=id || envelope.input.schema_version!=1 { return Err("Missing, stale, or incompatible flow handoff".into()); }
        let owned=config.clone(); let token=cancel.clone();
        let value=tokio::task::spawn_blocking(move || { candidate::ensure_active(Some(&token))?;
            let value=Candidate::from(site::compile(&envelope.input,&owned.title,owned.navigation.as_deref())?);
            candidate::admit_candidate(&owned,&value,Some(&token),false)?; Ok::<_,String>(value)
        }).await.map_err(|e|format!("Compile completed flow: {e}"))??;
        candidate::atomic_json(&runs.join(format!("{id}.json")),&serde_json::json!({"schema_version":1,"id":id,"status":"succeeded","started":started,"finished":clock_ms(),"candidate_id":value.candidate_id}),None)?;
        fs::remove_dir_all(&staging).map_err(|e|format!("Remove private handoff: {e}"))?;
        candidate::publish_candidate(config,&value,Some(&cancel))?;
        Ok(value)
    }.await;
    if let Err(error) = &result {
        let message =
            String::from_utf8_lossy(&log.lock().map_err(|_| "Flow log poisoned")?).into_owned();
        let receipt = candidate::atomic_json(
            &runs.join(format!("{id}.json")),
            &serde_json::json!({"schema_version":1,"id":id,"status":if cancel.is_cancelled(){"cancelled"}else{"failed"},"started":started,"finished":clock_ms(),"error":error,"log":message}),
            None,
        );
        let cleanup = if staging.exists() {
            fs::remove_dir_all(&staging).map_err(|e| format!("Remove private handoff: {e}"))
        } else {
            Ok(())
        };
        if let Err(extra) = receipt.and(cleanup) {
            return Err(format!("{error}; {extra}"));
        }
    }
    result
}
pub fn validate_watch(config: &Config) -> Result<()> {
    if config.flow.watch.is_empty() {
        return Err("--watch requires at least one configured flow.watch root".into());
    }
    for path in &config.flow.watch {
        let meta = fs::symlink_metadata(path)
            .map_err(|e| format!("Watch root {}: {e}", path.display()))?;
        if !meta.is_file() && !meta.is_dir() {
            return Err(format!(
                "Watch root must be a file or directory: {}",
                path.display()
            ));
        }
    }
    Ok(())
}
/// Watch polling caches only file reads, never completed application execution.
/// Inode and nanosecond change time invalidate the cache after atomic replacements
/// or content edits even when an editor restores an older modification time.
#[derive(Default)]
pub struct WatchState {
    hashes: BTreeMap<String, (String, String)>,
}
fn metadata_signature(meta: &fs::Metadata) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        format!(
            "{}:{}:{}:{}:{}:{}:{}",
            meta.dev(),
            meta.ino(),
            meta.len(),
            meta.mtime(),
            meta.mtime_nsec(),
            meta.ctime(),
            meta.ctime_nsec()
        )
    }
    #[cfg(not(unix))]
    {
        format!("{}:{:?}:{:?}", meta.len(), meta.modified(), meta.created())
    }
}
impl WatchState {
    pub fn fingerprint(&mut self, config: &Config) -> Result<String> {
        fn visit(
            state: &mut WatchState,
            config: &Config,
            path: &Path,
            files: &mut BTreeMap<String, String>,
        ) -> Result<()> {
            if ignored_watch_path(config, path) {
                return Ok(());
            }
            let key = path.to_str().ok_or("Non UTF-8 watch path")?.to_owned();
            let meta = match fs::symlink_metadata(path) {
                Ok(meta) => meta,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    files.insert(key, "missing".into());
                    return Ok(());
                }
                Err(e) => return Err(format!("Read watched path {}: {e}", path.display())),
            };
            if meta.file_type().is_symlink() {
                return Ok(());
            }
            if meta.is_dir() {
                files.insert(key, "directory".into());
                for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
                    visit(
                        state,
                        config,
                        &entry.map_err(|e| e.to_string())?.path(),
                        files,
                    )?;
                }
            } else if meta.is_file() {
                let signature = metadata_signature(&meta);
                let hash = if let Some((_, hash)) = state
                    .hashes
                    .get(&key)
                    .filter(|(prior, _)| *prior == signature)
                {
                    hash.clone()
                } else {
                    let bytes = match fs::read(path) {
                        Ok(bytes) => bytes,
                        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                            files.insert(key, "missing".into());
                            return Ok(());
                        }
                        Err(e) => return Err(format!("Read watched file {}: {e}", path.display())),
                    };
                    let hash = site::sha256(&bytes);
                    state.hashes.insert(key.clone(), (signature, hash.clone()));
                    hash
                };
                files.insert(key, hash);
            }
            Ok(())
        }
        let mut files = BTreeMap::new();
        for path in &config.flow.watch {
            visit(self, config, path, &mut files)?;
        }
        self.hashes.retain(|path, _| files.contains_key(path));
        Ok(site::sha256(&site::canonical(&files)?))
    }
}
pub fn watch_fingerprint(config: &Config) -> Result<String> {
    WatchState::default().fingerprint(config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::load_config;
    fn fixture(script: &str) -> (tempfile::TempDir, Config) {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        fs::write(root.join("flow.py"), script).unwrap();
        fs::write(
            root.join("lgtmd.config.json"),
            r#"{"flow":{"command":["python3","flow.py"],"watch":["flow.py"],"timeoutMs":3000}}"#,
        )
        .unwrap();
        let config = load_config(Some(&root.join("lgtmd.config.json")), true).unwrap();
        (dir, config)
    }
    fn script() -> String {
        r#"import os,json
payload={'schema_version':1,'run_id':os.environ['LGTMD_RUN_ID'],'input':{'schema_version':1,'documents':[{'id':'hello','title':'Hello','nodes':[{'id':'block-0001','kind':'markdown','parts':[{'kind':'text','text':'Hello'}]}]}]}}
with open(os.environ['LGTMD_OUTPUT'],'x') as f: json.dump(payload,f)
"#.into()
    }
    #[tokio::test]
    async fn failed_or_stale_process_never_replaces_success() {
        let (_dir, config) = fixture(&script());
        let first = execute_flow(&config, CancellationToken::new())
            .await
            .unwrap();
        fs::write(
            config.root.join("flow.py"),
            format!("{}\nraise RuntimeError('after receipt')", script()),
        )
        .unwrap();
        assert!(
            execute_flow(&config, CancellationToken::new())
                .await
                .unwrap_err()
                .contains("Flow failed")
        );
        fs::write(
            config.root.join("flow.py"),
            script().replace("os.environ['LGTMD_RUN_ID']", "'stale'"),
        )
        .unwrap();
        assert!(
            execute_flow(&config, CancellationToken::new())
                .await
                .unwrap_err()
                .contains("stale")
        );
        fs::write(config.root.join("flow.py"), "").unwrap();
        assert!(
            execute_flow(&config, CancellationToken::new())
                .await
                .unwrap_err()
                .contains("handoff")
        );
        assert_eq!(
            candidate::latest_candidate(&config).unwrap().candidate_id,
            first.candidate_id
        );
    }
    #[tokio::test]
    async fn cancellation_and_timeout_terminate_owned_children() {
        let (_dir, mut config) = fixture("import time\ntime.sleep(30)\n");
        config.flow.timeout_ms = 30;
        assert!(
            execute_flow(&config, CancellationToken::new())
                .await
                .unwrap_err()
                .contains("timeout")
        );
        config.flow.timeout_ms = 3000;
        let cancel = CancellationToken::new();
        let timer = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(30)).await;
            timer.cancel();
        });
        assert!(
            execute_flow(&config, cancel)
                .await
                .unwrap_err()
                .contains("cancelled")
        );
        assert!(candidate::latest_candidate(&config).is_err());
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn cancellation_kills_descendants_that_keep_output_pipes_open() {
        // Publish the complete handshake atomically. Merely creating child.pid
        // exposes an empty file before Python writes its buffered PID bytes.
        let (_dir, config) = fixture(
            "import os,subprocess,sys,time\nchild=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)'])\nwith open('child.pid.tmp','x') as f: f.write(str(child.pid))\nos.replace('child.pid.tmp','child.pid')\ntime.sleep(30)\n",
        );
        let token = CancellationToken::new();
        let signal = token.clone();
        let owned = config.clone();
        let run = tokio::spawn(async move { execute_flow(&owned, token).await });
        let path = config.root.join("child.pid");
        for _ in 0..100 {
            if path.exists() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let pid: i32 = fs::read_to_string(&path).unwrap().parse().unwrap();
        signal.cancel();
        assert!(run.await.unwrap().unwrap_err().contains("cancelled"));
        for _ in 0..100 {
            let status = std::process::Command::new("ps")
                .args(["-p", &pid.to_string(), "-o", "stat="])
                .output()
                .unwrap();
            let state = String::from_utf8_lossy(&status.stdout);
            if !status.status.success() || state.trim().starts_with('Z') || state.trim().is_empty()
            {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("Owned descendant remained running after cancellation");
    }
    #[test]
    fn watches_content_atomic_saves_and_excludes_outputs() {
        let (_dir, mut config) = fixture("initial");
        validate_watch(&config).unwrap();
        let mut watch = WatchState::default();
        let first = watch.fingerprint(&config).unwrap();
        fs::write(config.root.join("new.py"), "changed").unwrap();
        fs::rename(config.root.join("new.py"), config.root.join("flow.py")).unwrap();
        assert_ne!(first, watch.fingerprint(&config).unwrap());
        fs::write(config.root.join("next.py"), "another edit").unwrap();
        let previous = watch.fingerprint(&config).unwrap();
        fs::rename(config.root.join("next.py"), config.root.join("flow.py")).unwrap();
        assert_ne!(previous, watch.fingerprint(&config).unwrap());
        config.flow.watch = vec![config.root.clone()];
        let before = watch_fingerprint(&config).unwrap();
        candidate::private_dir(&config.cache_dir).unwrap();
        fs::write(config.cache_dir.join("generated"), "ignore").unwrap();
        assert_eq!(before, watch_fingerprint(&config).unwrap());
    }
}
