use std::net::{TcpListener, UdpSocket};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::post;
use axum::{Json, Router};
use serde_json::Value;
use tempfile::tempdir;
use tokio::sync::Mutex;

#[derive(Clone, Default)]
struct MockState {
    seen: Arc<Mutex<Vec<Value>>>,
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("bind ephemeral port")
        .local_addr()
        .expect("local addr")
        .port()
}

async fn ingest_mock(State(state): State<MockState>, Json(payload): Json<Value>) -> (StatusCode, Json<Value>) {
    state.seen.lock().await.push(payload);
    (StatusCode::OK, Json(serde_json::json!({"status":"ok"})))
}

#[tokio::test]
async fn udp_syslog_reaches_ingest_endpoint() {
    let http_port = free_port();
    let udp_port = free_port();

    let mock_state = MockState::default();
    let app = Router::new()
        .route("/api/v1/logs/ingest/fluentd", post(ingest_mock))
        .with_state(mock_state.clone());

    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{http_port}"))
        .await
        .expect("bind mock server");
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    let temp = tempdir().expect("tempdir");
    let cache_path = temp.path().join("offline-cache.log");

    let exe = env!("CARGO_BIN_EXE_agent-syslog-collector");
    let mut child = Command::new(exe)
        .env("SYSLOG_BIND_ADDR", format!("127.0.0.1:{udp_port}"))
        .env(
            "BACKEND_INGEST_URL",
            format!("http://127.0.0.1:{http_port}/api/v1/logs/ingest/fluentd"),
        )
        .env("AGENT_ID", "itest-syslog-agent")
        .env("BATCH_MAX_RECORDS", "1")
        .env("BATCH_FLUSH_MS", "100")
        .env("CACHE_REPLAY_MAX", "100")
        .env("CACHE_PATH", cache_path.to_string_lossy().to_string())
        .env(
            "CACHE_KEY_HEX",
            "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
        )
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn collector");

    tokio::time::sleep(Duration::from_millis(250)).await;

    let sender = UdpSocket::bind("127.0.0.1:0").expect("udp sender bind");
    let sample = "<34>1 2026-03-17T10:20:30Z host app 1234 ID47 - test syslog message";
    sender
        .send_to(sample.as_bytes(), format!("127.0.0.1:{udp_port}"))
        .expect("send udp syslog");

    let started = Instant::now();
    let mut delivered = false;
    while started.elapsed() < Duration::from_secs(5) {
        {
            let seen = mock_state.seen.lock().await;
            if !seen.is_empty() {
                let msg = seen[0]["message"].as_str().unwrap_or_default();
                let parsed: Value = serde_json::from_str(msg).expect("collector message json");
                assert_eq!(parsed["agent_id"], "itest-syslog-agent");
                assert_eq!(parsed["event_type"], "syslog.rfc5424");
                assert!(
                    parsed["data"]["raw"]
                        .as_str()
                        .unwrap_or_default()
                        .contains("test syslog message")
                );
                delivered = true;
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    let _ = child.kill();
    let _ = child.wait();

    assert!(delivered, "syslog event was not forwarded to ingest endpoint");
}
