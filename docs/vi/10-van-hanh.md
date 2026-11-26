# 10. Van Hanh & Giam Sat

## 10.1 Tong Quan

He thong Guardian Log cung cap nhieu cong cu de giam sat va van hanh:

- **Metrics endpoint** (`/metrics`): Cac counter kieu Prometheus
- **Health check** (`/health`): Kiem tra tinh trang backend
- **PowerShell scripts**: Tu dong hoa kiem tra suc khoe toan he thong
- **KPIs**: Chi so hieu suat qua admin API
- **Audit log**: Nhat ky kiem tra moi hanh dong

## 10.2 Metrics (Prometheus)

### Endpoint

```
GET /metrics
```

Khong can xac thuc. Tra ve cac counter dang text/plain.

### Danh Sach Metrics

| Counter | Mo ta | Y nghia |
|---------|-------|---------|
| `log_guardian_ingest_requests_total` | Tong so request ingest | Luong log den he thong |
| `log_guardian_ingest_success_total` | Ingest thanh cong | Log duoc xu ly thanh cong |
| `log_guardian_ingest_rejected_total` | Ingest bi tu choi | Bi rate limit, auth fail, size limit |
| `log_guardian_verify_requests_total` | Tong so request xac minh | Luong xac minh |
| `log_guardian_verify_success_total` | Xac minh thanh cong | Log verified |
| `log_guardian_verify_tampered_total` | Phat hien gia mao | Log tampered |
| `log_guardian_retry_enqueued_total` | Retry jobs duoc tao | Cac thao tac that bai can thu lai |
| `log_guardian_retry_success_total` | Retry thanh cong | Thao tac that bai duoc khac phuc |
| `log_guardian_retry_failure_total` | Retry that bai | Het so lan thu toi da |

### Tich Hop Prometheus

Them vao `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'guardian-log'
    scrape_interval: 15s
    static_configs:
      - targets: ['127.0.0.1:9000']
```

### Canh Bao Khuyen Nghi

| Canh bao | Dieu kien | Muc do |
|----------|-----------|--------|
| Ty le tu choi cao | `ingest_rejected / ingest_requests > 0.1` (> 10%) | Warning |
| Retry that bai lien tuc | `retry_failure_total tang > 3 trong 5 phut` | Critical |
| Phat hien gia mao | `verify_tampered_total tang > 0` | Critical |
| Ingest ngung | `ingest_requests_total khong tang trong 10 phut` | Warning |

## 10.3 Health Check

### Backend Health

```bash
curl http://127.0.0.1:9000/health
```

Response khi khoe manh:
```json
{"status": "ok"}
```

### Full Stack Health Check (PowerShell)

```powershell
./scripts/health-fullstack.ps1
```

Script nay kiem tra 5 thanh phan:

| Kiem tra | Mo ta | Lenh tuong duong |
|----------|-------|-----------------|
| Backend health | HTTP 200 tu `/health` | `curl /health` |
| Collector process | Process dang chay | `Get-Process` |
| Collector UDP bind | Port 5514 dang lang nghe | `netstat -ano` |
| PostgreSQL | Ket noi va query thanh cong | `psql -c "SELECT 1"` |
| Latest log | Log moi nhat trong DB | `SELECT * FROM logs ORDER BY created_at DESC LIMIT 1` |
| On-chain tx | Giao dich Solana duoc xac nhan | `solana confirm <tx>` |

## 10.4 KPIs (Key Performance Indicators)

Truy cap qua admin API:

```bash
curl -H "Authorization: Bearer <admin-token>" \
     http://127.0.0.1:9000/api/v1/admin/kpis
```

| KPI | Mo ta | Muc tieu |
|-----|-------|----------|
| `ingest_failure_rate` | Ty le ingest that bai | < 2% |
| `retry_backlog` | So retry jobs dang cho | < 10 |
| `retry_failed` | So retry jobs da that bai vinh vien | 0 |
| `audit_coverage` | Ty le log co audit trail | > 98% |
| `mttr` | Mean Time To Resolve (giay) | < 60s |

## 10.5 Audit Log

Moi hanh dong quan trong duoc ghi nhan vao bang `audit_log`:

| Loai su kien | Trigger |
|-------------|---------|
| `log_ingested` | Log moi duoc ingest thanh cong |
| `log_verified` | Log duoc xac minh |
| `log_tampered` | Phat hien gia mao |
| `role_granted` | Admin gan vai tro cho wallet |
| `role_revoked` | Admin thu hoi vai tro |
| `log_reported` | Nguoi dung bao cao log dang ngo |

Xem audit log:

```bash
curl -H "Authorization: Bearer <admin-token>" \
     http://127.0.0.1:9000/api/v1/admin/audit-log
```

## 10.6 Retry Jobs

### Xem retry queue

```bash
curl -H "Authorization: Bearer <admin-token>" \
     http://127.0.0.1:9000/api/v1/admin/retry-jobs
```

### Co che retry

1. Khi IPFS upload hoac Solana transaction that bai, backend tao retry job
2. Background worker kiem tra retry queue dinh ky
3. Retry theo exponential backoff:

| Lan thu | Delay |
|---------|-------|
| 1 | 8 giay |
| 2 | 16 giay |
| 3 | 32 giay |
| 4 | 64 giay |
| 5 (cuoi) | 128 giay |

4. Sau 5 lan that bai, job duoc danh dau `failed`

### Xu ly retry that bai

1. Kiem tra nguyen nhan that bai (Pinata API down? Solana RPC loi? Het SOL?)
2. Khac phuc nguyen nhan goc
3. Backend se tu dong retry cac job con trong queue

## 10.7 Giam Sat Solana

### Kiem tra so du

```bash
solana balance --keypair /path/to/keypair.json --url devnet
```

### Dat canh bao so du thap

Khuyen nghi dat canh bao khi so du SOL < 0.5:

```bash
# Script kiem tra so du
balance=$(solana balance --keypair /path/to/keypair.json --url devnet --output json | jq '.lamports')
if [ "$balance" -lt 500000000 ]; then
  echo "CANH BAO: So du SOL thap! Con lai: $balance lamports"
fi
```

### Airdrop SOL (Devnet)

```bash
solana airdrop 2 --keypair /path/to/keypair.json --url devnet
```

## 10.8 Giam Sat IPFS/Pinata

### Kiem tra CID co kha dung

```bash
curl https://gateway.pinata.cloud/ipfs/<CID>
```

### Kiem tra quota Pinata

Dang nhap tai [app.pinata.cloud](https://app.pinata.cloud) de xem:
- So file da pin
- Dung luong da su dung
- Gioi han API calls

## 10.9 Log Shipping

### Yeu cau truong log

Khi gui log den he thong giam sat ben ngoai, dam bao bao gom:

| Truong | Mo ta |
|--------|-------|
| `timestamp` | ISO 8601 |
| `level` | Log level (INFO, WARN, ERROR) |
| `service` | Ten service (backend, collector, frontend) |
| `request_id` | x-request-id header |
| `message` | Noi dung log |

### Header x-request-id

Moi response tu backend deu co header `x-request-id` (UUID) de theo doi request xuyen suot he thong.

## 10.10 SLO (Service Level Objectives)

| Chi so | Muc tieu | Mo ta |
|--------|----------|-------|
| Availability | 99.5% | Backend kha dung |
| P95 Ingest Latency | <= 2 giay | 95% request ingest duoc xu ly trong 2s |
| P95 Verify Latency | <= 1 giay | 95% request verify duoc xu ly trong 1s |
| Data Integrity | 100% | Khong mat log sau khi ingest thanh cong |

## 10.11 Scripts Van Hanh

| Script | Lenh | Mo ta |
|--------|------|-------|
| `start-all.ps1` | `./scripts/autostart/start-all.ps1` | Khoi dong toan bo he thong |
| `health-fullstack.ps1` | `./scripts/health-fullstack.ps1` | Kiem tra suc khoe toan he thong |
| `install-startup-tasks.ps1` | `./scripts/install-startup-tasks.ps1` | Cai dat tu dong khoi dong |
| `uninstall-startup-tasks.ps1` | `./scripts/uninstall-startup-tasks.ps1` | Go bo tu dong khoi dong |

### start-all.ps1 - Chi tiet

| Tham so | Mac dinh | Mo ta |
|---------|----------|-------|
| `-StartSender` | False | Bat synthetic syslog sender |
| `-SyntheticLogIntervalSeconds` | 60 | Khoang cach gui syslog tu dong |
| `-DisableSyntheticLogs` | False | Tat syslog tu dong |

Quy trinh khoi dong:
1. Khoi dong backend (port 9000)
2. Cho HTTP 200 tu `/health`
3. Khoi dong frontend (`npm run dev`, port 5174)
4. Khoi dong collector (UDP 5514)
5. (Tuy chon) Khoi dong synthetic syslog sender
6. Xu ly Ctrl+C de dung tat ca process
