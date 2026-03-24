# 8. Agent Syslog Collector

## 8.1 Tong Quan

| Thuoc tinh | Gia tri |
|------------|---------|
| **Ngon ngu** | Rust |
| **Giao thuc** | UDP (RFC 5424 Syslog) |
| **Chuc nang** | Thu thap syslog tu thiet bi, batch va gui den backend |
| **Output** | HTTP POST den `/api/v1/logs/ingest/fluentd` |
| **Source** | `agent-syslog-collector/` |

Agent Syslog Collector la mot binary chay tren edge, lang nghe luu luong syslog (UDP) tu cac thiet bi va may chu, sau do chuyen tiep den backend API duoi dang JSON.

> **Luu y**: Source code day du cua collector khong nam trong repository nay. Chi co binary da build (trong `target/`) va file test end-to-end.

## 8.2 Kien Truc

```
+------------------+     UDP (RFC 5424)     +------------------------+
| Thiet bi / Server| ------------------->   | Agent Syslog Collector |
| (Syslog source)  |                        |                        |
+------------------+                        | 1. Lang nghe UDP       |
                                            | 2. Parse RFC 5424      |
                                            | 3. Batch records       |
                                            | 4. Gui HTTP POST       |
                                            +----------+-------------+
                                                       |
                                              HTTP POST (JSON)
                                                       |
                                            +----------v-------------+
                                            | Backend API            |
                                            | /api/v1/logs/ingest/   |
                                            |        fluentd         |
                                            +------------------------+
```

## 8.3 Cau Hinh

Tat ca cau hinh thong qua bien moi truong:

| Bien | Mac dinh | Bat buoc | Mo ta |
|------|----------|----------|-------|
| `SYSLOG_BIND_ADDR` | — | Co | Dia chi bind UDP (vd: `127.0.0.1:5514`) |
| `BACKEND_INGEST_URL` | — | Co | URL endpoint ingest backend |
| `AGENT_ID` | — | Co | Dinh danh agent (gui kem moi payload) |
| `BATCH_MAX_RECORDS` | `200` | Khong | So ban ghi toi da trong mot batch |
| `BATCH_FLUSH_MS` | `10000` | Khong | Thoi gian flush batch (milliseconds) |
| `CACHE_PATH` | — | Co | Duong dan file cache offline |
| `CACHE_KEY_HEX` | — | Co | Khoa ma hoa cache (64 ky tu hex) |
| `CACHE_REPLAY_MAX` | `100` | Khong | So ban ghi toi da replay tu cache |
| `INGEST_API_KEY` | — | Khong | API key de xac thuc voi backend |

### Vi du cau hinh

```bash
export SYSLOG_BIND_ADDR=127.0.0.1:5514
export BACKEND_INGEST_URL=http://127.0.0.1:9000/api/v1/logs/ingest/fluentd
export AGENT_ID=guardian-syslog-agent
export BATCH_MAX_RECORDS=200
export BATCH_FLUSH_MS=10000
export CACHE_PATH=/var/log/guardian/collector-cache.log
export CACHE_KEY_HEX=00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff
export CACHE_REPLAY_MAX=100
export INGEST_API_KEY=your-api-key
```

## 8.4 Dinh Dang Payload

Khi gui den backend, collector dinh dang payload nhu sau:

```json
{
  "device_id": "collector-device",
  "message": "{\"agent_id\":\"guardian-syslog-agent\",\"event_type\":\"syslog.rfc5424\",\"data\":{\"raw\":\"<34>1 2026-03-17T10:20:30Z host app 1234 ID47 - test syslog message\",\"facility\":4,\"severity\":2,\"hostname\":\"host\",\"app_name\":\"app\",\"proc_id\":\"1234\",\"msg_id\":\"ID47\"}}",
  "timestamp": 1773926430000,
  "format": "plain",
  "level": "INFO",
  "source": "syslog-collector",
  "agent_id": "guardian-syslog-agent",
  "source_type": "syslog"
}
```

### Cac truong trong `message` (JSON nested)

| Truong | Mo ta |
|--------|-------|
| `agent_id` | ID cua collector agent |
| `event_type` | Loai su kien: `syslog.rfc5424` |
| `data.raw` | Noi dung syslog goc |
| `data.facility` | Syslog facility code |
| `data.severity` | Syslog severity code |
| `data.hostname` | Hostname nguon |
| `data.app_name` | Ten ung dung |
| `data.proc_id` | Process ID |
| `data.msg_id` | Message ID |

## 8.5 Co Che Batch

Collector gom nhom cac syslog message thanh batch truoc khi gui:

1. **Theo so luong**: Khi dat `BATCH_MAX_RECORDS` ban ghi
2. **Theo thoi gian**: Khi het `BATCH_FLUSH_MS` milliseconds

Dieu kien nao den truoc se trigger flush batch.

## 8.6 Offline Cache

Khi backend khong kha dung, collector se:

1. Luu cac ban ghi vao file cache tai `CACHE_PATH`
2. Ma hoa noi dung cache bang khoa `CACHE_KEY_HEX`
3. Khi backend kha dung tro lai, replay toi da `CACHE_REPLAY_MAX` ban ghi tu cache

Dieu nay dam bao khong mat du lieu khi co gian doan mang.

## 8.7 Chay Collector

### Chay truc tiep

```bash
# Cau hinh bien moi truong (xem muc 8.3)
./agent-syslog-collector/target/release/agent-syslog-collector
```

### Chay qua script (Windows)

```powershell
./scripts/autostart/start-collector.ps1
```

### Kiem tra collector dang chay

```bash
# Kiem tra process
ps aux | grep agent-syslog-collector

# Kiem tra UDP bind
ss -ulnp | grep 5514
```

## 8.8 Gui Syslog Test

### Linux/macOS

```bash
echo "<34>1 $(date -u +%Y-%m-%dT%H:%M:%SZ) test-host test-app 1234 - test message" | nc -u 127.0.0.1 5514
```

### PowerShell (Windows)

```powershell
$client = New-Object System.Net.Sockets.UdpClient
$timestamp = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss.000Z')
$payload = "<34>1 $timestamp test-host test-app 1234 - test message"
$bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
$client.Send($bytes, $bytes.Length, "127.0.0.1", 5514)
$client.Close()
```

## 8.9 Testing

### E2E Test (`tests/e2e_syslog_ingest.rs`)

Test end-to-end kiem tra toan bo luong:

1. Tao mock HTTP server tai endpoint Fluentd
2. Khoi dong collector binary voi cau hinh ephemeral
3. Gui UDP syslog message
4. Xac nhan collector chuyen tiep message den mock server
5. Kiem tra payload chua `agent_id` va `event_type: syslog.rfc5424`

Chay test:

```bash
cd agent-syslog-collector
cargo test
```

## 8.10 Xu Ly Su Co

| Van de | Nguyen nhan | Giai phap |
|--------|-------------|-----------|
| Collector khong nhan duoc syslog | Port bi chiem boi process khac | Kiem tra `ss -ulnp \| grep <port>` |
| Collector khong gui duoc den backend | Backend chua khoi dong hoac URL sai | Kiem tra `BACKEND_INGEST_URL` va `curl /health` |
| Cache file qua lon | Backend khong kha dung lau | Kiem tra backend, restart collector sau khi backend phuc hoi |
| Loi xac thuc | API key sai hoac het han | Kiem tra `INGEST_API_KEY` |
