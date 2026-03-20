use std::env;
use std::fs;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use std::{collections::HashMap, collections::HashSet, collections::VecDeque};

use axum::extract::{DefaultBodyLimit, Multipart, Path as AxumPath, Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::{extract::Request, response::Response, Json, Router};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use ed25519_dalek::{Signer as DalekSigner, SigningKey};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use postgres::{Client, NoTls};
use reqwest::multipart as reqwest_mp;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tower_http::cors::Any;
use tower_http::cors::CorsLayer;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::trace::TraceLayer;
use tracing::{error, info, warn};
use uuid::Uuid;
use tokio::sync::Mutex;

const RETRY_MAX_ATTEMPTS: u8 = 5;
const RETRY_DELAY_MS: u64 = 8_000;

async fn validate_solana_signer_config(rpc_url: &str, keypair_path: &str) {
    let kp_json = match std::fs::read_to_string(keypair_path) {
        Ok(v) => v,
        Err(e) => {
            error!("Cannot read keypair file {}: {}", keypair_path, e);
            return;
        }
    };

    let kp_bytes: Vec<u8> = match serde_json::from_str(&kp_json) {
        Ok(v) => v,
        Err(e) => {
            error!("Cannot parse keypair JSON at {}: {}", keypair_path, e);
            return;
        }
    };

    if kp_bytes.len() < 64 {
        error!("Keypair file {} is too short ({} bytes)", keypair_path, kp_bytes.len());
        return;
    }

    let secret: [u8; 32] = match kp_bytes[..32].try_into() {
        Ok(v) => v,
        Err(_) => {
            error!("Invalid secret key bytes in {}", keypair_path);
            return;
        }
    };
    let public: [u8; 32] = match kp_bytes[32..64].try_into() {
        Ok(v) => v,
        Err(_) => {
            error!("Invalid public key bytes in {}", keypair_path);
            return;
        }
    };

    let signing_key = SigningKey::from_bytes(&secret);
    let derived_public = signing_key.verifying_key().to_bytes();
    if derived_public != public {
        error!(
            "SYSTEM_KEYPAIR_PATH points to invalid keypair: public key does not match private key ({})",
            keypair_path
        );
        return;
    }

    let signer_pubkey_b58 = bs58::encode(public).into_string();
    info!("Solana signer pubkey: {}", signer_pubkey_b58);

    let client = reqwest::Client::new();
    let req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getBalance",
        "params": [signer_pubkey_b58, {"commitment": "confirmed"}]
    });

    let resp: serde_json::Value = match client.post(rpc_url).json(&req).send().await {
        Ok(v) => match v.json().await {
            Ok(j) => j,
            Err(e) => {
                warn!("Failed to parse getBalance response: {}", e);
                return;
            }
        },
        Err(e) => {
            warn!("Failed to call getBalance: {}", e);
            return;
        }
    };

    if let Some(err) = resp.get("error") {
        warn!("getBalance RPC error: {}", err);
        return;
    }

    let lamports = resp["result"]["value"].as_u64().unwrap_or(0);
    if lamports == 0 {
        warn!(
            "Solana signer has 0 lamports. On-chain registration will fail until this wallet is funded on devnet."
        );
    } else {
        info!("Solana signer balance: {} lamports", lamports);
    }
}

#[derive(Debug, Clone)]
struct RetryQueueItem {
    id: i64,
    log_id: String,
    retry_count: i32,
    max_attempts: i32,
    reason: String,
}

#[derive(Debug)]
struct IngestRateLimiter {
    requests_per_window: usize,
    window_ms: i64,
    buckets: Mutex<HashMap<String, VecDeque<i64>>>,
}

#[derive(Debug)]
struct ChatRateLimiter {
    max_requests_per_sec: usize,
    request_times: Mutex<VecDeque<std::time::Instant>>,
}

#[derive(Debug, Default)]
struct MetricsState {
    ingest_requests_total: AtomicU64,
    ingest_success_total: AtomicU64,
    ingest_rejected_total: AtomicU64,
    collector_ingest_requests_total: AtomicU64,
    collector_ingest_success_total: AtomicU64,
    collector_ingest_rejected_total: AtomicU64,
    collector_duplicate_total: AtomicU64,
    verify_requests_total: AtomicU64,
    verify_success_total: AtomicU64,
    verify_tampered_total: AtomicU64,
    retry_enqueued_total: AtomicU64,
    retry_success_total: AtomicU64,
    retry_failure_total: AtomicU64,
}

#[derive(Clone)]
struct AppState {
    max_upload_bytes: usize,
    env_name: Arc<String>,
    postgres_url: Arc<String>,
    pinata_jwt: Option<Arc<String>>,
    solana_rpc_url: Arc<String>,
    solana_program_id: Arc<String>,
    system_keypair_path: Option<Arc<String>>,
    ingest_api_key: Option<Arc<String>>,
    jwt_secret: Arc<String>,
    admin_allowlist: Arc<Vec<String>>,
    gemini_api_key: Option<Arc<String>>,
    ingest_limiter: Arc<IngestRateLimiter>,
    chat_limiter: Arc<ChatRateLimiter>,
    metrics: Arc<MetricsState>,
}

#[derive(Serialize)]
struct RetryJobItem {
    id: i64,
    #[serde(rename = "logId")]
    log_id: String,
    #[serde(rename = "retryCount")]
    retry_count: i32,
    #[serde(rename = "maxAttempts")]
    max_attempts: i32,
    reason: String,
    status: String,
    #[serde(rename = "nextAttemptAt")]
    next_attempt_at: i64,
    #[serde(rename = "lastAttemptedAt")]
    last_attempted_at: Option<i64>,
    #[serde(rename = "createdAt")]
    created_at: i64,
}

#[derive(Serialize)]
struct RetryJobsResponse {
    items: Vec<RetryJobItem>,
}

#[derive(Default, Deserialize)]
struct RetryJobsQuery {
    status: Option<String>,
}

#[derive(Serialize)]
struct KpiResponse {
    #[serde(rename = "ingestFailureRate")]
    ingest_failure_rate: f64,
    #[serde(rename = "retryBacklog")]
    retry_backlog: i64,
    #[serde(rename = "retryFailed")]
    retry_failed: i64,
    #[serde(rename = "auditCoveragePct")]
    audit_coverage_pct: f64,
    #[serde(rename = "mttrSeconds")]
    mttr_seconds: f64,
}

#[derive(Serialize)]
struct AuditLogItem {
    id: i64,
    #[serde(rename = "eventType")]
    event_type: String,
    #[serde(rename = "logId")]
    log_id: Option<String>,
    #[serde(rename = "deviceId")]
    device_id: Option<String>,
    #[serde(rename = "relatedData")]
    related_data: serde_json::Value,
    #[serde(rename = "actorWallet")]
    actor_wallet: Option<String>,
    #[serde(rename = "actorRole")]
    actor_role: Option<String>,
    #[serde(rename = "createdAt")]
    created_at: i64,
}

#[derive(Serialize)]
struct AuditLogResponse {
    items: Vec<AuditLogItem>,
}

#[derive(Default, Deserialize)]
struct AuditLogQuery {
    limit: Option<i64>,
    event_type: Option<String>,
    log_id: Option<String>,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
    version: &'static str,
    environment: String,
}

#[derive(Default, Deserialize)]
struct IngestMeta {
    device_id: Option<String>,
    timestamp: Option<i64>,
    format: Option<String>,
}

#[derive(Serialize)]
struct IngestResponse {
    request_id: String,
    log_id: String,
    device_id: String,
    timestamp: i64,
    format: String,
    file_name: Option<String>,
    file_size_bytes: usize,
    sha256: String,
    ipfs_cid: String,
    tx_signature: String,
    pda_address: String,
    status: String,
}

#[derive(Serialize)]
struct LogEntryDto {
    id: String,
    #[serde(rename = "deviceId")]
    device_id: String,
    timestamp: i64,
    #[serde(rename = "ipfsCid")]
    ipfs_cid: String,
    #[serde(rename = "hashOnChain")]
    hash_on_chain: String,
    format: String,
    #[serde(rename = "fileSize")]
    file_size: i64,
    status: String,
    #[serde(rename = "txSignature")]
    tx_signature: String,
    #[serde(rename = "pdaAddress")]
    pda_address: String,
}

#[derive(Serialize)]
struct ListLogsResponse {
    items: Vec<LogEntryDto>,
    total: i64,
    page: i64,
    page_size: i64,
}

#[derive(Deserialize)]
struct ListLogsQuery {
    page: Option<i64>,
    page_size: Option<i64>,
    search: Option<String>,
    status: Option<String>,
    format: Option<String>,
}

#[derive(Serialize)]
struct DashboardStatsResponse {
    #[serde(rename = "totalLogs")]
    total_logs: i64,
    #[serde(rename = "verifiedLogs")]
    verified_logs: i64,
    #[serde(rename = "tamperedLogs")]
    tampered_logs: i64,
    #[serde(rename = "activeDevices")]
    active_devices: i64,
    #[serde(rename = "totalStorage")]
    total_storage: String,
    #[serde(rename = "networkStatus")]
    network_status: &'static str,
}

#[derive(Serialize)]
struct ActivityItemDto {
    id: String,
    #[serde(rename = "type")]
    activity_type: String,
    message: String,
    timestamp: i64,
    #[serde(rename = "deviceId")]
    device_id: Option<String>,
    status: Option<String>,
}

#[derive(Serialize)]
struct VerifyResponse {
    #[serde(rename = "logId")]
    log_id: String,
    #[serde(rename = "expectedHash")]
    expected_hash: String,
    #[serde(rename = "actualHash")]
    actual_hash: String,
    verified: bool,
    status: String,
    #[serde(rename = "onChainVerified")]
    on_chain_verified: Option<bool>,
}

#[derive(Deserialize)]
struct ReportLogRequest {
    report_flag: String,
    report_reason: Option<String>,
}

#[derive(Serialize)]
struct ReportLogResponse {
    #[serde(rename = "logId")]
    log_id: String,
    #[serde(rename = "reportFlag")]
    report_flag: String,
    #[serde(rename = "reportedByWallet")]
    reported_by_wallet: String,
    #[serde(rename = "reportedByRole")]
    reported_by_role: String,
    status: String,
}

#[derive(Serialize)]
struct ReportedLogDto {
    id: i64,
    #[serde(rename = "logId")]
    log_id: String,
    #[serde(rename = "deviceId")]
    device_id: String,
    #[serde(rename = "reportFlag")]
    report_flag: String,
    #[serde(rename = "reportReason")]
    report_reason: Option<String>,
    #[serde(rename = "reportedByWallet")]
    reported_by_wallet: String,
    #[serde(rename = "reportedByRole")]
    reported_by_role: String,
    #[serde(rename = "createdAt")]
    created_at: i64,
    status: String,
}

#[derive(Serialize)]
struct ListReportedLogsResponse {
    items: Vec<ReportedLogDto>,
    total: i64,
    page: i64,
    page_size: i64,
}

#[derive(Deserialize)]
struct ListReportedLogsQuery {
    page: Option<i64>,
    page_size: Option<i64>,
}

#[derive(Serialize)]
struct LogContentResponse {
    id: String,
    content: String,
}

#[derive(Deserialize)]
struct WalletLoginRequest {
    wallet_address: String,
}

#[derive(Serialize)]
struct WalletLoginResponse {
    token: String,
    role: String,
    wallet_address: String,
    expires_at: i64,
}

#[derive(Serialize)]
struct LogoutResponse {
    status: &'static str,
}

#[derive(Deserialize)]
struct SupportChatRequest {
    prompt: String,
    recent_error: Option<String>,
}

#[derive(Serialize)]
struct SupportChatResponse {
    answer: String,
}

#[derive(Serialize)]
struct WalletRoleItem {
    wallet_address: String,
    role: String,
    granted_by: String,
    granted_at: i64,
}

#[derive(Serialize)]
struct WalletRolesResponse {
    items: Vec<WalletRoleItem>,
}

#[derive(Deserialize)]
struct UpsertWalletRoleRequest {
    wallet_address: String,
    role: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct AuthClaims {
    sub: String,
    role: String,
    exp: usize,
}

#[derive(Deserialize)]
struct FluentdIngestPayload {
    device_id: Option<String>,
    timestamp: Option<i64>,
    format: Option<String>,
    agent_id: Option<String>,
    source_type: Option<String>,
    seq_no: Option<i64>,
    batch_id: Option<String>,
    idempotency_key: Option<String>,
    message: String,
}

#[derive(Debug)]
enum ApiError {
    BadRequest(String),
    Unauthorized(String),
    NotFound(String),
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        match self {
            ApiError::BadRequest(msg) => {
                let body = Json(serde_json::json!({ "error": msg }));
                (StatusCode::BAD_REQUEST, body).into_response()
            }
            ApiError::Unauthorized(msg) => {
                let body = Json(serde_json::json!({ "error": msg }));
                (StatusCode::UNAUTHORIZED, body).into_response()
            }
            ApiError::NotFound(msg) => {
                let body = Json(serde_json::json!({ "error": msg }));
                (StatusCode::NOT_FOUND, body).into_response()
            }
            ApiError::Internal(msg) => {
                let body = Json(serde_json::json!({ "error": msg }));
                (StatusCode::INTERNAL_SERVER_ERROR, body).into_response()
            }
        }
    }
}

#[tokio::main]
async fn main() {
    // Load .env – walk up from the binary location (works with cargo debug builds)
    load_dotenv();

    tracing_subscriber::fmt()
        .with_env_filter(
            env::var("RUST_LOG")
                .unwrap_or_else(|_| "log_guardian_backend=debug,tower_http=info".to_string()),
        )
        .init();

    let port = env::var("BACKEND_PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(9000);
    let max_upload_bytes = env::var("MAX_UPLOAD_BYTES")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(10 * 1024 * 1024);
    let environment = env::var("APP_ENV").unwrap_or_else(|_| "development".to_string());
    let postgres_url = env::var("POSTGRES_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@127.0.0.1:5432/log_guardian".to_string());

    let pinata_jwt = env::var("PINATA_JWT")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .map(Arc::new);
    let solana_rpc_url = Arc::new(
        env::var("SOLANA_RPC_URL")
            .unwrap_or_else(|_| "https://api.devnet.solana.com".to_string()),
    );
    let solana_program_id = Arc::new(
        env::var("SOLANA_PROGRAM_ID")
            .unwrap_or_else(|_| "6enXBVJChBad8Bs7yYjZkwzxGvVtTW7hNok3YLep5tF3".to_string()),
    );
    let system_keypair_path = env::var("SYSTEM_KEYPAIR_PATH")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .map(Arc::new);
    let ingest_api_key = env::var("INGEST_API_KEY")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .map(Arc::new);
    let jwt_secret = Arc::new(
        env::var("JWT_SECRET")
            .unwrap_or_else(|_| "dev-only-change-me".to_string()),
    );
    let admin_allowlist = Arc::new(
        env::var("ADMIN_WALLET_ALLOWLIST")
            .unwrap_or_default()
            .split(',')
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .collect::<Vec<_>>(),
    );
    let gemini_api_key = env::var("GEMINI_API_KEY")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .map(Arc::new);
    let requests_per_window = env::var("INGEST_RATE_LIMIT")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(30);
    let window_ms = env::var("INGEST_RATE_WINDOW_MS")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(60_000);
    if pinata_jwt.is_some() {
        info!("Pinata IPFS integration ENABLED");
    } else {
        warn!("PINATA_JWT not set – using fake CIDs");
    }
    if system_keypair_path.is_some() {
        info!("Solana Memo integration ENABLED (RPC: {})", &solana_rpc_url[..solana_rpc_url.find('?').unwrap_or(solana_rpc_url.len())]);
    } else {
        warn!("SYSTEM_KEYPAIR_PATH not set – using fake tx signatures");
    }
    if ingest_api_key.is_some() {
        info!("Ingest API key auth ENABLED");
    } else {
        warn!("INGEST_API_KEY not set – ingest endpoint is public");
    }

    if let Some(path) = system_keypair_path.as_ref() {
        validate_solana_signer_config(solana_rpc_url.as_ref(), path.as_ref()).await;
    }

    let migration_url = postgres_url.clone();
    tokio::task::spawn_blocking(move || init_db(&migration_url))
        .await
        .expect("migration task join failure")
        .expect("failed to initialize postgres schema");

    let state = AppState {
        max_upload_bytes,
        env_name: Arc::new(environment),
        postgres_url: Arc::new(postgres_url),
        pinata_jwt,
        solana_rpc_url,
        solana_program_id,
        system_keypair_path,
        ingest_api_key,
        jwt_secret,
        admin_allowlist,
        gemini_api_key,
        ingest_limiter: Arc::new(IngestRateLimiter {
            requests_per_window,
            window_ms,
            buckets: Mutex::new(HashMap::new()),
        }),
        chat_limiter: Arc::new(ChatRateLimiter {
            max_requests_per_sec: 2,
            request_times: Mutex::new(VecDeque::new()),
        }),
        metrics: Arc::new(MetricsState::default()),
    };

    spawn_retry_worker(state.clone());

    let app = Router::new()
        .route("/health", get(health))
        .route("/metrics", get(metrics))
        .route("/api/v1/auth/wallet/login", post(wallet_login))
        .route("/api/v1/auth/logout", post(logout))
        .route("/api/v1/logs/ingest", post(ingest_log))
        .route("/api/v1/logs/ingest/fluentd", post(ingest_fluentd))
        .route("/api/v1/logs", get(list_logs))
        .route("/api/v1/logs/reports", get(list_reported_logs))
        .route("/api/v1/logs/{id}/report", post(report_log))
        .route("/api/v1/logs/{id}/verify", post(verify_log))
        .route("/api/v1/logs/{id}/content", get(get_log_content))
        .route("/api/v1/dashboard/stats", get(get_dashboard_stats))
        .route("/api/v1/activity", get(get_activity))
        .route(
            "/api/v1/admin/roles",
            get(admin_list_roles).post(admin_upsert_role),
        )
        .route(
            "/api/v1/admin/roles/{wallet_address}",
            delete(admin_revoke_role),
        )
        .route("/api/v1/admin/retry-jobs", get(admin_list_retry_jobs))
        .route("/api/v1/admin/retry-jobs/{id}/retry", post(admin_retry_job_now))
        .route("/api/v1/admin/kpis", get(admin_kpis))
        .route("/api/v1/admin/audit-log", get(admin_list_audit_log))
        .route("/api/v1/admin/support/chat", post(admin_support_chat))
        .with_state(state)
        .layer(middleware::from_fn(attach_request_id))
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(25 * 1024 * 1024))
        .layer(CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any))
        .layer(TraceLayer::new_for_http());

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    info!("backend listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind tcp listener");

    if let Err(err) = axum::serve(listener, app).await {
        error!("server exited with error: {}", err);
    }
}

/// Walk up from the binary directory to find and load a `.env` file.
/// Handles both `cargo run` (CWD = project root) and running the binary from `target/debug/`.
fn load_dotenv() {
    let mut dirs: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        dirs.push(cwd);
    }
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(|p| p.to_path_buf());
        for _ in 0..4 {
            if let Some(d) = dir {
                if !dirs.contains(&d) {
                    dirs.push(d.clone());
                }
                dir = d.parent().map(|p| p.to_path_buf());
            } else {
                break;
            }
        }
    }
    for dir in &dirs {
        let env_file = dir.join(".env");
        if let Ok(content) = std::fs::read_to_string(&env_file) {
            for line in content.lines() {
                let line = line.trim_start_matches('\u{feff}').trim(); // strip BOM
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                if let Some((key, val)) = line.split_once('=') {
                    let key = key.trim();
                    let val = val.trim();
                    if !key.is_empty() && std::env::var(key).is_err() {
                        // Only set if not already set by real environment
                        unsafe { std::env::set_var(key, val) };
                    }
                }
            }
            eprintln!("[info] Loaded .env from {}", env_file.display());
            return; // stop at first found file
        }
    }
    eprintln!("[warn] No .env file found – using process environment only");
}

fn now_epoch_ms() -> i64 {
    let now = std::time::SystemTime::now();
    match now.duration_since(std::time::UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as i64,
        Err(_) => 0,
    }
}

fn resolve_migrations_dir() -> Option<std::path::PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("sql").join("migrations"));
    }
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(|p| p.to_path_buf());
        for _ in 0..5 {
            if let Some(d) = dir {
                candidates.push(d.join("sql").join("migrations"));
                dir = d.parent().map(|p| p.to_path_buf());
            } else {
                break;
            }
        }
    }
    candidates.into_iter().find(|p| p.exists())
}

fn init_db(postgres_url: &str) -> Result<(), String> {
    let mut client =
        Client::connect(postgres_url, NoTls).map_err(|e| format!("postgres connect failed: {e:?}"))?;

    let migrations_dir =
        resolve_migrations_dir().ok_or_else(|| "sql/migrations directory not found".to_string())?;

    let mut files = fs::read_dir(migrations_dir)
        .map_err(|e| format!("failed to read migrations dir: {e}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "sql"))
        .collect::<Vec<_>>();
    files.sort();

    for path in files {
        let sql = fs::read_to_string(&path)
            .map_err(|e| format!("failed reading migration {}: {e}", path.display()))?;
        client
            .batch_execute(&sql)
            .map_err(|e| format!("failed running migration {}: {e}", path.display()))?;
    }

    Ok(())
}

async fn with_conn<T, F>(state: &AppState, op: F) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce(&mut Client) -> Result<T, ApiError> + Send + 'static,
{
    let postgres_url = state.postgres_url.as_ref().to_string();
    tokio::task::spawn_blocking(move || {
        let mut conn = Client::connect(&postgres_url, NoTls)
            .map_err(|e| ApiError::Internal(format!("failed to connect postgres: {e:?}")))?;
        op(&mut conn)
    })
    .await
    .map_err(|e| ApiError::Internal(format!("database task join error: {e}")))?
}

fn spawn_retry_worker(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(RETRY_DELAY_MS));
        loop {
            interval.tick().await;
            if let Err(err) = process_pending_retry_jobs(&state).await {
                error!("Retry worker cycle failed: {:?}", err);
            }
        }
    });
}

async fn write_audit_log(
    state: &AppState,
    event_type: &str,
    log_id: Option<String>,
    device_id: Option<String>,
    related_data: serde_json::Value,
    actor_wallet: Option<String>,
    actor_role: Option<String>,
) {
    let event_type = event_type.to_string();
    let related_data = related_data.to_string();
    if let Err(err) = with_conn(state, move |conn| {
        conn.execute(
            "INSERT INTO audit_log(event_type, log_id, device_id, related_data, actor_wallet, actor_role, created_at)
             VALUES ($1, $2, $3, $4::jsonb, $5, $6, NOW())",
            &[&event_type, &log_id, &device_id, &related_data, &actor_wallet, &actor_role],
        )
        .map_err(|e| ApiError::Internal(format!("failed inserting audit_log event: {e}")))?;
        Ok(())
    })
    .await
    {
        warn!("audit write failed: {:?}", err);
    }
}

async fn enqueue_retry_job(state: &AppState, log_id: &str, reason: &str) {
    let log_id_owned = log_id.to_string();
    let reason_owned = reason.to_string();
    let enqueue = with_conn(state, move |conn| {
        conn.execute(
            "INSERT INTO retry_jobs(log_id, retry_count, max_attempts, reason, status, next_attempt_at, created_at)
             SELECT $1, 0, $2, $3, 'pending', NOW(), NOW()
             WHERE NOT EXISTS (
               SELECT 1 FROM retry_jobs WHERE log_id = $1 AND status IN ('pending', 'running')
             )",
            &[&log_id_owned, &(RETRY_MAX_ATTEMPTS as i32), &reason_owned],
        )
        .map_err(|e| ApiError::Internal(format!("failed enqueue retry job: {e}")))?;
        Ok(())
    })
    .await;

    match enqueue {
        Ok(_) => {
            state
                .metrics
                .retry_enqueued_total
                .fetch_add(1, Ordering::Relaxed);
            write_audit_log(
                state,
                "retry_job_created",
                Some(log_id.to_string()),
                None,
                serde_json::json!({ "reason": reason }),
                None,
                None,
            )
            .await;
        }
        Err(err) => {
            error!("Failed to enqueue retry job in DB: {:?}", err);
            state
                .metrics
                .retry_failure_total
                .fetch_add(1, Ordering::Relaxed);
        }
    }
}

async fn process_pending_retry_jobs(state: &AppState) -> Result<(), ApiError> {
    let jobs = with_conn(state, move |conn| {
        let rows = conn
            .query(
                "UPDATE retry_jobs
                 SET status = 'running', last_attempted_at = NOW(), retry_count = retry_count + 1
                 WHERE id IN (
                    SELECT id FROM retry_jobs
                    WHERE status = 'pending' AND next_attempt_at <= NOW()
                    ORDER BY next_attempt_at ASC
                    LIMIT 25
                 )
                 RETURNING id, log_id, retry_count, max_attempts, reason",
                &[],
            )
            .map_err(|e| ApiError::Internal(format!("failed claiming retry jobs: {e}")))?;

        let mut items = Vec::<RetryQueueItem>::new();
        for row in rows {
            items.push(RetryQueueItem {
                id: row.get(0),
                log_id: row.get(1),
                retry_count: row.get(2),
                max_attempts: row.get(3),
                reason: row.get(4),
            });
        }
        Ok(items)
    })
    .await?;

    for job in jobs {
        process_single_retry_job(state, job).await;
    }

    Ok(())
}

async fn process_single_retry_job(state: &AppState, job: RetryQueueItem) {
    let log_id_lookup = job.log_id.clone();
    let source = with_conn(state, move |conn| {
        let row = conn
            .query_opt(
                "SELECT hash, raw_content, ipfs_cid, device_id FROM logs WHERE id = $1",
                &[&log_id_lookup],
            )
            .map_err(|e| ApiError::Internal(format!("failed loading retry source log: {e}")))?;

        match row {
            Some(r) => Ok((
                r.get::<_, String>(0),
                r.get::<_, Vec<u8>>(1),
                r.get::<_, String>(2),
                r.get::<_, String>(3),
            )),
            None => Err(ApiError::NotFound("retry source log not found".to_string())),
        }
    })
    .await;

    let (sha256, raw_bytes, existing_ipfs_cid, device_id) = match source {
        Ok(v) => v,
        Err(err) => {
            error!("Retry source lookup failed for log {}: {:?}", job.log_id, err);
            let retry_id = job.id;
            let _ = with_conn(state, move |conn| {
                conn.execute(
                    "UPDATE retry_jobs SET status='failed', completed_at = NOW() WHERE id = $1",
                    &[&retry_id],
                )
                .map_err(|e| ApiError::Internal(format!("failed finalizing missing retry source: {e}")))?;
                Ok(())
            })
            .await;
            state.metrics.retry_failure_total.fetch_add(1, Ordering::Relaxed);
            return;
        }
    };

    let mut cid = if job.reason.starts_with("pinata") {
        None
    } else {
        Some(existing_ipfs_cid)
    };

    if cid.is_none() {
        if let Some(jwt) = &state.pinata_jwt {
            cid = upload_to_pinata(
                jwt.as_ref(),
                raw_bytes.clone(),
                format!("{}.retry.log", job.log_id),
            )
            .await;
        }
    }

    let mut tx_signature: Option<String> = None;
    if let (Some(kp_path), Some(final_cid)) = (&state.system_keypair_path, cid.clone()) {
        let memo_payload = format!(
            "{{\"log_id\":\"{}\",\"sha256\":\"{}\",\"cid\":\"{}\"}}",
            job.log_id, sha256, final_cid
        );
        tx_signature = send_memo_to_solana(
            state.solana_rpc_url.as_ref().clone(),
            kp_path.as_ref().clone(),
            memo_payload,
        )
        .await;
    }

    if let (Some(final_cid), Some(final_sig)) = (cid.clone(), tx_signature.clone()) {
        let job_id = job.id;
        let log_id = job.log_id.clone();
        let update = with_conn(state, move |conn| {
            conn.execute(
                "UPDATE logs
                 SET ipfs_cid = $1,
                     blockchain_tx_id = $2,
                     pda_address = $2,
                     verification_status = 'confirmed',
                     retry_count = COALESCE(retry_count, 0) + 1,
                     updated_at = NOW()
                 WHERE id = $3",
                &[&final_cid, &final_sig, &log_id],
            )
            .map_err(|e| ApiError::Internal(format!("failed applying retry result to log: {e}")))?;

            conn.execute(
                "UPDATE retry_jobs SET status='completed', completed_at = NOW() WHERE id = $1",
                &[&job_id],
            )
            .map_err(|e| ApiError::Internal(format!("failed completing retry job: {e}")))?;
            Ok(())
        })
        .await;

        match update {
            Ok(_) => {
                state.metrics.retry_success_total.fetch_add(1, Ordering::Relaxed);
                write_audit_log(
                    state,
                    "retry_job_completed",
                    Some(job.log_id.clone()),
                    Some(device_id),
                    serde_json::json!({
                        "retry_job_id": job.id,
                        "attempt": job.retry_count,
                        "reason": job.reason,
                    }),
                    None,
                    None,
                )
                .await;
                info!("Retry worker completed log_id={}", job.log_id);
            }
            Err(err) => {
                error!("Retry completion update failed for {}: {:?}", job.log_id, err);
                state.metrics.retry_failure_total.fetch_add(1, Ordering::Relaxed);
            }
        }
        return;
    }

    let retry_id = job.id;
    if job.retry_count >= job.max_attempts {
        let _ = with_conn(state, move |conn| {
            conn.execute(
                "UPDATE retry_jobs SET status='failed', completed_at = NOW() WHERE id = $1",
                &[&retry_id],
            )
            .map_err(|e| ApiError::Internal(format!("failed marking retry job failed: {e}")))?;
            Ok(())
        })
        .await;
        state.metrics.retry_failure_total.fetch_add(1, Ordering::Relaxed);
        write_audit_log(
            state,
            "retry_job_failed",
            Some(job.log_id),
            Some(device_id),
            serde_json::json!({
                "retry_job_id": job.id,
                "attempt": job.retry_count,
                "reason": job.reason,
            }),
            None,
            None,
        )
        .await;
    } else {
        let retry_id = job.id;
        let exponent: u32 = if job.retry_count <= 1 {
            0
        } else {
            (job.retry_count - 1).min(6) as u32
        };
        let delay_seconds = ((RETRY_DELAY_MS / 1000) as i64) * (1_i64 << exponent);
        let _ = with_conn(state, move |conn| {
            conn.execute(
                "UPDATE retry_jobs
                 SET status='pending', next_attempt_at = NOW() + ($2 || ' seconds')::interval
                 WHERE id = $1",
                &[&retry_id, &delay_seconds],
            )
            .map_err(|e| ApiError::Internal(format!("failed requeueing retry job: {e}")))?;
            Ok(())
        })
        .await;
    }
}

async fn attach_request_id(request: Request, next: Next) -> Response {
    let request_id = Uuid::new_v4().to_string();
    let mut response = next.run(request).await;
    if let Ok(value) = HeaderValue::from_str(&request_id) {
        response.headers_mut().insert("x-request-id", value);
    }
    response
}

fn header_client_key(headers: &HeaderMap) -> String {
    let forwarded = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string());
    if let Some(ip) = forwarded {
        return ip;
    }
    headers
        .get("x-real-ip")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

async fn enforce_ingest_policies(state: &AppState, headers: &HeaderMap) -> Result<(), ApiError> {
    if let Some(api_key) = &state.ingest_api_key {
        let supplied = headers
            .get("x-api-key")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
            .or_else(|| {
                headers
                    .get("authorization")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|s| s.strip_prefix("Bearer "))
                    .map(|s| s.trim().to_string())
            });
        if supplied.as_deref() != Some(api_key.as_ref()) {
            return Err(ApiError::BadRequest("missing/invalid ingest API key".to_string()));
        }
    }

    let key = header_client_key(headers);
    let now = now_epoch_ms();
    let mut buckets = state.ingest_limiter.buckets.lock().await;
    let bucket = buckets.entry(key).or_insert_with(VecDeque::new);
    while let Some(ts) = bucket.front() {
        if now - *ts > state.ingest_limiter.window_ms {
            let _ = bucket.pop_front();
        } else {
            break;
        }
    }
    if bucket.len() >= state.ingest_limiter.requests_per_window {
        return Err(ApiError::BadRequest("rate limit exceeded for ingest endpoint".to_string()));
    }
    bucket.push_back(now);
    Ok(())
}

/// Upload raw bytes to Pinata IPFS. Returns the CIDv1 on success.
async fn upload_to_pinata(jwt: &str, bytes: Vec<u8>, file_name: String) -> Option<String> {
    let client = reqwest::Client::new();
    let part = reqwest_mp::Part::bytes(bytes)
        .file_name(file_name)
        .mime_str("application/octet-stream")
        .ok()?;
    let form = reqwest_mp::Form::new().part("file", part);
    let resp = client
        .post("https://api.pinata.cloud/pinning/pinFileToIPFS")
        .header("Authorization", format!("Bearer {jwt}"))
        .multipart(form)
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        error!("Pinata returned HTTP {}: {}", status, body);
        return None;
    }
    let json: serde_json::Value = resp.json().await.ok()?;
    json["IpfsHash"].as_str().map(|s| s.to_string())
}

/// Sign and send a Memo Program transaction to Solana via plain JSON-RPC.
/// Pure Rust – no openssl dependency.
async fn send_memo_to_solana(rpc_url: String, keypair_path: String, memo: String) -> Option<String> {
    // ── 1. Load keypair from JSON byte-array file ───────────────────────────
    let kp_json = std::fs::read_to_string(&keypair_path)
        .map_err(|e| error!("Cannot read keypair file {}: {}", keypair_path, e))
        .ok()?;
    let kp_bytes: Vec<u8> = serde_json::from_str(&kp_json)
        .map_err(|e| error!("Cannot parse keypair JSON: {}", e))
        .ok()?;
    if kp_bytes.len() < 64 {
        error!("Keypair file is too short ({} bytes)", kp_bytes.len());
        return None;
    }

    let secret: [u8; 32] = kp_bytes[..32].try_into().ok()?;
    let signing_key = SigningKey::from_bytes(&secret);
    let derived_public = signing_key.verifying_key().to_bytes();

    // Keep signer deterministic even if file public bytes are stale/malformed.
    if let Ok(file_public) = <[u8; 32]>::try_from(&kp_bytes[32..64]) {
        if file_public != derived_public {
            warn!(
                "Keypair public bytes do not match secret key at {}. Using derived public key instead.",
                keypair_path
            );
        }
    }

    // Memo Program v2 – raw public key bytes (base58: MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr)
    let memo_program: [u8; 32] = bs58::decode("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")
        .into_vec()
        .ok()?
        .try_into()
        .ok()?;

    let client = reqwest::Client::new();

    // On devnet, try to self-heal empty wallets once before sending.
    if rpc_url.contains("devnet") {
        let signer_pubkey_b58 = bs58::encode(derived_public).into_string();
        let balance_req = serde_json::json!({
            "jsonrpc": "2.0", "id": 1,
            "method": "getBalance",
            "params": [signer_pubkey_b58, {"commitment": "confirmed"}]
        });
        if let Ok(resp) = client.post(&rpc_url).json(&balance_req).send().await {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                let lamports = json["result"]["value"].as_u64().unwrap_or(0);
                if lamports == 0 {
                    warn!(
                        "Solana signer has 0 lamports; attempting devnet airdrop before memo send"
                    );
                    let airdrop_req = serde_json::json!({
                        "jsonrpc": "2.0", "id": 1,
                        "method": "requestAirdrop",
                        "params": [bs58::encode(derived_public).into_string(), 10000000]
                    });
                    match client.post(&rpc_url).json(&airdrop_req).send().await {
                        Ok(airdrop_resp) => {
                            let airdrop_json: serde_json::Value = airdrop_resp.json().await.unwrap_or_default();
                            if let Some(err) = airdrop_json.get("error") {
                                warn!("Devnet airdrop failed: {}", err);
                            } else {
                                info!("Devnet airdrop requested successfully for signer wallet");
                            }
                        }
                        Err(e) => warn!("Devnet airdrop request error: {}", e),
                    }
                }
            }
        }
    }

    // ── 2. Get recent blockhash ─────────────────────────────────────────────
    let bh_req = serde_json::json!({
        "jsonrpc": "2.0", "id": 1,
        "method": "getLatestBlockhash",
        "params": [{"commitment": "confirmed"}]
    });
    let bh_resp: serde_json::Value = client
        .post(&rpc_url)
        .json(&bh_req)
        .send()
        .await
        .map_err(|e| error!("getLatestBlockhash HTTP error: {}", e))
        .ok()?
        .json()
        .await
        .map_err(|e| error!("getLatestBlockhash JSON parse error: {}", e))
        .ok()?;
    let blockhash_str = bh_resp["result"]["value"]["blockhash"]
        .as_str()
        .ok_or_else(|| error!("Missing blockhash in response: {}", bh_resp))
        .ok()?;
    let blockhash: [u8; 32] = bs58::decode(blockhash_str)
        .into_vec()
        .ok()?
        .try_into()
        .ok()?;

    // ── 3. Build Solana transaction message ────────────────────────────────
    // Compact-u16 helper (Solana's variable-length integer format)
    fn cu16(n: usize) -> Vec<u8> {
        if n <= 0x7f {
            vec![n as u8]
        } else if n <= 0x3fff {
            vec![(n & 0x7f | 0x80) as u8, (n >> 7) as u8]
        } else {
            vec![(n & 0x7f | 0x80) as u8, ((n >> 7) & 0x7f | 0x80) as u8, (n >> 14) as u8]
        }
    }

    let memo_bytes = memo.as_bytes();
    let mut msg: Vec<u8> = Vec::new();
    // Header
    msg.push(1); // num_required_signatures
    msg.push(0); // num_readonly_signed_accounts
    msg.push(1); // num_readonly_unsigned_accounts
    // Account keys
    msg.extend(cu16(2));
    msg.extend_from_slice(&derived_public);
    msg.extend_from_slice(&memo_program);
    // Recent blockhash
    msg.extend_from_slice(&blockhash);
    // Instructions: 1 instruction
    msg.extend(cu16(1));
    msg.push(1); // program_id_index (memo_program is at index 1)
    msg.extend(cu16(0)); // no account references
    msg.extend(cu16(memo_bytes.len()));
    msg.extend_from_slice(memo_bytes);

    // ── 4. Sign ─────────────────────────────────────────────────────────────
    let sig = signing_key.sign(&msg);
    let sig_bytes = sig.to_bytes();

    // ── 5. Serialize transaction (signatures || message) ───────────────────
    let mut tx: Vec<u8> = Vec::new();
    tx.extend(cu16(1)); // 1 signature
    tx.extend_from_slice(&sig_bytes);
    tx.extend_from_slice(&msg);
    let tx_b64 = B64.encode(&tx);

    // ── 6. Send transaction ─────────────────────────────────────────────────
    let send_req = serde_json::json!({
        "jsonrpc": "2.0", "id": 1,
        "method": "sendTransaction",
        "params": [tx_b64, {"encoding": "base64", "preflightCommitment": "confirmed"}]
    });
    let send_resp: serde_json::Value = client
        .post(&rpc_url)
        .json(&send_req)
        .send()
        .await
        .map_err(|e| error!("sendTransaction HTTP error: {}", e))
        .ok()?
        .json()
        .await
        .map_err(|e| error!("sendTransaction JSON parse error: {}", e))
        .ok()?;

    if let Some(err) = send_resp.get("error") {
        error!("Solana RPC error: {}", err);
        if err.to_string().contains("AccountNotFound") || err.to_string().contains("InvalidAccountForFee") {
            warn!(
                "Signer wallet cannot pay fee yet. Fund SYSTEM_KEYPAIR_PATH wallet on devnet to enable on-chain memo registration."
            );
        }
        return None;
    }
    send_resp["result"].as_str().map(|s| s.to_string())
}

fn fake_ipfs_cid(hash: &str) -> String {
    format!("bafy{}", &hash[..52.min(hash.len())])
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "log-guardian-backend",
        version: "0.2.0",
        environment: state.env_name.as_ref().to_string(),
    })
}

async fn metrics(State(state): State<AppState>) -> impl IntoResponse {
    let body = format!(
        "# TYPE log_guardian_ingest_requests_total counter\n\
log_guardian_ingest_requests_total {}\n\
# TYPE log_guardian_ingest_success_total counter\n\
log_guardian_ingest_success_total {}\n\
# TYPE log_guardian_ingest_rejected_total counter\n\
log_guardian_ingest_rejected_total {}\n\
# TYPE log_guardian_collector_ingest_requests_total counter\n\
log_guardian_collector_ingest_requests_total {}\n\
# TYPE log_guardian_collector_ingest_success_total counter\n\
log_guardian_collector_ingest_success_total {}\n\
# TYPE log_guardian_collector_ingest_rejected_total counter\n\
log_guardian_collector_ingest_rejected_total {}\n\
# TYPE log_guardian_collector_duplicate_total counter\n\
log_guardian_collector_duplicate_total {}\n\
# TYPE log_guardian_verify_requests_total counter\n\
log_guardian_verify_requests_total {}\n\
# TYPE log_guardian_verify_success_total counter\n\
log_guardian_verify_success_total {}\n\
# TYPE log_guardian_verify_tampered_total counter\n\
log_guardian_verify_tampered_total {}\n\
# TYPE log_guardian_retry_enqueued_total counter\n\
log_guardian_retry_enqueued_total {}\n\
# TYPE log_guardian_retry_success_total counter\n\
log_guardian_retry_success_total {}\n\
# TYPE log_guardian_retry_failure_total counter\n\
log_guardian_retry_failure_total {}\n",
        state.metrics.ingest_requests_total.load(Ordering::Relaxed),
        state.metrics.ingest_success_total.load(Ordering::Relaxed),
        state.metrics.ingest_rejected_total.load(Ordering::Relaxed),
        state
            .metrics
            .collector_ingest_requests_total
            .load(Ordering::Relaxed),
        state
            .metrics
            .collector_ingest_success_total
            .load(Ordering::Relaxed),
        state
            .metrics
            .collector_ingest_rejected_total
            .load(Ordering::Relaxed),
        state
            .metrics
            .collector_duplicate_total
            .load(Ordering::Relaxed),
        state.metrics.verify_requests_total.load(Ordering::Relaxed),
        state.metrics.verify_success_total.load(Ordering::Relaxed),
        state.metrics.verify_tampered_total.load(Ordering::Relaxed),
        state.metrics.retry_enqueued_total.load(Ordering::Relaxed),
        state.metrics.retry_success_total.load(Ordering::Relaxed),
        state.metrics.retry_failure_total.load(Ordering::Relaxed),
    );
    (
        [(axum::http::header::CONTENT_TYPE, "text/plain; version=0.0.4")],
        body,
    )
}

async fn ingest_log(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<IngestResponse>, ApiError> {
    state
        .metrics
        .ingest_requests_total
        .fetch_add(1, Ordering::Relaxed);
    if let Err(err) = enforce_ingest_policies(&state, &headers).await {
        state
            .metrics
            .ingest_rejected_total
            .fetch_add(1, Ordering::Relaxed);
        return Err(err);
    }

    let mut meta = IngestMeta::default();
    let mut has_file = false;
    let mut file_name: Option<String> = None;
    let mut hasher = Sha256::new();
    let mut total_bytes = 0usize;
    let mut raw_bytes = Vec::<u8>::new();

    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|e| ApiError::BadRequest(format!("invalid multipart data: {e}")))?
    {
        let field_name = field.name().unwrap_or("").to_string();
        match field_name.as_str() {
            "device_id" => {
                meta.device_id = Some(
                    field
                        .text()
                        .await
                        .map_err(|e| ApiError::BadRequest(format!("invalid device_id value: {e}")))?,
                )
            }
            "timestamp" => {
                let raw = field
                    .text()
                    .await
                    .map_err(|e| ApiError::BadRequest(format!("invalid timestamp value: {e}")))?;
                meta.timestamp = raw.parse::<i64>().ok();
            }
            "format" => {
                meta.format = Some(
                    field
                        .text()
                        .await
                        .map_err(|e| ApiError::BadRequest(format!("invalid format value: {e}")))?,
                )
            }
            "file" => {
                has_file = true;
                file_name = field.file_name().map(|n| n.to_string());

                while let Some(chunk) = field
                    .chunk()
                    .await
                    .map_err(|e| ApiError::BadRequest(format!("failed reading file chunk: {e}")))?
                {
                    total_bytes += chunk.len();
                    if total_bytes > state.max_upload_bytes {
                        return Err(ApiError::BadRequest(format!(
                            "file exceeded MAX_UPLOAD_BYTES ({} bytes)",
                            state.max_upload_bytes
                        )));
                    }
                    hasher.update(&chunk);
                    raw_bytes.extend_from_slice(&chunk);
                }
            }
            _ => {
                let _ = field.bytes().await;
            }
        }
    }

    if !has_file {
        return Err(ApiError::BadRequest(
            "missing multipart file field named 'file'".to_string(),
        ));
    }

    let device_id = meta
        .device_id
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "unknown-device".to_string());

    let timestamp = meta.timestamp.unwrap_or_else(now_epoch_ms);
    let format = meta.format.unwrap_or_else(|| "Plain Text".to_string());
    let sha256 = hex::encode(hasher.finalize());
    let log_id = format!("log-{}", Uuid::new_v4().simple());

    // ── Real Pinata IPFS upload ──────────────────────────────────────────────
    let mut pinata_failed = false;
    let ipfs_cid = if let Some(jwt) = &state.pinata_jwt {
        let fname = file_name.clone().unwrap_or_else(|| format!("{log_id}.log"));
        match upload_to_pinata(jwt.as_ref(), raw_bytes.clone(), fname).await {
            Some(cid) => {
                info!("Pinata upload OK: ipfs://{}", cid);
                cid
            }
            None => {
                warn!("Pinata upload failed – falling back to deterministic CID");
                pinata_failed = true;
                fake_ipfs_cid(&sha256)
            }
        }
    } else {
        pinata_failed = true;
        fake_ipfs_cid(&sha256)
    };

    // ── Real Solana Memo transaction ─────────────────────────────────────────
    let memo_payload = format!(
        "{{\"log_id\":\"{log_id}\",\"sha256\":\"{sha256}\",\"cid\":\"{ipfs_cid}\",\"program_id\":\"{}\"}}",
        state.solana_program_id
    );
    let mut solana_failed = false;
    let tx_signature = if let Some(kp_path) = &state.system_keypair_path {
        let rpc = state.solana_rpc_url.as_ref().clone();
        let kp = kp_path.as_ref().clone();
        match send_memo_to_solana(rpc, kp, memo_payload).await {
            Some(sig) => {
                info!("Solana Memo tx OK: {}", sig);
                sig
            }
            None => {
                warn!("Solana Memo tx failed – wallet likely unfunded. Marking as pending.");
                solana_failed = true;
                // Use null/empty to indicate Solana pending (not invalid fallback signature)
                String::new()
            }
        }
    } else {
        solana_failed = true;
        // Use null/empty to indicate Solana not configured
        String::new()
    };
    // With Memo Program we don't derive a PDA – store the tx sig as the anchor reference
    let pda_address = tx_signature.clone();
    let db_log_id = log_id.clone();
    let db_device_id = device_id.clone();
    let db_sha256 = sha256.clone();
    let db_format = format.clone();
    let db_level = format.to_lowercase();
    let db_ipfs_cid = ipfs_cid.clone();
    let db_tx_signature = tx_signature.clone();
    let db_pda_address = pda_address.clone();
    let db_raw_bytes = raw_bytes.clone();
    let db_preview = String::from_utf8_lossy(&raw_bytes)
        .chars()
        .take(8192)
        .collect::<String>();

    let db_verification_status = if db_tx_signature.is_empty() {
        if state.system_keypair_path.is_none() {
            "pending_no_solana"
        } else {
            "pending_funding"
        }
    } else {
        "confirmed"
    };

    with_conn(&state, move |conn| {
        conn.execute(
            "INSERT INTO logs(
                id, device_id, timestamp_ms, level, message, source, hash, ipfs_cid,
                blockchain_tx_id, verification_status, retry_count, created_at, updated_at,
                format, file_size, raw_content, pda_address
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8,
                $9, $14, 0, NOW(), NOW(),
                $10, $11, $12, $13
            )",
            &[
                &db_log_id,
                &db_device_id,
                &timestamp,
                &db_level,
                &db_preview,
                &db_device_id,
                &db_sha256,
                &db_ipfs_cid,
                &db_tx_signature,
                &db_format,
                &(total_bytes as i64),
                &db_raw_bytes,
                &db_pda_address,
                &db_verification_status,
            ],
        )
        .map_err(|e| ApiError::Internal(format!("failed inserting log entry: {e}")))?;
        Ok(())
    })
    .await?;

    write_audit_log(
        &state,
        "log_ingested",
        Some(log_id.clone()),
        Some(device_id.clone()),
        serde_json::json!({
            "status": db_verification_status,
            "format": format.clone(),
            "source": "multipart",
        }),
        None,
        None,
    )
    .await;

    if pinata_failed || solana_failed {
        let reason = if pinata_failed {
            "pinata_upload_failed"
        } else {
            "solana_network_error"
        };
        enqueue_retry_job(&state, &log_id, reason).await;
    }

    state
        .metrics
        .ingest_success_total
        .fetch_add(1, Ordering::Relaxed);

    // Set status based on what actually succeeded
    let status_str = if tx_signature.is_empty() {
        if state.system_keypair_path.is_none() {
            "pending_no_solana_config"
        } else {
            "pending_solana_funding"
        }
    } else {
        "confirmed"
    };

    let response = IngestResponse {
        request_id: Uuid::new_v4().to_string(),
        log_id,
        device_id,
        timestamp,
        format,
        file_name,
        file_size_bytes: total_bytes,
        sha256,
        ipfs_cid,
        tx_signature: if tx_signature.is_empty() {
            String::from("PENDING")
        } else {
            tx_signature
        },
        pda_address,
        status: status_str.to_string(),
    };

    Ok(Json(response))
}

async fn ingest_fluentd(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<FluentdIngestPayload>,
) -> Result<Json<IngestResponse>, ApiError> {
    state
        .metrics
        .ingest_requests_total
        .fetch_add(1, Ordering::Relaxed);
    state
        .metrics
        .collector_ingest_requests_total
        .fetch_add(1, Ordering::Relaxed);
    if let Err(err) = enforce_ingest_policies(&state, &headers).await {
        state
            .metrics
            .ingest_rejected_total
            .fetch_add(1, Ordering::Relaxed);
        state
            .metrics
            .collector_ingest_rejected_total
            .fetch_add(1, Ordering::Relaxed);
        return Err(err);
    }

    let FluentdIngestPayload {
        device_id,
        timestamp,
        format,
        agent_id,
        source_type,
        seq_no,
        batch_id,
        idempotency_key,
        message,
    } = payload;

    let device_id = device_id
        .unwrap_or_else(|| "fluentd-agent".to_string());
    let timestamp = timestamp.unwrap_or_else(now_epoch_ms);
    let format = format.unwrap_or_else(|| "json".to_string());
    let agent_id = agent_id.unwrap_or_else(|| device_id.clone());
    let source_type = source_type.unwrap_or_else(|| "collector-syslog".to_string());
    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or(idempotency_key.filter(|s| !s.trim().is_empty()));

    if let Some(key) = idempotency_key.clone() {
        let existing = with_conn(&state, move |conn| {
            conn.query_opt(
                "SELECT id, device_id, timestamp_ms, format, file_size, hash, ipfs_cid, blockchain_tx_id, COALESCE(pda_address, blockchain_tx_id), verification_status
                 FROM logs WHERE idempotency_key = $1",
                &[&key],
            )
            .map_err(|e| ApiError::Internal(format!("failed dedupe lookup: {e}")))
        })
        .await?;

        if let Some(row) = existing {
            state
                .metrics
                .collector_duplicate_total
                .fetch_add(1, Ordering::Relaxed);
            return Ok(Json(IngestResponse {
                request_id: Uuid::new_v4().to_string(),
                log_id: row.get::<_, String>(0),
                device_id: row.get::<_, String>(1),
                timestamp: row.get::<_, i64>(2),
                format: row.get::<_, String>(3),
                file_name: Some("fluentd-record.json".to_string()),
                file_size_bytes: row.get::<_, i64>(4) as usize,
                sha256: row.get::<_, String>(5),
                ipfs_cid: row.get::<_, String>(6),
                tx_signature: row.get::<_, String>(7),
                pda_address: row.get::<_, String>(8),
                status: row.get::<_, String>(9),
            }));
        }
    }

    let raw_bytes = message.into_bytes();
    let total_bytes = raw_bytes.len();
    if total_bytes > state.max_upload_bytes {
        return Err(ApiError::BadRequest(format!(
            "payload exceeded MAX_UPLOAD_BYTES ({} bytes)",
            state.max_upload_bytes
        )));
    }

    let sha256 = hex::encode(Sha256::digest(&raw_bytes));
    let log_id = format!("log-{}", Uuid::new_v4().simple());
    
    // ── Real Pinata IPFS upload for large files ──────────────────────────────
    let ipfs_cid = if let Some(jwt) = &state.pinata_jwt {
        let fname = format!("{log_id}.syslog");
        match upload_to_pinata(jwt.as_ref(), raw_bytes.clone(), fname).await {
            Some(cid) => {
                info!("Collector: Pinata upload OK: ipfs://{}", cid);
                cid
            }
            None => {
                warn!("Collector: Pinata upload failed – falling back to deterministic CID");
                fake_ipfs_cid(&sha256)
            }
        }
    } else {
        warn!("Collector: PINATA_JWT not set – using fallback CID");
        fake_ipfs_cid(&sha256)
    };

    // ── Real Solana Memo transaction ─────────────────────────────────────────
    let memo_payload = format!(
        "{{\"log_id\":\"{log_id}\",\"sha256\":\"{sha256}\",\"cid\":\"{ipfs_cid}\",\"source\":\"collector\"}}",
    );
    let tx_signature = if let Some(kp_path) = &state.system_keypair_path {
        let rpc = state.solana_rpc_url.as_ref().clone();
        let kp = kp_path.as_ref().clone();
        match send_memo_to_solana(rpc, kp, memo_payload).await {
            Some(sig) => {
                info!("Collector: Solana Memo tx OK: {}", sig);
                sig
            }
            None => {
                warn!("Collector: Solana Memo tx failed – wallet likely unfunded. Marking as pending.");
                String::new()
            }
        }
    } else {
        warn!("Collector: SYSTEM_KEYPAIR_PATH not set – Solana not configured");
        String::new()
    };
    
    let pda_address = tx_signature.clone();
    let preview = String::from_utf8_lossy(&raw_bytes)
        .chars()
        .take(8192)
        .collect::<String>();

    let db_log_id = log_id.clone();
    let db_device_id = device_id.clone();
    let db_sha256 = sha256.clone();
    let db_format = format.clone();
    let db_level = format.to_lowercase();
    let db_ipfs_cid = ipfs_cid.clone();
    let db_tx_signature = tx_signature.clone();
    let db_pda_address = pda_address.clone();
    let db_raw_bytes = raw_bytes.clone();
    
    let db_verification_status = if db_tx_signature.is_empty() {
        if state.system_keypair_path.is_none() {
            "pending_no_solana"
        } else {
            "pending_funding"
        }
    } else {
        "confirmed"
    };
    let db_agent_id = agent_id.clone();
    let db_source_type = source_type.clone();
    let db_seq_no = seq_no;
    let db_batch_id = batch_id.clone();
    let db_idempotency_key = idempotency_key.clone();
    with_conn(&state, move |conn| {
        conn.execute(
            "INSERT INTO logs(
                id, device_id, timestamp_ms, level, message, source, hash, ipfs_cid,
                blockchain_tx_id, verification_status, retry_count, created_at, updated_at,
                format, file_size, raw_content, pda_address,
                agent_id, source_type, seq_no, batch_id, idempotency_key
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8,
                $9, $10, 0, NOW(), NOW(),
                $11, $12, $13, $14,
                $15, $16, $17, $18, $19
            )",
            &[
                &db_log_id,
                &db_device_id,
                &timestamp,
                &db_level,
                &preview,
                &db_device_id,
                &db_sha256,
                &db_ipfs_cid,
                &db_tx_signature,
                &db_verification_status,
                &db_format,
                &(total_bytes as i64),
                &db_raw_bytes,
                &db_pda_address,
                &db_agent_id,
                &db_source_type,
                &db_seq_no,
                &db_batch_id,
                &db_idempotency_key,
            ],
        )
        .map_err(|e| ApiError::Internal(format!("failed inserting fluentd log: {e}")))?;
        Ok(())
    })
    .await?;

    write_audit_log(
        &state,
        "log_ingested",
        Some(log_id.clone()),
        Some(device_id.clone()),
        serde_json::json!({
            "status": db_verification_status,
            "format": format.clone(),
            "source": "collector",
            "agent_id": agent_id.clone(),
        }),
        None,
        None,
    )
    .await;

    if tx_signature.is_empty() {
        let reason = if state.system_keypair_path.is_none() {
            "solana_unfunded"
        } else {
            "solana_network_error"
        };
        enqueue_retry_job(&state, &log_id, reason).await;
    }

    state
        .metrics
        .ingest_success_total
        .fetch_add(1, Ordering::Relaxed);
    state
        .metrics
        .collector_ingest_success_total
        .fetch_add(1, Ordering::Relaxed);

    let status_str = if tx_signature.is_empty() {
        if state.system_keypair_path.is_none() {
            "pending_no_solana_config"
        } else {
            "pending_solana_funding"
        }
    } else {
        "confirmed"
    };

    let response = IngestResponse {
        request_id: Uuid::new_v4().to_string(),
        log_id,
        device_id,
        timestamp,
        format,
        file_name: Some("fluentd-record.json".to_string()),
        file_size_bytes: total_bytes,
        sha256,
        ipfs_cid,
        tx_signature: if tx_signature.is_empty() {
            String::from("PENDING")
        } else {
            tx_signature
        },
        pda_address,
        status: status_str.to_string(),
    };

    Ok(Json(response))
}

async fn list_logs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ListLogsQuery>,
) -> Result<Json<ListLogsResponse>, ApiError> {
    let claims = require_auth(&headers, &state)?;
    ensure_claim_role(&claims, &["employee", "manager", "admin"])?;

    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(50).clamp(1, 200);
    let offset = (page - 1) * page_size;
    let search = query.search.unwrap_or_default().to_lowercase();
    let status_filter = query.status.unwrap_or_default().to_lowercase();
    let format_filter = query.format.unwrap_or_default().to_lowercase();

    let response = with_conn(&state, move |conn| {
        let rows = conn
            .query(
                "SELECT id, device_id, timestamp_ms, ipfs_cid, hash, format, file_size, verification_status, blockchain_tx_id, COALESCE(pda_address, blockchain_tx_id)
                 FROM logs ORDER BY timestamp_ms DESC",
                &[],
            )
            .map_err(|e| ApiError::Internal(format!("failed listing logs: {e}")))?;

        let mut all = Vec::<LogEntryDto>::new();
        for row in rows {
            let item = LogEntryDto {
                id: row.get(0),
                device_id: row.get(1),
                timestamp: row.get(2),
                ipfs_cid: row.get(3),
                hash_on_chain: row.get(4),
                format: row.get(5),
                file_size: row.get(6),
                status: row.get(7),
                tx_signature: row.get(8),
                pda_address: row.get(9),
            };
            let search_hit = search.is_empty()
                || item.id.to_lowercase().contains(&search)
                || item.device_id.to_lowercase().contains(&search)
                || item.ipfs_cid.to_lowercase().contains(&search);
            let status_hit = status_filter.is_empty() || status_filter == "all" || item.status == status_filter;
            let format_hit = format_filter.is_empty() || format_filter == "all" || item.format.to_lowercase() == format_filter;
            if search_hit && status_hit && format_hit {
                all.push(item);
            }
        }

        let total = all.len() as i64;
        let items = all
            .into_iter()
            .skip(offset as usize)
            .take(page_size as usize)
            .collect::<Vec<_>>();

        Ok(ListLogsResponse {
            items,
            total,
            page,
            page_size,
        })
    })
    .await?;

    Ok(Json(response))
}

async fn get_dashboard_stats(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<DashboardStatsResponse>, ApiError> {
    let claims = require_auth(&headers, &state)?;
    ensure_claim_role(&claims, &["employee", "manager", "admin"])?;

    let response = with_conn(&state, move |conn| {
        let total_logs: i64 = conn
            .query_opt("SELECT COUNT(*)::BIGINT FROM logs", &[])
            .ok()
            .flatten()
            .and_then(|row| row.try_get::<_, i64>(0).ok())
            .unwrap_or(0);

        let verified_logs: i64 = conn
            .query_opt(
                "SELECT COUNT(*)::BIGINT FROM logs WHERE verification_status = 'verified'",
                &[],
            )
            .ok()
            .flatten()
            .and_then(|row| row.try_get::<_, i64>(0).ok())
            .unwrap_or(0);

        let tampered_logs: i64 = conn
            .query_opt(
                "SELECT COUNT(*)::BIGINT FROM logs WHERE verification_status = 'tampered'",
                &[],
            )
            .ok()
            .flatten()
            .and_then(|row| row.try_get::<_, i64>(0).ok())
            .unwrap_or(0);

        let active_devices: i64 = conn
            .query_opt("SELECT COUNT(DISTINCT device_id)::BIGINT FROM logs", &[])
            .ok()
            .flatten()
            .and_then(|row| row.try_get::<_, i64>(0).ok())
            .unwrap_or(0);

        let total_size: i64 = conn
            .query_opt("SELECT COALESCE(SUM(file_size), 0)::BIGINT FROM logs", &[])
            .ok()
            .flatten()
            .and_then(|row| row.try_get::<_, i64>(0).ok())
            .unwrap_or(0);

        let total_storage = if total_size < 1024 {
            format!("{} B", total_size)
        } else if total_size < 1024 * 1024 {
            format!("{:.1} KB", total_size as f64 / 1024.0)
        } else {
            format!("{:.1} MB", total_size as f64 / (1024.0 * 1024.0))
        };

        Ok(DashboardStatsResponse {
            total_logs,
            verified_logs,
            tampered_logs,
            active_devices,
            total_storage,
            network_status: "connected",
        })
    })
    .await
    .unwrap_or_else(|_e| DashboardStatsResponse {
        // If database query fails entirely, return defaults with 0 values
        total_logs: 0,
        verified_logs: 0,
        tampered_logs: 0,
        active_devices: 0,
        total_storage: "0 B".to_string(),
        network_status: "disconnected",
    });

    Ok(Json(response))
}

async fn get_activity(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<ActivityItemDto>>, ApiError> {
    let claims = require_auth(&headers, &state)?;
    ensure_claim_role(&claims, &["employee", "manager", "admin"])?;

    let items = with_conn(&state, move |conn| {
        let rows = conn
            .query(
                "SELECT id, device_id, timestamp_ms, verification_status FROM logs ORDER BY timestamp_ms DESC LIMIT 20",
                &[],
            )
            .map_err(|e| ApiError::Internal(format!("failed querying activity: {e}")))?;

        let mut items = Vec::<ActivityItemDto>::new();
        for row in rows {
            let id: String = row.get(0);
            let device_id: String = row.get(1);
            let timestamp: i64 = row.get(2);
            let status: String = row.get(3);
            items.push(ActivityItemDto {
                id,
                activity_type: if status == "tampered" {
                    "alert".to_string()
                } else {
                    "log_stored".to_string()
                },
                message: if status == "tampered" {
                    format!("Integrity alert from {}", device_id)
                } else {
                    format!("New log stored from {}", device_id)
                },
                timestamp,
                device_id: Some(device_id),
                status: Some(status),
            });
        }
        Ok(items)
    })
    .await?;

    Ok(Json(items))
}

/// Fetch the on-chain Memo transaction and compare sha256 + log_id.
/// Returns Some(true) if the on-chain payload matches, Some(false) if it
/// doesn't, or None if the transaction cannot be found / parsed.
async fn verify_on_chain_memo(
    rpc_url: &str,
    tx_signature: &str,
    expected_log_id: &str,
    expected_sha256: &str,
) -> Option<bool> {
    let client = reqwest::Client::new();
    let req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getTransaction",
        "params": [
            tx_signature,
            {
                "encoding": "jsonParsed",
                "commitment": "confirmed",
                "maxSupportedTransactionVersion": 0
            }
        ]
    });

    let resp = client.post(rpc_url).json(&req).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }

    let body: serde_json::Value = resp.json().await.ok()?;
    let result = &body["result"];
    if result.is_null() {
        return None;
    }

    // First try: read the `parsed` field of the spl-memo instruction.
    // With jsonParsed encoding, Solana already unescapes the memo string into `parsed`.
    if let Some(instructions) = result["transaction"]["message"]["instructions"].as_array() {
        for instr in instructions {
            let program = instr["program"].as_str().unwrap_or("");
            let program_id = instr["programId"].as_str().unwrap_or("");
            if program == "spl-memo" || program_id.starts_with("MemoSq") || program_id.starts_with("Memo1") {
                if let Some(parsed_str) = instr["parsed"].as_str() {
                    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(parsed_str) {
                        let on_chain_sha256 = payload["sha256"].as_str().unwrap_or("");
                        let on_chain_log_id = payload["log_id"].as_str().unwrap_or("");
                        // Accept if log_id matches or if we at least find the sha256
                        if on_chain_log_id == expected_log_id || !on_chain_sha256.is_empty() {
                            return Some(on_chain_sha256 == expected_sha256);
                        }
                    }
                }
            }
        }
    }

    // Fallback: scan logMessages for the Memo program log line.
    // Format: `Program log: Memo (len N): "{\"key\":\"val\"}"`
    // After JSON-RPC decoding the string contains literal `\"` escapes.
    if let Some(log_messages) = result["meta"]["logMessages"].as_array() {
        for msg_val in log_messages {
            let msg = msg_val.as_str().unwrap_or("");
            if !msg.contains("Memo") {
                continue;
            }
            // Find `): "` to locate the start of the quoted memo payload
            if let Some(pos) = msg.find("): \"") {
                let after = &msg[pos + 4..]; // skip `): "`
                let inner_escaped = after.trim_end_matches('"');
                // Wrap in quotes so serde_json treats it as a JSON string
                // and resolves the `\"` escape sequences for us.
                let as_json_str = format!("\"{}\"", inner_escaped);
                if let Ok(serde_json::Value::String(inner_json)) =
                    serde_json::from_str::<serde_json::Value>(&as_json_str)
                {
                    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&inner_json) {
                        let on_chain_sha256 = payload["sha256"].as_str().unwrap_or("");
                        let on_chain_log_id = payload["log_id"].as_str().unwrap_or("");
                        if on_chain_log_id == expected_log_id || !on_chain_sha256.is_empty() {
                            return Some(on_chain_sha256 == expected_sha256);
                        }
                    }
                }
            }
        }
    }

    None
}

async fn verify_log(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<VerifyResponse>, ApiError> {
    let claims = require_auth(&headers, &state)?;
    ensure_claim_role(&claims, &["manager", "admin"])?;

    state
        .metrics
        .verify_requests_total
        .fetch_add(1, Ordering::Relaxed);

    // Step 1: Load log row from DB
    let id_clone = id.clone();
    let (expected_hash, raw_content, tx_sig) = with_conn(&state, move |conn| {
        let row = conn
            .query_opt(
                "SELECT hash, raw_content, blockchain_tx_id FROM logs WHERE id = $1",
                &[&id_clone],
            )
            .map_err(|e| ApiError::Internal(format!("failed loading log for verify: {e}")))?;

        match row {
            Some(r) => Ok((
                r.get::<_, String>(0),
                r.get::<_, Vec<u8>>(1),
                r.get::<_, String>(2),
            )),
            None => Err(ApiError::NotFound("log not found".to_string())),
        }
    })
    .await?;

    // Step 2: Hash integrity check (sync, no DB)
    let actual_hash = hex::encode(Sha256::digest(&raw_content));
    let verified = expected_hash == actual_hash;
    let status = if verified { "verified" } else { "tampered" }.to_string();

    // Step 3: On-chain memo verification (async HTTP to Solana RPC)
    let on_chain_verified = verify_on_chain_memo(
        &state.solana_rpc_url,
        &tx_sig,
        &id,
        &expected_hash,
    )
    .await;

    // Step 4: Persist verification result to DB
    let status_clone = status.clone();
    let id_clone2 = id.clone();
    let expected_hash_clone = expected_hash.clone();
    let actual_hash_clone = actual_hash.clone();
    with_conn(&state, move |conn| {
        conn.execute(
            "UPDATE logs SET verification_status = $1, last_verified_at = NOW(), updated_at = NOW() WHERE id = $2",
            &[&status_clone, &id_clone2],
        )
        .map_err(|e| ApiError::Internal(format!("failed updating verification status: {e}")))?;

        let event_detail = format!(
            "expected_hash={}, actual_hash={}, verified={}",
            expected_hash_clone, actual_hash_clone, verified
        );
        conn.execute(
            "INSERT INTO verification_events(log_id, event_type, detail, created_at) VALUES ($1, $2, $3, NOW())",
            &[&id_clone2, &"verify", &event_detail],
        )
        .map_err(|e| ApiError::Internal(format!("failed inserting verification event: {e}")))?;

        Ok(())
    })
    .await?;

    write_audit_log(
        &state,
        if verified { "log_verified" } else { "log_tampered" },
        Some(id.clone()),
        None,
        serde_json::json!({
            "expected_hash": expected_hash.clone(),
            "actual_hash": actual_hash.clone(),
            "verified": verified,
            "on_chain_verified": on_chain_verified,
        }),
        Some(claims.sub.clone()),
        Some(claims.role.clone()),
    )
    .await;

    if verified {
        state
            .metrics
            .verify_success_total
            .fetch_add(1, Ordering::Relaxed);
    } else {
        state
            .metrics
            .verify_tampered_total
            .fetch_add(1, Ordering::Relaxed);
    }

    Ok(Json(VerifyResponse {
        log_id: id,
        expected_hash,
        actual_hash,
        verified,
        status,
        on_chain_verified,
    }))
}

async fn report_log(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Json(payload): Json<ReportLogRequest>,
) -> Result<Json<ReportLogResponse>, ApiError> {
    let claims = require_auth(&headers, &state)?;
    ensure_claim_role(&claims, &["employee", "manager", "admin"])?;

    let report_flag = payload.report_flag.trim().to_lowercase();
    if report_flag != "suspicious" && report_flag != "fraud" {
        return Err(ApiError::BadRequest(
            "report_flag must be either suspicious or fraud".to_string(),
        ));
    }

    let report_reason = payload
        .report_reason
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    let status = if report_flag == "suspicious" {
        "unverified".to_string()
    } else {
        "tampered".to_string()
    };

    let id_for_db = id.clone();
    let report_flag_for_db = report_flag.clone();
    let report_reason_for_db = report_reason.clone();
    let status_for_db = status.clone();
    let reporter_wallet = claims.sub.clone();
    let reporter_role = claims.role.clone();
    let reporter_wallet_for_db = reporter_wallet.clone();
    let reporter_role_for_db = reporter_role.clone();

    with_conn(&state, move |conn| {
        let updated = conn
            .execute(
                "UPDATE logs SET verification_status = $1, updated_at = NOW() WHERE id = $2",
                &[&status_for_db, &id_for_db],
            )
            .map_err(|e| ApiError::Internal(format!("failed updating log status for report: {e}")))?;

        if updated == 0 {
            return Err(ApiError::NotFound("log not found".to_string()));
        }

        let insert_report = conn.execute(
            "INSERT INTO reported_logs(log_id, report_flag, report_reason, reported_by_wallet, reported_by_role, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())",
            &[
                &id_for_db,
                &report_flag_for_db,
                &report_reason_for_db,
                &reporter_wallet_for_db,
                &reporter_role_for_db,
            ],
        );

        match insert_report {
            Ok(_) => {}
            Err(e) => {
                let message = e.to_string();
                if message.contains("duplicate key value") || message.contains("reported_logs_log_id_key") {
                    return Err(ApiError::BadRequest("log has already been reported".to_string()));
                }
                return Err(ApiError::Internal(format!("failed inserting report log: {e}")));
            }
        }

        let event_detail = format!(
            "flag={}, reason={}, reported_by={} ({})",
            report_flag_for_db,
            report_reason_for_db.clone().unwrap_or_else(|| "n/a".to_string()),
            reporter_wallet_for_db,
            reporter_role_for_db,
        );

        conn.execute(
            "INSERT INTO verification_events(log_id, event_type, detail, created_at) VALUES ($1, $2, $3, NOW())",
            &[&id_for_db, &"report", &event_detail],
        )
        .map_err(|e| ApiError::Internal(format!("failed inserting report audit event: {e}")))?;

        Ok(())
    })
    .await?;

    write_audit_log(
        &state,
        "log_reported",
        Some(id.clone()),
        None,
        serde_json::json!({
            "report_flag": report_flag.clone(),
            "report_reason": report_reason.clone(),
            "status": status.clone(),
        }),
        Some(reporter_wallet.clone()),
        Some(reporter_role.clone()),
    )
    .await;

    Ok(Json(ReportLogResponse {
        log_id: id,
        report_flag,
        reported_by_wallet: reporter_wallet,
        reported_by_role: reporter_role,
        status,
    }))
}

async fn list_reported_logs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ListReportedLogsQuery>,
) -> Result<Json<ListReportedLogsResponse>, ApiError> {
    let claims = require_auth(&headers, &state)?;
    ensure_claim_role(&claims, &["employee", "manager", "admin"])?;

    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(50).clamp(1, 200);
    let offset = (page - 1) * page_size;

    let response = with_conn(&state, move |conn| {
        let total: i64 = conn
            .query_opt("SELECT COUNT(*)::BIGINT FROM reported_logs", &[])
            .map_err(|e| ApiError::Internal(format!("failed counting reported logs: {e}")))?
            .and_then(|row| row.try_get::<_, i64>(0).ok())
            .unwrap_or(0);

        let rows = conn
            .query(
                "SELECT rl.id,
                        rl.log_id,
                        l.device_id,
                        rl.report_flag,
                        rl.report_reason,
                        rl.reported_by_wallet,
                        rl.reported_by_role,
                        CAST(EXTRACT(EPOCH FROM rl.created_at) * 1000 AS BIGINT) AS created_at_ms,
                        l.verification_status
                 FROM reported_logs rl
                 JOIN logs l ON l.id = rl.log_id
                 ORDER BY rl.created_at DESC
                 LIMIT $1 OFFSET $2",
                &[&page_size, &offset],
            )
            .map_err(|e| ApiError::Internal(format!("failed listing reported logs: {e}")))?;

        let items = rows
            .into_iter()
            .map(|row| ReportedLogDto {
                id: row.get(0),
                log_id: row.get(1),
                device_id: row.get(2),
                report_flag: row.get(3),
                report_reason: row.get(4),
                reported_by_wallet: row.get(5),
                reported_by_role: row.get(6),
                created_at: row.get(7),
                status: row.get(8),
            })
            .collect::<Vec<_>>();

        Ok(ListReportedLogsResponse {
            items,
            total,
            page,
            page_size,
        })
    })
    .await?;

    Ok(Json(response))
}

async fn get_log_content(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<LogContentResponse>, ApiError> {
    let claims = require_auth(&headers, &state)?;
    ensure_claim_role(&claims, &["employee", "manager", "admin"])?;

    let response = with_conn(&state, move |conn| {
        let row = conn
            .query_opt("SELECT raw_content FROM logs WHERE id = $1", &[&id])
            .map_err(|e| ApiError::Internal(format!("failed loading content: {e}")))?;

        let raw: Vec<u8> = match row {
            Some(r) => r.get(0),
            None => return Err(ApiError::NotFound("log not found".to_string())),
        };

        let content = String::from_utf8_lossy(&raw).to_string();
        Ok(LogContentResponse { id, content })
    })
    .await?;

    Ok(Json(response))
}

fn token_from_headers(headers: &HeaderMap) -> Option<String> {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|v| v.trim().to_string())
}

fn require_auth(headers: &HeaderMap, state: &AppState) -> Result<AuthClaims, ApiError> {
    let token = token_from_headers(headers)
        .ok_or_else(|| ApiError::Unauthorized("missing bearer token".to_string()))?;
    decode::<AuthClaims>(
        &token,
        &DecodingKey::from_secret(state.jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map(|data| data.claims)
    .map_err(|_| ApiError::Unauthorized("invalid/expired token".to_string()))
}

fn is_admin_wallet(address: &str, state: &AppState) -> bool {
    state
        .admin_allowlist
        .iter()
        .any(|item| item.eq_ignore_ascii_case(address))
}

fn normalize_role(raw: &str) -> Option<&'static str> {
    match raw.trim().to_lowercase().as_str() {
        "employee" => Some("employee"),
        "manager" => Some("manager"),
        "admin" => Some("admin"),
        _ => None,
    }
}

fn ensure_claim_role(claims: &AuthClaims, allowed: &[&str]) -> Result<(), ApiError> {
    if allowed
        .iter()
        .any(|role| claims.role.eq_ignore_ascii_case(role))
    {
        return Ok(());
    }
    Err(ApiError::Unauthorized("insufficient role permissions".to_string()))
}

async fn wallet_login(
    State(state): State<AppState>,
    Json(payload): Json<WalletLoginRequest>,
) -> Result<Json<WalletLoginResponse>, ApiError> {
    let wallet_address = payload.wallet_address.trim().to_string();
    if wallet_address.is_empty() {
        return Err(ApiError::BadRequest("wallet_address is required".to_string()));
    }

    let role = if is_admin_wallet(&wallet_address, &state) {
        "admin".to_string()
    } else {
        let lookup_wallet = wallet_address.to_lowercase();
        let db_role = with_conn(&state, move |conn| {
            let row = conn
                .query_opt(
                    "SELECT role FROM wallet_roles WHERE wallet_address = $1",
                    &[&lookup_wallet],
                )
                .map_err(|e| ApiError::Internal(format!("failed querying wallet role: {e}")))?;

            Ok(row.map(|r| r.get::<_, String>(0)))
        })
        .await?;

        let role_value = db_role.ok_or_else(|| {
            ApiError::Unauthorized("wallet is not authorized by admin".to_string())
        })?;

        normalize_role(&role_value)
            .ok_or_else(|| ApiError::Unauthorized("invalid role assigned to wallet".to_string()))?
            .to_string()
    };

    let expires_at = (now_epoch_ms() / 1000) + 12 * 60 * 60;
    let claims = AuthClaims {
        sub: wallet_address.clone(),
        role: role.clone(),
        exp: expires_at as usize,
    };
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(state.jwt_secret.as_bytes()),
    )
    .map_err(|e| ApiError::Internal(format!("failed generating jwt: {e}")))?;

    Ok(Json(WalletLoginResponse {
        token,
        role,
        wallet_address,
        expires_at,
    }))
}

async fn logout() -> Json<LogoutResponse> {
    Json(LogoutResponse { status: "ok" })
}

async fn admin_list_roles(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<WalletRolesResponse>, ApiError> {
    let claims = require_auth(&headers, &state)?;
    ensure_claim_role(&claims, &["admin"])?;

    let items = with_conn(&state, move |conn| {
        let rows = conn
            .query(
                "SELECT wallet_address, role, granted_by, EXTRACT(EPOCH FROM granted_at)::BIGINT * 1000
                 FROM wallet_roles
                 ORDER BY granted_at DESC",
                &[],
            )
            .map_err(|e| ApiError::Internal(format!("failed listing wallet roles: {e}")))?;

        let mut list = Vec::<WalletRoleItem>::new();
        for row in rows {
            list.push(WalletRoleItem {
                wallet_address: row.get(0),
                role: row.get(1),
                granted_by: row.get(2),
                granted_at: row.get(3),
            });
        }
        Ok(list)
    })
    .await?;

    let mut seen = HashSet::new();
    let mut merged = Vec::<WalletRoleItem>::new();
    for item in items {
        seen.insert(item.wallet_address.to_lowercase());
        merged.push(item);
    }

    let now = now_epoch_ms();
    for wallet in state.admin_allowlist.iter() {
        let key = wallet.to_lowercase();
        if !seen.contains(&key) {
            merged.push(WalletRoleItem {
                wallet_address: wallet.clone(),
                role: "admin".to_string(),
                granted_by: "system_allowlist".to_string(),
                granted_at: now,
            });
        }
    }

    Ok(Json(WalletRolesResponse { items: merged }))
}

async fn admin_upsert_role(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<UpsertWalletRoleRequest>,
) -> Result<Json<LogoutResponse>, ApiError> {
    let claims = require_auth(&headers, &state)?;
    ensure_claim_role(&claims, &["admin"])?;

    let wallet_address = payload.wallet_address.trim().to_lowercase();
    if wallet_address.is_empty() {
        return Err(ApiError::BadRequest("wallet_address is required".to_string()));
    }
    if is_admin_wallet(&wallet_address, &state) {
        return Err(ApiError::BadRequest(
            "cannot modify allowlisted admin wallet role".to_string(),
        ));
    }

    let role = normalize_role(&payload.role)
        .ok_or_else(|| ApiError::BadRequest("role must be employee or manager".to_string()))?;
    if role == "admin" {
        return Err(ApiError::BadRequest(
            "assigning admin role is only allowed via ADMIN_WALLET_ALLOWLIST".to_string(),
        ));
    }

    let granted_by = claims.sub;
    with_conn(&state, move |conn| {
        conn.execute(
            "INSERT INTO wallet_roles(wallet_address, role, granted_by, granted_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (wallet_address)
             DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, granted_at = NOW()",
            &[&wallet_address, &role, &granted_by],
        )
        .map_err(|e| ApiError::Internal(format!("failed upserting wallet role: {e}")))?;
        Ok(())
    })
    .await?;

    Ok(Json(LogoutResponse { status: "ok" }))
}

async fn admin_revoke_role(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(wallet_address): AxumPath<String>,
) -> Result<Json<LogoutResponse>, ApiError> {
    let claims = require_auth(&headers, &state)?;
    ensure_claim_role(&claims, &["admin"])?;

    let wallet = wallet_address.trim().to_lowercase();
    if wallet.is_empty() {
        return Err(ApiError::BadRequest("wallet_address is required".to_string()));
    }
    if is_admin_wallet(&wallet, &state) {
        return Err(ApiError::BadRequest(
            "cannot revoke allowlisted admin wallet".to_string(),
        ));
    }

    with_conn(&state, move |conn| {
        conn.execute(
            "DELETE FROM wallet_roles WHERE wallet_address = $1 AND role IN ('employee', 'manager')",
            &[&wallet],
        )
        .map_err(|e| ApiError::Internal(format!("failed revoking wallet role: {e}")))?;
        Ok(())
    })
    .await?;

    Ok(Json(LogoutResponse { status: "ok" }))
}

async fn admin_list_retry_jobs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<RetryJobsQuery>,
) -> Result<Json<RetryJobsResponse>, ApiError> {
    let claims = require_auth(&headers, &state)?;
    ensure_claim_role(&claims, &["admin"])?;

    let status_filter = query.status.unwrap_or_else(|| "pending".to_string()).to_lowercase();
    let status_for_db = if ["pending", "running", "completed", "failed", "abandoned"].contains(&status_filter.as_str()) {
        status_filter
    } else {
        "pending".to_string()
    };

    let items = with_conn(&state, move |conn| {
        let rows = conn
            .query(
                "SELECT id, log_id, retry_count, max_attempts, reason, status,
                        EXTRACT(EPOCH FROM next_attempt_at)::BIGINT * 1000,
                        CASE WHEN last_attempted_at IS NULL THEN NULL ELSE EXTRACT(EPOCH FROM last_attempted_at)::BIGINT * 1000 END,
                        EXTRACT(EPOCH FROM created_at)::BIGINT * 1000
                 FROM retry_jobs
                 WHERE status = $1
                 ORDER BY next_attempt_at ASC
                 LIMIT 200",
                &[&status_for_db],
            )
            .map_err(|e| ApiError::Internal(format!("failed listing retry jobs: {e}")))?;

        let mut list = Vec::<RetryJobItem>::new();
        for row in rows {
            list.push(RetryJobItem {
                id: row.get(0),
                log_id: row.get(1),
                retry_count: row.get(2),
                max_attempts: row.get(3),
                reason: row.get(4),
                status: row.get(5),
                next_attempt_at: row.get(6),
                last_attempted_at: row.get(7),
                created_at: row.get(8),
            });
        }
        Ok(list)
    })
    .await?;

    Ok(Json(RetryJobsResponse { items }))
}

async fn admin_retry_job_now(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<i64>,
) -> Result<Json<LogoutResponse>, ApiError> {
    let claims = require_auth(&headers, &state)?;
    ensure_claim_role(&claims, &["admin"])?;

    let affected = with_conn(&state, move |conn| {
        let count = conn
            .execute(
                "UPDATE retry_jobs
                 SET status = 'pending',
                     retry_count = 0,
                     next_attempt_at = NOW(),
                     completed_at = NULL
                 WHERE id = $1",
                &[&id],
            )
            .map_err(|e| ApiError::Internal(format!("failed forcing retry job: {e}")))?;
        Ok(count)
    })
    .await?;

    if affected == 0 {
        return Err(ApiError::NotFound("retry job not found".to_string()));
    }

    Ok(Json(LogoutResponse { status: "ok" }))
}

async fn admin_kpis(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<KpiResponse>, ApiError> {
    let claims = require_auth(&headers, &state)?;
    ensure_claim_role(&claims, &["admin"])?;

    let db = with_conn(&state, move |conn| {
        let retry_backlog: i64 = conn
            .query_opt("SELECT COUNT(*)::BIGINT FROM retry_jobs WHERE status IN ('pending', 'running')", &[])
            .ok()
            .flatten()
            .and_then(|row| row.try_get::<_, i64>(0).ok())
            .unwrap_or(0);

        let retry_failed: i64 = conn
            .query_opt("SELECT COUNT(*)::BIGINT FROM retry_jobs WHERE status = 'failed'", &[])
            .ok()
            .flatten()
            .and_then(|row| row.try_get::<_, i64>(0).ok())
            .unwrap_or(0);

        let total_logs: i64 = conn
            .query_opt("SELECT COUNT(*)::BIGINT FROM logs", &[])
            .ok()
            .flatten()
            .and_then(|row| row.try_get::<_, i64>(0).ok())
            .unwrap_or(0);

        let audited_logs: i64 = conn
            .query_opt("SELECT COUNT(DISTINCT log_id)::BIGINT FROM audit_log WHERE log_id IS NOT NULL", &[])
            .ok()
            .flatten()
            .and_then(|row| row.try_get::<_, i64>(0).ok())
            .unwrap_or(0);

        let mttr_seconds: f64 = conn
            .query_opt(
                "SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (completed_at - created_at))), 0)::FLOAT8
                 FROM retry_jobs
                 WHERE status = 'completed' AND completed_at IS NOT NULL",
                &[],
            )
            .ok()
            .flatten()
            .and_then(|row| row.try_get::<_, f64>(0).ok())
            .unwrap_or(0.0);

        Ok((retry_backlog, retry_failed, total_logs, audited_logs, mttr_seconds))
    })
    .await?;

    let requests = state.metrics.ingest_requests_total.load(Ordering::Relaxed) as f64;
    let rejected = state.metrics.ingest_rejected_total.load(Ordering::Relaxed) as f64;
    let ingest_failure_rate = if requests > 0.0 {
        (rejected / requests) * 100.0
    } else {
        0.0
    };

    let audit_coverage_pct = if db.2 > 0 {
        ((db.3 as f64) / (db.2 as f64)) * 100.0
    } else {
        0.0
    };

    Ok(Json(KpiResponse {
        ingest_failure_rate,
        retry_backlog: db.0,
        retry_failed: db.1,
        audit_coverage_pct,
        mttr_seconds: db.4,
    }))
}

async fn admin_list_audit_log(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<AuditLogQuery>,
) -> Result<Json<AuditLogResponse>, ApiError> {
    let claims = require_auth(&headers, &state)?;
    ensure_claim_role(&claims, &["admin"])?;

    let limit = query.limit.unwrap_or(100).clamp(1, 500);
    let event_type = query
        .event_type
        .as_ref()
        .map(|v| v.trim().to_lowercase())
        .filter(|v| !v.is_empty());
    let log_id = query
        .log_id
        .as_ref()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    let items = with_conn(&state, move |conn| {
        let rows = conn
            .query(
                "SELECT id,
                        event_type,
                        log_id,
                        device_id,
                        related_data::text,
                        actor_wallet,
                        actor_role,
                        EXTRACT(EPOCH FROM created_at)::BIGINT * 1000 AS created_at_ms
                 FROM audit_log
                 WHERE ($1::TEXT IS NULL OR event_type = $1)
                   AND ($2::TEXT IS NULL OR log_id = $2)
                 ORDER BY created_at DESC
                 LIMIT $3",
                &[&event_type, &log_id, &limit],
            )
            .map_err(|e| ApiError::Internal(format!("failed listing audit logs: {e}")))?;

        let mut list = Vec::<AuditLogItem>::new();
        for row in rows {
            let related_data_raw: String = row.get(4);
            let related_data = serde_json::from_str::<serde_json::Value>(&related_data_raw)
                .unwrap_or(serde_json::Value::Null);

            list.push(AuditLogItem {
                id: row.get(0),
                event_type: row.get(1),
                log_id: row.get(2),
                device_id: row.get(3),
                related_data,
                actor_wallet: row.get(5),
                actor_role: row.get(6),
                created_at: row.get(7),
            });
        }

        Ok(list)
    })
    .await?;

    Ok(Json(AuditLogResponse { items }))
}

async fn admin_support_chat(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SupportChatRequest>,
) -> Result<Json<SupportChatResponse>, ApiError> {
    let _claims = require_auth(&headers, &state)?;
    
    // Rate limiting for free tier: max 2 requests/sec
    {
        let mut times = state.chat_limiter.request_times.lock().await;
        let now = std::time::Instant::now();
        
        // Remove requests older than 1 second
        while let Some(&front) = times.front() {
            if now.duration_since(front).as_secs() >= 1 {
                times.pop_front();
            } else {
                break;
            }
        }
        
        // Check if we've exceeded the limit
        if times.len() >= state.chat_limiter.max_requests_per_sec {
            return Err(ApiError::BadRequest(
                format!("Too many requests. Max {} requests per second allowed for free tier.", 
                    state.chat_limiter.max_requests_per_sec)
            ));
        }
        
        times.push_back(now);
    }
    
    let gemini_api_key = state
        .gemini_api_key
        .as_ref()
        .ok_or_else(|| ApiError::BadRequest("GEMINI_API_KEY is not configured".to_string()))?;

    let mut prompt = String::new();
    prompt.push_str("You are a support agent for a blockchain log integrity platform. ");
    prompt.push_str("Explain likely root causes and suggested fixes in concise bullet points.\n\n");
    if let Some(err) = payload.recent_error.as_ref() {
        prompt.push_str("Recent error context:\n");
        prompt.push_str(err);
        prompt.push_str("\n\n");
    }
    prompt.push_str("User question:\n");
    prompt.push_str(payload.prompt.trim());

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={}",
        gemini_api_key
    );
    let req_body = serde_json::json!({
        "contents": [
            {
                "parts": [
                    { "text": prompt }
                ]
            }
        ]
    });

    let resp = reqwest::Client::new()
        .post(url)
        .json(&req_body)
        .send()
        .await
        .map_err(|e| ApiError::Internal(format!("gemini request failed: {e}")))?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(ApiError::Internal(format!("gemini non-success response: {body}")));
    }
    let payload: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| ApiError::Internal(format!("gemini parse failed: {e}")))?;
    
    // Try text-bison response format first, then fallback to gemini format
    let answer = if let Some(output) = payload["candidates"][0]["output"].as_str() {
        output.to_string()
    } else if let Some(text) = payload["candidates"][0]["content"]["parts"][0]["text"].as_str() {
        text.to_string()
    } else {
        "No answer available from Gemini right now.".to_string()
    };

    Ok(Json(SupportChatResponse { answer }))
}

