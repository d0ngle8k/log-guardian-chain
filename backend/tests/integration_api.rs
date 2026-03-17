use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use reqwest::multipart;
use serde_json::Value;

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("bind ephemeral port")
        .local_addr()
        .expect("local addr")
        .port()
}

fn test_postgres_url() -> Option<String> {
    std::env::var("TEST_POSTGRES_URL")
        .ok()
        .filter(|v| !v.trim().is_empty())
}

async fn wait_for_health(base_url: &str) {
    let client = reqwest::Client::new();
    for _ in 0..60 {
        if let Ok(resp) = client.get(format!("{}/health", base_url)).send().await {
            if resp.status().is_success() {
                return;
            }
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    panic!("backend did not become healthy in time");
}

fn spawn_backend(port: u16, postgres_url: &str, api_key: &str) -> Child {
    let exe = env!("CARGO_BIN_EXE_log-guardian-backend");
    Command::new(exe)
        .env("APP_ENV", "test")
        .env("BACKEND_PORT", port.to_string())
        .env("POSTGRES_URL", postgres_url)
        .env("MAX_UPLOAD_BYTES", "10485760")
        .env("RUST_LOG", "log_guardian_backend=info")
        .env("INGEST_API_KEY", api_key)
        .env("PINATA_JWT", "")
        .env("SYSTEM_KEYPAIR_PATH", "")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn backend process")
}

#[tokio::test]
async fn ingest_list_verify_content_flow() {
    let Some(postgres_url) = test_postgres_url() else {
        eprintln!("Skipping integration test: TEST_POSTGRES_URL not set");
        return;
    };
    let port = free_port();
    let api_key = "integration-test-key";

    let mut child = spawn_backend(port, &postgres_url, api_key);
    let base_url = format!("http://127.0.0.1:{}", port);

    wait_for_health(&base_url).await;

    let client = reqwest::Client::new();

    let form = multipart::Form::new()
        .text("device_id", "itest-device-01")
        .text("format", "Plain Text")
        .part(
            "file",
            multipart::Part::bytes(b"integration payload line".to_vec()).file_name("itest.log"),
        );

    let ingest_resp = client
        .post(format!("{}/api/v1/logs/ingest", base_url))
        .header("x-api-key", api_key)
        .multipart(form)
        .send()
        .await
        .expect("ingest request")
        .error_for_status()
        .expect("ingest status");

    let ingest_json: Value = ingest_resp.json().await.expect("ingest json");
    let log_id = ingest_json["log_id"].as_str().expect("log_id string").to_string();

    let list_resp = client
        .get(format!("{}/api/v1/logs?page=1&page_size=20", base_url))
        .send()
        .await
        .expect("list request")
        .error_for_status()
        .expect("list status");
    let list_json: Value = list_resp.json().await.expect("list json");
    let items = list_json["items"].as_array().expect("items array");
    assert!(items.iter().any(|item| item["id"] == log_id));

    let verify_resp = client
        .post(format!("{}/api/v1/logs/{}/verify", base_url, log_id))
        .json(&serde_json::json!({}))
        .send()
        .await
        .expect("verify request")
        .error_for_status()
        .expect("verify status");
    let verify_json: Value = verify_resp.json().await.expect("verify json");
    assert_eq!(verify_json["verified"], Value::Bool(true));

    let content_resp = client
        .get(format!("{}/api/v1/logs/{}/content", base_url, log_id))
        .send()
        .await
        .expect("content request")
        .error_for_status()
        .expect("content status");
    let content_json: Value = content_resp.json().await.expect("content json");
    assert!(content_json["content"].as_str().unwrap_or_default().contains("integration payload"));

    let _ = child.kill();
    let _ = child.wait();
}

#[tokio::test]
async fn observability_metrics_and_ingest_policies() {
    let Some(postgres_url) = test_postgres_url() else {
        eprintln!("Skipping integration test: TEST_POSTGRES_URL not set");
        return;
    };
    let port = free_port();
    let api_key = "obs-test-key";

    let exe = env!("CARGO_BIN_EXE_log-guardian-backend");
    let mut child = Command::new(exe)
        .env("APP_ENV", "test")
        .env("BACKEND_PORT", port.to_string())
        .env("POSTGRES_URL", &postgres_url)
        .env("MAX_UPLOAD_BYTES", "10485760")
        .env("RUST_LOG", "log_guardian_backend=info")
        .env("INGEST_API_KEY", api_key)
        .env("INGEST_RATE_LIMIT", "1")
        .env("INGEST_RATE_WINDOW_MS", "60000")
        .env("PINATA_JWT", "")
        .env("SYSTEM_KEYPAIR_PATH", "")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn backend process");

    let base_url = format!("http://127.0.0.1:{}", port);
    wait_for_health(&base_url).await;
    let client = reqwest::Client::new();

    let health_resp = client
        .get(format!("{}/health", base_url))
        .send()
        .await
        .expect("health request");
    assert!(health_resp.headers().contains_key("x-request-id"));
    assert!(health_resp.status().is_success());

    let missing_key_form = multipart::Form::new()
        .text("device_id", "obs-device")
        .text("format", "Plain Text")
        .part(
            "file",
            multipart::Part::bytes(b"missing-key payload".to_vec()).file_name("missing.log"),
        );

    let missing_key_resp = client
        .post(format!("{}/api/v1/logs/ingest", base_url))
        .multipart(missing_key_form)
        .send()
        .await
        .expect("missing key ingest request");
    assert_eq!(missing_key_resp.status(), reqwest::StatusCode::BAD_REQUEST);

    let first_ok_form = multipart::Form::new()
        .text("device_id", "obs-device")
        .text("format", "Plain Text")
        .part(
            "file",
            multipart::Part::bytes(b"rate-limit payload one".to_vec()).file_name("ok.log"),
        );
    let first_ok_resp = client
        .post(format!("{}/api/v1/logs/ingest", base_url))
        .header("x-api-key", api_key)
        .multipart(first_ok_form)
        .send()
        .await
        .expect("authorized ingest request");
    assert!(first_ok_resp.status().is_success());

    let second_form = multipart::Form::new()
        .text("device_id", "obs-device")
        .text("format", "Plain Text")
        .part(
            "file",
            multipart::Part::bytes(b"rate-limit payload two".to_vec()).file_name("rate.log"),
        );
    let second_resp = client
        .post(format!("{}/api/v1/logs/ingest", base_url))
        .header("x-api-key", api_key)
        .multipart(second_form)
        .send()
        .await
        .expect("rate-limited ingest request");
    assert_eq!(second_resp.status(), reqwest::StatusCode::BAD_REQUEST);

    let metrics_resp = client
        .get(format!("{}/metrics", base_url))
        .send()
        .await
        .expect("metrics request")
        .error_for_status()
        .expect("metrics status");
    let metrics_text = metrics_resp.text().await.expect("metrics body");
    assert!(metrics_text.contains("log_guardian_ingest_requests_total"));
    assert!(metrics_text.contains("log_guardian_ingest_success_total"));
    assert!(metrics_text.contains("log_guardian_ingest_rejected_total"));

    let _ = child.kill();
    let _ = child.wait();
}

#[tokio::test]
async fn collector_fluentd_idempotency_and_metadata_lane() {
    let Some(postgres_url) = test_postgres_url() else {
        eprintln!("Skipping integration test: TEST_POSTGRES_URL not set");
        return;
    };
    let port = free_port();
    let api_key = "collector-lane-key";

    let mut child = spawn_backend(port, &postgres_url, api_key);
    let base_url = format!("http://127.0.0.1:{}", port);
    wait_for_health(&base_url).await;

    let client = reqwest::Client::new();
    let payload = serde_json::json!({
        "device_id": "syslog-agent-01",
        "agent_id": "syslog-agent-01",
        "source_type": "collector-syslog",
        "seq_no": 42,
        "batch_id": "batch-e2e-001",
        "format": "json",
        "timestamp": 1_716_000_000_123i64,
        "message": "{\"message\":\"hello from syslog collector\"}"
    });

    let first = client
        .post(format!("{}/api/v1/logs/ingest/fluentd", base_url))
        .header("x-api-key", api_key)
        .header("idempotency-key", "syslog-001-42")
        .json(&payload)
        .send()
        .await
        .expect("first ingest request")
        .error_for_status()
        .expect("first ingest status");
    let first_json: Value = first.json().await.expect("first json");
    let first_log_id = first_json["log_id"].as_str().expect("first log_id").to_string();

    let second = client
        .post(format!("{}/api/v1/logs/ingest/fluentd", base_url))
        .header("x-api-key", api_key)
        .header("idempotency-key", "syslog-001-42")
        .json(&payload)
        .send()
        .await
        .expect("second ingest request")
        .error_for_status()
        .expect("second ingest status");
    let second_json: Value = second.json().await.expect("second json");
    let second_log_id = second_json["log_id"].as_str().expect("second log_id").to_string();

    assert_eq!(first_log_id, second_log_id, "idempotency should dedupe fluentd ingest");

    let metrics_resp = client
        .get(format!("{}/metrics", base_url))
        .send()
        .await
        .expect("metrics request")
        .error_for_status()
        .expect("metrics status");
    let metrics_text = metrics_resp.text().await.expect("metrics body");
    assert!(metrics_text.contains("log_guardian_collector_ingest_requests_total"));
    assert!(metrics_text.contains("log_guardian_collector_ingest_success_total"));
    assert!(metrics_text.contains("log_guardian_collector_duplicate_total"));

    let _ = child.kill();
    let _ = child.wait();
}
