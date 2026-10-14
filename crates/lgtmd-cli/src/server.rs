//! Loopback documentation hosting. App execution, review and presentation stay separate.
use crate::{
    assets::{self, BaselineState, RunState, SiteState},
    candidate::{Candidate, latest_candidate},
    config::{Config, read_theme_css},
    flow::{WatchState, execute_flow, validate_watch},
    git::{read_baseline, read_history},
};
use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response, Sse, sse::Event},
};
use futures_util::stream;
use lgtmd::{
    Result,
    lifecycle::Files,
    site::{Bundle, Projection, Resource},
};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, VecDeque},
    convert::Infallible,
    sync::Arc,
    time::Duration,
};
use tokio::{
    net::TcpListener,
    sync::{Mutex, broadcast, mpsc},
};
use tokio_util::sync::CancellationToken;

pub struct DevOptions {
    pub audience: String,
    pub port: u16,
    pub reuse: bool,
    pub watch: bool,
    pub base: String,
}
struct Mutable {
    state: SiteState,
    candidate: Option<Arc<Candidate>>,
    resources: BTreeMap<String, Arc<Projection>>,
    resource_order: VecDeque<String>,
    selection: u64,
    history_selection: u64,
    retained_failure: Option<String>,
}
struct DevHost {
    config: Config,
    audience: String,
    assets: Files,
    authority: String,
    origin: String,
    token: String,
    cancel: CancellationToken,
    mutable: Mutex<Mutable>,
    changes: broadcast::Sender<()>,
    runs: mpsc::Sender<()>,
}
struct PreviewHost {
    files: Files,
    bundle: Bundle,
    authority: String,
    base_path: String,
}

fn public_headers(response: &mut Response) {
    let headers = response.headers_mut();
    headers.insert("Cache-Control", HeaderValue::from_static("no-store"));
    headers.insert(
        "X-Content-Type-Options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert("Referrer-Policy", HeaderValue::from_static("no-referrer"));
}
fn response(status: StatusCode, bytes: impl Into<Body>, mime: &str) -> Response {
    let mut response = Response::new(bytes.into());
    *response.status_mut() = status;
    response.headers_mut().insert(
        "Content-Type",
        HeaderValue::from_str(mime)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    public_headers(&mut response);
    response
}
fn text(status: StatusCode, message: impl Into<String>) -> Response {
    response(status, message.into(), "text/plain; charset=utf-8")
}
fn json_response(value: impl serde::Serialize) -> Response {
    match serde_json::to_vec(&value) {
        Ok(bytes) => response(StatusCode::OK, bytes, "application/json; charset=utf-8"),
        Err(error) => text(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
    }
}
fn encode_component(value: &str) -> String {
    let mut output = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            output.push(byte as char);
        } else {
            output.push_str(&format!("%{byte:02X}"));
        }
    }
    output
}
fn resource_response(resource: &Resource, bytes: Vec<u8>, head: bool) -> Response {
    let mut result = response(
        StatusCode::OK,
        if head { Vec::new() } else { bytes },
        &resource.mime,
    );
    result.headers_mut().insert(
        "Content-Security-Policy",
        HeaderValue::from_static("sandbox; default-src 'none'; style-src 'unsafe-inline'"),
    );
    if !resource.mime.starts_with("image/") {
        let filename = resource.path.rsplit('/').next().unwrap_or("download");
        if let Ok(header) = HeaderValue::from_str(&format!(
            "attachment; filename*=UTF-8''{}",
            encode_component(filename)
        )) {
            result.headers_mut().insert("Content-Disposition", header);
        }
    }
    result
}
fn decode_path(value: &str) -> Option<String> {
    let input = value.as_bytes();
    let mut output = Vec::with_capacity(input.len());
    let mut index = 0;
    while index < input.len() {
        if input[index] == b'%' {
            let first = (*input.get(index + 1)? as char).to_digit(16)?;
            let second = (*input.get(index + 2)? as char).to_digit(16)?;
            output.push((first * 16 + second) as u8);
            index += 3;
        } else {
            output.push(input[index]);
            index += 1;
        }
    }
    let output = String::from_utf8(output).ok()?;
    if output.contains(['\\', '\0']) || output.split('/').any(|p| p == "." || p == "..") {
        return None;
    }
    Some(output)
}
fn path_in_site(
    headers: &HeaderMap,
    path: &str,
    authority: &str,
    base_path: &str,
) -> Option<String> {
    if headers.get("host")?.to_str().ok()? != authority {
        return None;
    }
    decode_path(path.strip_prefix(base_path)?)
}
async fn bind(port: u16) -> Result<TcpListener> {
    TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
        .await
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AddrInUse {
                format!("Port {port} is occupied. Choose another with --port.")
            } else {
                format!("Cannot start local docs server: {error}")
            }
        })
}
fn identity(listener: &TcpListener, base_path: &str) -> Result<(String, String, String)> {
    let authority = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .to_string();
    let origin = format!("http://{authority}");
    let url = format!("{origin}{base_path}");
    Ok((authority, origin, url))
}

async fn serve(listener: TcpListener, router: Router, cancel: CancellationToken) -> Result<()> {
    let serving = axum::serve(listener, router)
        .with_graceful_shutdown(cancel.clone().cancelled_owned())
        .into_future();
    tokio::pin!(serving);
    tokio::select! {
        result = &mut serving => result.map_err(|error| error.to_string()),
        _ = cancel.cancelled() => {
            // A client can stop reading an in-flight response indefinitely.
            // Give HTTP one second to drain, then return to the CLI's owned-task
            // cleanup. main exits only after that cleanup and closes remaining
            // connection tasks with the process; they must not block flow teardown.
            match tokio::time::timeout(Duration::from_secs(1), &mut serving).await {
                Ok(result) => result.map_err(|error| error.to_string()),
                Err(_) => Ok(()),
            }
        }
    }
}

pub async fn run_preview(
    files: Files,
    base_path: String,
    port: u16,
    cancel: CancellationToken,
) -> Result<()> {
    let bundle: Bundle = serde_json::from_slice(
        files
            .get("bundle.json")
            .ok_or("Missing static site bundle")?,
    )
    .map_err(|e| e.to_string())?;
    let listener = bind(port).await?;
    let (authority, _, url) = identity(&listener, &base_path)?;
    let host = Arc::new(PreviewHost {
        files,
        bundle,
        authority,
        base_path,
    });
    let router = Router::new().fallback(preview_request).with_state(host);
    println!(
        "{}",
        json!({"event":"listening","mode":"preview","url":url})
    );
    serve(listener, router, cancel).await
}
async fn preview_request(State(host): State<Arc<PreviewHost>>, request: Request) -> Response {
    let method = request.method();
    if method != Method::GET && method != Method::HEAD {
        return text(StatusCode::NOT_FOUND, "Not found");
    }
    let Some(path) = path_in_site(
        request.headers(),
        request.uri().path(),
        &host.authority,
        &host.base_path,
    ) else {
        return text(StatusCode::NOT_FOUND, "Not found");
    };
    let key = if path.is_empty() { "index.html" } else { &path };
    if key.starts_with('.') {
        return text(StatusCode::NOT_FOUND, "Not found");
    }
    let Some(bytes) = host.files.get(key) else {
        return text(StatusCode::NOT_FOUND, "Not found");
    };
    if let Some(resource) = host.bundle.resources.iter().find(|r| r.path == key) {
        return resource_response(resource, bytes.clone(), method == Method::HEAD);
    }
    response(
        StatusCode::OK,
        if method == Method::HEAD {
            Vec::new()
        } else {
            bytes.clone()
        },
        assets::mime(key),
    )
}

impl Mutable {
    fn keep(&mut self, projection: Arc<Projection>, base_path: &str) -> String {
        let digest = projection.bundle.digest.clone();
        if !self.resources.contains_key(&digest) {
            self.resource_order.push_back(digest.clone());
        }
        self.resources.insert(digest.clone(), projection);
        while self.resources.len() > 12 {
            let current = self.state.current.as_ref().map(|b| b.digest.as_str());
            let previous = self
                .state
                .baseline
                .as_ref()
                .and_then(|b| b.bundle.as_ref())
                .map(|b| b.digest.as_str());
            let Some(index) = self.resource_order.iter().position(|id| {
                Some(id.as_str()) != current && Some(id.as_str()) != previous && id != &digest
            }) else {
                break;
            };
            if let Some(retired) = self.resource_order.remove(index) {
                self.resources.remove(&retired);
            }
        }
        format!("{base_path}__lgtmd/resources/{digest}/")
    }
    fn set_candidate(&mut self, value: Candidate, retained: bool, audience: &str, base_path: &str) {
        let projection = Arc::new(value.projection(audience).clone());
        self.state.title = projection.bundle.title.clone();
        self.state.current = Some(projection.bundle.clone());
        self.state.candidate_id = Some(value.candidate_id.clone());
        self.state.current_resource_base = Some(self.keep(projection, base_path));
        self.candidate = Some(Arc::new(value));
        self.state.run = RunState {
            status: "succeeded".into(),
            retained,
            stale: false,
            message: retained
                .then(|| "Retained output. The flow has not been run in this session.".into()),
        };
        // Candidate and comparison must never describe different runs. A new
        // selection publishes its baseline and review together after validation.
        self.selection += 1;
        self.state.comparison = None;
        if let Some(baseline) = &self.state.baseline {
            self.state.baseline = Some(BaselineState::loading(baseline.reference.clone()));
        }
    }
}
impl DevHost {
    fn changed(&self) {
        let _ = self.changes.send(());
    }
    async fn history_page(&self, direction: &str) {
        let (ticket, previous, offset) = {
            let mut mutable = self.mutable.lock().await;
            let previous = mutable.state.history.clone();
            let offset = match (direction, &previous) {
                ("older", Some(page)) if page.truncated => page.offset.saturating_add(20),
                ("newer", Some(page)) => page.offset.saturating_sub(20),
                ("refresh", _) => 0,
                _ => return,
            };
            mutable.history_selection += 1;
            (mutable.history_selection, previous, offset)
        };
        let history = tokio::select! {
            biased;
            _=self.cancel.cancelled()=>return,
            result=read_history(&self.config, if direction == "refresh" { None } else { previous.as_ref() }, offset)=>result,
        };
        let mut mutable = self.mutable.lock().await;
        if mutable.history_selection != ticket || self.cancel.is_cancelled() {
            return;
        }
        mutable.state.history = Some(history);
        drop(mutable);
        self.changed();
    }
    async fn select_base(&self, reference: String) {
        let ticket = {
            let mut mutable = self.mutable.lock().await;
            mutable.selection += 1;
            mutable.state.baseline = Some(BaselineState::loading(reference.clone()));
            mutable.state.comparison = None;
            mutable.selection
        };
        self.changed();
        let mut result = tokio::select! {
            biased;
            _=self.cancel.cancelled()=>return,
            result=read_baseline(&self.config,&self.audience,&reference)=>result,
        };
        let candidate = {
            let mutable = self.mutable.lock().await;
            if mutable.selection != ticket {
                return;
            }
            mutable.candidate.clone()
        };
        if result.code.as_deref() == Some("unknown-revision")
            && candidate
                .as_ref()
                .is_some_and(|c| c.candidate_id == reference)
        {
            result.code = Some("candidate-id".into());
            result.message = Some("This is the current documentation candidate ID, not a Git revision. Choose a commit from project history or enter a branch, tag, or commit.".into());
        }
        let mut baseline = BaselineState {
            commit: result.commit,
            code: result.code,
            status: result.status,
            reference,
            revision: result.revision,
            message: result.message,
            bundle: None,
            resource_base: None,
        };
        let projection = result.projection.map(Arc::new);
        let mut comparison = None;
        let mut accepted_projection = projection.clone();
        if let Some(previous) = projection {
            baseline.bundle = Some(previous.bundle.clone());
            if let Some(candidate) = candidate {
                let audience = self.audience.clone();
                let compared = tokio::task::spawn_blocking(move || {
                    let review = lgtmd::review::compare(
                        &previous.files,
                        &candidate.projection(&audience).files,
                    )?;
                    serde_json::to_value(review).map_err(|e| e.to_string())
                })
                .await
                .map_err(|e| e.to_string())
                .and_then(|result| result);
                match compared {
                    Ok(value) => comparison = Some(value),
                    Err(error) => {
                        baseline.status = "unavailable".into();
                        baseline.message =
                            Some(format!("Cannot compare this recorded snapshot: {error}"));
                        baseline.bundle = None;
                        accepted_projection = None;
                    }
                }
            }
        }
        let mut mutable = self.mutable.lock().await;
        if mutable.selection != ticket || self.cancel.is_cancelled() {
            return;
        }
        if let Some(projection) = accepted_projection {
            baseline.resource_base = Some(mutable.keep(projection, &self.config.base_path));
        }
        mutable.state.baseline = Some(baseline);
        mutable.state.comparison = comparison;
        drop(mutable);
        self.changed();
    }
}

pub async fn run_dev(config: Config, options: DevOptions, cancel: CancellationToken) -> Result<()> {
    read_theme_css(&config)?;
    let mut assets = assets::viewer_assets()?;
    let html = assets::boot_html(
        assets
            .get("index.html")
            .ok_or("Bundled viewer index is missing")?,
        "dev",
        &config.base_path,
        config.theme_css.is_some(),
    )?;
    assets.insert("index.html".into(), html);
    let watch_state = Arc::new(std::sync::Mutex::new(WatchState::default()));
    let initial_watch = if options.watch {
        validate_watch(&config)?;
        Some(fingerprint(config.clone(), watch_state.clone()).await?)
    } else {
        None
    };
    let retained_config = config.clone();
    let retained = tokio::task::spawn_blocking(move || latest_candidate(&retained_config))
        .await
        .map_err(|e| e.to_string())?;
    let token = crate::util::token()?;
    let state = SiteState {
        history: None,
        mode: "dev".into(),
        title: config.title.clone(),
        audience: options.audience.clone(),
        run: RunState {
            status: "idle".into(),
            retained: false,
            stale: false,
            message: None,
        },
        candidate_id: None,
        current: None,
        current_resource_base: None,
        baseline: Some(BaselineState::loading(options.base.clone())),
        comparison: None,
        can_run: !options.reuse,
        token: Some(token.clone()),
    };
    let mut mutable = Mutable {
        state,
        candidate: None,
        resources: BTreeMap::new(),
        resource_order: VecDeque::new(),
        selection: 0,
        history_selection: 0,
        retained_failure: None,
    };
    match retained {
        Ok(candidate) => {
            mutable.set_candidate(candidate, true, &options.audience, &config.base_path)
        }
        Err(error) if options.reuse => return Err(error),
        Err(error) if !error.starts_with("No retained candidate:") => {
            let message = format!("Retained output rejected: {error}");
            eprintln!("{message}. Starting a fresh flow.");
            mutable.retained_failure = Some(message);
        }
        Err(_) => {}
    }
    let listener = bind(options.port).await?;
    let (authority, origin, url) = identity(&listener, &config.base_path)?;
    let (changes, _) = broadcast::channel(16);
    let (runs, receiver) = mpsc::channel(1);
    let host = Arc::new(DevHost {
        config,
        audience: options.audience,
        assets,
        authority,
        origin,
        token,
        cancel: cancel.clone(),
        mutable: Mutex::new(mutable),
        changes,
        runs,
    });
    let router = Router::new().fallback(dev_request).with_state(host.clone());
    println!("{}", json!({"event":"listening","mode":"dev","url":url}));
    let queue = tokio::spawn(run_queue(host.clone(), receiver));
    let initial_host = host.clone();
    let initial = tokio::spawn(async move {
        tokio::join!(
            initial_host.select_base(options.base),
            initial_host.history_page("refresh")
        );
    });
    if !options.reuse {
        let _ = host.runs.try_send(());
    }
    let (watch_failures, mut failure) = mpsc::channel(1);
    let watch = if let Some(initial_watch) = initial_watch {
        let host = host.clone();
        let failures = watch_failures.clone();
        Some(tokio::spawn(async move {
            if let Err(error) = watch_inputs(host, watch_state, initial_watch).await {
                let _ = failures.send(error).await;
            }
        }))
    } else {
        None
    };
    let serving = serve(listener, router, cancel.clone());
    tokio::pin!(serving);
    let result = tokio::select! {
        result=&mut serving=>result,
        Some(error)=failure.recv()=>{cancel.cancel();let _=(&mut serving).await;Err(format!("Watching stopped: {error}"))},
    };
    cancel.cancel();
    queue.await.map_err(|e| e.to_string())?;
    initial.await.map_err(|e| e.to_string())?;
    if let Some(watch) = watch {
        watch.await.map_err(|e| e.to_string())?;
    }
    drop(watch_failures);
    result
}
async fn run_queue(host: Arc<DevHost>, mut receiver: mpsc::Receiver<()>) {
    loop {
        tokio::select! {biased;_=host.cancel.cancelled()=>break,value=receiver.recv()=>if value.is_none(){break;}}
        {
            let mut mutable = host.mutable.lock().await;
            let prefix = mutable
                .retained_failure
                .as_ref()
                .map(|s| format!("{s}. "))
                .unwrap_or_default();
            let retained = mutable.candidate.is_some();
            mutable.state.run = RunState {
                status: "running".into(),
                retained: false,
                stale: retained,
                message: Some(
                    prefix
                        + if retained {
                            "A fresh run is in progress. Showing the previous successful result."
                        } else {
                            "Running the documentation flow…"
                        },
                ),
            };
        }
        host.changed();
        match execute_flow(&host.config, host.cancel.child_token()).await {
            Ok(candidate) => {
                let event = json!({"event":"candidate","id":candidate.candidate_id,"audience":host.audience,"digest":candidate.projection(&host.audience).bundle.digest});
                let reference = {
                    let mut mutable = host.mutable.lock().await;
                    mutable.retained_failure = None;
                    mutable.set_candidate(candidate, false, &host.audience, &host.config.base_path);
                    mutable
                        .state
                        .baseline
                        .as_ref()
                        .map(|b| b.reference.clone())
                        .unwrap_or_else(|| "HEAD".into())
                };
                println!("{event}");
                host.changed();
                host.select_base(reference).await;
            }
            Err(error) => {
                let mut mutable = host.mutable.lock().await;
                let prefix = mutable
                    .retained_failure
                    .as_ref()
                    .map(|s| format!("{s}. "))
                    .unwrap_or_default();
                mutable.state.run = RunState {
                    status: if host.cancel.is_cancelled() {
                        "cancelled"
                    } else {
                        "failed"
                    }
                    .into(),
                    retained: false,
                    stale: mutable.candidate.is_some(),
                    message: Some(prefix + &error),
                };
                drop(mutable);
                host.changed();
            }
        }
    }
}
async fn fingerprint(config: Config, watch: Arc<std::sync::Mutex<WatchState>>) -> Result<String> {
    tokio::task::spawn_blocking(move || {
        watch
            .lock()
            .map_err(|_| "Watch state is unavailable")?
            .fingerprint(&config)
    })
    .await
    .map_err(|e| e.to_string())?
}
async fn watch_inputs(
    host: Arc<DevHost>,
    watch: Arc<std::sync::Mutex<WatchState>>,
    mut previous: String,
) -> Result<()> {
    // Metadata-backed polling is deliberately separate from the quiet-period
    // debounce. A directory scan is not repeated on every UI event or SSE poll.
    let mut interval = tokio::time::interval(Duration::from_millis(500));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut deadline: Option<tokio::time::Instant> = None;
    loop {
        tokio::select! {
            biased;
            _=host.cancel.cancelled()=>return Ok(()),
            _=interval.tick()=>{
                let current=fingerprint(host.config.clone(),watch.clone()).await?;
                if current!=previous {previous=current;deadline=Some(tokio::time::Instant::now()+Duration::from_millis(150));}
            }
            _=async {
                match deadline {Some(at)=>tokio::time::sleep_until(at).await,None=>std::future::pending::<()>().await}
            }=>{
                let current=fingerprint(host.config.clone(),watch.clone()).await?;
                if current!=previous {previous=current;deadline=Some(tokio::time::Instant::now()+Duration::from_millis(150));continue;}
                // A temporary editor rename may disappear before the quiet
                // period. A genuinely removed root must fail visibly.
                validate_watch(&host.config)?;
                let _=host.runs.try_send(());deadline=None;
            }
        }
    }
}
async fn body(request: Request, cancel: &CancellationToken) -> Result<Value> {
    let bytes = tokio::select! {
        biased;
        _=cancel.cancelled()=>return Err("Server is shutting down".into()),
        result=tokio::time::timeout(Duration::from_secs(5),to_bytes(request.into_body(),8192))=>result.map_err(|_|"Request body timed out")?.map_err(|_|"Request is too large")?,
    };
    let value: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if !value.is_object() {
        return Err("Expected a JSON object".into());
    }
    Ok(value)
}
async fn dev_request(State(host): State<Arc<DevHost>>, request: Request) -> Response {
    let Some(path) = path_in_site(
        request.headers(),
        request.uri().path(),
        &host.authority,
        &host.config.base_path,
    ) else {
        return text(StatusCode::NOT_FOUND, "Not found");
    };
    let method = request.method().clone();
    if method == Method::GET && path == "__lgtmd/state" {
        return json_response(&host.mutable.lock().await.state);
    }
    if method == Method::GET && path == "__lgtmd/events" {
        let receiver = host.changes.subscribe();
        let cancel = host.cancel.clone();
        let events = stream::unfold(
            (receiver, cancel, true),
            |(mut receiver, cancel, first)| async move {
                if first {
                    return Some((
                        Ok::<_, Infallible>(Event::default().data("connected")),
                        (receiver, cancel, false),
                    ));
                }
                tokio::select! {
                    biased;
                    _=cancel.cancelled()=>None,
                    result=receiver.recv()=>match result {
                        Ok(())|Err(broadcast::error::RecvError::Lagged(_))=>Some((Ok(Event::default().data("changed")),(receiver,cancel,false))),
                        Err(broadcast::error::RecvError::Closed)=>None,
                    }
                }
            },
        );
        let mut response = Sse::new(events).into_response();
        public_headers(&mut response);
        return response;
    }
    if method == Method::POST
        && matches!(
            path.as_str(),
            "__lgtmd/run" | "__lgtmd/base" | "__lgtmd/history"
        )
    {
        if request
            .headers()
            .get("origin")
            .and_then(|h| h.to_str().ok())
            != Some(host.origin.as_str())
        {
            return text(StatusCode::FORBIDDEN, "Same-origin requests required");
        }
        let data = match body(request, &host.cancel).await {
            Ok(value) => value,
            Err(error) => return text(StatusCode::BAD_REQUEST, error),
        };
        if data.get("token").and_then(Value::as_str) != Some(host.token.as_str()) {
            return text(StatusCode::FORBIDDEN, "Invalid session token");
        }
        if path == "__lgtmd/run" {
            if !host.mutable.lock().await.state.can_run {
                return text(
                    StatusCode::CONFLICT,
                    "Retained-output reuse does not execute flows",
                );
            }
            let _ = host.runs.try_send(());
            return json_response(json!({"queued":true}));
        }
        if path == "__lgtmd/history" {
            let direction = data.get("direction").and_then(Value::as_str).unwrap_or("");
            if !matches!(direction, "refresh" | "older" | "newer") {
                return text(
                    StatusCode::BAD_REQUEST,
                    "direction must be refresh, older, or newer",
                );
            }
            host.history_page(direction).await;
            return json_response(&host.mutable.lock().await.state.history);
        }
        let Some(reference) = data.get("ref").and_then(Value::as_str) else {
            return text(StatusCode::BAD_REQUEST, "ref must be a Git revision string");
        };
        host.select_base(reference.into()).await;
        return json_response(&host.mutable.lock().await.state.baseline);
    }
    if (method == Method::GET || method == Method::HEAD) && path.starts_with("__lgtmd/resources/") {
        let rest = path.trim_start_matches("__lgtmd/resources/");
        let Some((digest, key)) = rest.split_once('/') else {
            return text(StatusCode::NOT_FOUND, "Resource version unavailable");
        };
        let projection = host.mutable.lock().await.resources.get(digest).cloned();
        if let Some(projection) = projection
            && let Some(resource) = projection.bundle.resources.iter().find(|r| r.path == key)
            && let Some(bytes) = projection.files.get(key)
        {
            return resource_response(resource, bytes.clone(), method == Method::HEAD);
        }
        return text(StatusCode::NOT_FOUND, "Resource version unavailable");
    }
    if (method == Method::GET || method == Method::HEAD)
        && path == assets::THEME_CSS_PATH
        && host.config.theme_css.is_some()
    {
        let config = host.config.clone();
        return match tokio::task::spawn_blocking(move || read_theme_css(&config)).await {
            Ok(Ok(Some(bytes))) => response(
                StatusCode::OK,
                if method == Method::HEAD {
                    Vec::new()
                } else {
                    bytes
                },
                "text/css; charset=utf-8",
            ),
            Ok(Ok(None)) => text(StatusCode::NOT_FOUND, "Not found"),
            Ok(Err(error)) => text(StatusCode::INTERNAL_SERVER_ERROR, error),
            Err(error) => text(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
        };
    }
    let key = if path.is_empty() { "index.html" } else { &path };
    if (method == Method::GET || method == Method::HEAD)
        && !key.starts_with('.')
        && let Some(bytes) = host.assets.get(key)
    {
        return response(
            StatusCode::OK,
            if method == Method::HEAD {
                Vec::new()
            } else {
                bytes.clone()
            },
            assets::mime(key),
        );
    }
    text(StatusCode::NOT_FOUND, "Not found")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn routes_require_exact_loopback_authority_and_reject_encoded_traversal() {
        let mut headers = HeaderMap::new();
        headers.insert("host", HeaderValue::from_static("127.0.0.1:4177"));
        assert_eq!(
            path_in_site(
                &headers,
                "/docs/assets/a%20b.png",
                "127.0.0.1:4177",
                "/docs/"
            ),
            Some("assets/a b.png".into())
        );
        for path in [
            "/docs/%2e%2e/private",
            "/docs/assets/%5cprivate",
            "/docs/%00private",
            "/docs/%FF",
            "/docs/%2",
            "/outside/file",
        ] {
            assert!(
                path_in_site(&headers, path, "127.0.0.1:4177", "/docs/").is_none(),
                "{path}"
            );
        }
        headers.insert("host", HeaderValue::from_static("evil.example"));
        assert!(path_in_site(&headers, "/docs/", "127.0.0.1:4177", "/docs/").is_none());
    }
    #[test]
    fn owned_html_is_download_only_and_svg_uses_a_sandbox() {
        let mut resource = Resource {
            page_id: "p".into(),
            id: "r".into(),
            path: "assets/p/r.html".into(),
            mime: "text/html".into(),
            producer: "test".into(),
            profile: "test".into(),
            bytes: 1,
            sha256: "a".repeat(64),
        };
        let html = resource_response(&resource, vec![1], false);
        assert!(
            html.headers()["Content-Disposition"]
                .to_str()
                .unwrap()
                .starts_with("attachment;")
        );
        assert_eq!(html.headers()["X-Content-Type-Options"], "nosniff");
        resource.mime = "image/svg+xml".into();
        let svg = resource_response(&resource, vec![1], false);
        assert!(
            svg.headers()["Content-Security-Policy"]
                .to_str()
                .unwrap()
                .starts_with("sandbox;")
        );
        assert!(svg.headers().get("Content-Disposition").is_none());
    }
}
