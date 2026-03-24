# 11. Xu Ly Su Co (Incident Runbook)

## 11.1 Phan Loai Muc Do

| Muc do | Mo ta | Thoi gian phan hoi | Vi du |
|--------|-------|--------------------|----- |
| **SEV-1** | He thong ngung hoan toan | 15 phut | Backend down, DB mat ket noi |
| **SEV-2** | Mot phan he thong bi anh huong | 30 phut | IPFS upload that bai, Solana tx loi |
| **SEV-3** | Giam hieu suat | 2 gio | Latency tang, retry backlog lon |

## 11.2 Quy Trinh Xu Ly Ngay Lap Tuc

### Buoc 1: Xac Dinh Van De

```bash
# Kiem tra backend
curl http://127.0.0.1:9000/health

# Kiem tra metrics
curl http://127.0.0.1:9000/metrics

# Kiem tra log backend
tail -100 backend/run_out.txt

# Kiem tra Solana RPC
curl -s https://api.devnet.solana.com -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | jq .
```

### Buoc 2: Kiem Tra Upstream

| Dich vu | Cach kiem tra |
|---------|--------------|
| PostgreSQL | `psql -h 127.0.0.1 -U log_guardian_app -d log_guardian -c "SELECT 1"` |
| Solana Devnet | `curl -s https://api.devnet.solana.com -X POST -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'` |
| Pinata | `curl -s https://api.pinata.cloud/data/testAuthentication -H "Authorization: Bearer $PINATA_JWT"` |

### Buoc 3: Hanh Dong

Tuy thuoc vao nguyen nhan, xem cac muc ben duoi.

## 11.3 Cac Loi Thuong Gap va Cach Khac Phuc

### 11.3.1 Backend Khong Khoi Dong

**Trieu chung**: `curl /health` that bai hoac process khong chay

**Kiem tra**:
```bash
# Xem log loi
cat backend/run_out.txt | tail -50

# Kiem tra port 9000
ss -tlnp | grep 9000
```

**Nguyen nhan va giai phap**:

| Nguyen nhan | Giai phap |
|-------------|-----------|
| Port 9000 bi chiem | Tat process khac: `kill $(lsof -t -i:9000)` |
| PostgreSQL khong ket noi | Kiem tra `POSTGRES_URL` trong `.env` va dam bao PostgreSQL dang chay |
| File `.env` thieu | Copy tu `.env.example` va cau hinh |
| Loi migration SQL | Kiem tra log loi, sua migration va restart |

### 11.3.2 Ingest That Bai

**Trieu chung**: API tra ve loi 4xx/5xx khi gui log

**Kiem tra**:
```bash
# Test ingest
curl -X POST http://127.0.0.1:9000/api/v1/logs/ingest \
  -H "x-api-key: $INGEST_API_KEY" \
  -F "file=@test.log" \
  -F "device_id=test-device"

# Kiem tra rate limit
curl http://127.0.0.1:9000/metrics | grep ingest_rejected
```

**Nguyen nhan va giai phap**:

| Loi | Nguyen nhan | Giai phap |
|-----|-------------|-----------|
| 401 Unauthorized | API key sai | Kiem tra `INGEST_API_KEY` trong `.env` |
| 413 Payload Too Large | File qua lon | Giam kich thuoc hoac tang `MAX_UPLOAD_BYTES` |
| 429 Too Many Requests | Vuot rate limit | Doi hoac tang `INGEST_RATE_LIMIT` |
| 500 Internal Error | Loi xu ly | Xem log backend chi tiet |

### 11.3.3 IPFS Upload That Bai

**Trieu chung**: Log duoc tao nhung `ipfs_cid` la placeholder hoac retry job duoc tao

**Kiem tra**:
```bash
# Kiem tra Pinata auth
curl -s https://api.pinata.cloud/data/testAuthentication \
  -H "Authorization: Bearer $PINATA_JWT"

# Kiem tra retry queue
curl -H "Authorization: Bearer <admin-token>" \
     http://127.0.0.1:9000/api/v1/admin/retry-jobs
```

**Nguyen nhan va giai phap**:

| Nguyen nhan | Giai phap |
|-------------|-----------|
| JWT het han | Tao JWT moi tren Pinata dashboard |
| Vuot quota | Nang cap Pinata plan hoac xoa file cu |
| Pinata API down | Doi va retry tu dong xu ly |
| Network loi | Kiem tra ket noi internet |

### 11.3.4 Solana Transaction That Bai

**Trieu chung**: Log co trang thai `pending_funding` hoac `pending_no_solana`

**Kiem tra**:
```bash
# Kiem tra so du
solana balance --keypair $SYSTEM_KEYPAIR_PATH --url devnet

# Kiem tra keypair ton tai
ls -la $SYSTEM_KEYPAIR_PATH

# Kiem tra Solana Devnet
solana cluster-version --url devnet
```

**Nguyen nhan va giai phap**:

| Trang thai | Nguyen nhan | Giai phap |
|------------|-------------|-----------|
| `pending_no_solana` | `SYSTEM_KEYPAIR_PATH` khong duoc cau hinh | Dat duong dan keypair trong `.env` |
| `pending_funding` | Tai khoan het SOL | `solana airdrop 2` (Devnet) |
| Transaction loi | RPC endpoint down | Doi hoac dung RPC khac |

### 11.3.5 Xac Minh Phat Hien Gia Mao (Tampered)

**Trieu chung**: Log co trang thai `tampered` sau khi verify

**Quy trinh dieu tra**:

1. **Xac nhan hash khong khop**:
```bash
curl -H "Authorization: Bearer <token>" \
     http://127.0.0.1:9000/api/v1/logs/<id>/verify
```

2. **Kiem tra noi dung goc**:
```bash
curl -H "Authorization: Bearer <token>" \
     http://127.0.0.1:9000/api/v1/logs/<id>/content
```

3. **So sanh voi IPFS**:
```bash
curl https://gateway.pinata.cloud/ipfs/<CID>
```

4. **Kiem tra on-chain**:
```bash
solana confirm <tx_signature> --url devnet -v
```

5. **Kiem tra audit log** de xem ai da truy cap log

**Nguyen nhan co the**:
- Du lieu trong PostgreSQL bi sua
- File tren IPFS bi thay the (kho xay ra do tinh bat bien cua CID)
- Loi trong qua trinh tinh hash

### 11.3.6 Collector Khong Nhan Duoc Syslog

**Trieu chung**: Khong co log moi tu collector

**Kiem tra**:
```bash
# Kiem tra process
ps aux | grep agent-syslog-collector

# Kiem tra UDP bind
ss -ulnp | grep 5514

# Gui test syslog
echo "<34>1 $(date -u +%Y-%m-%dT%H:%M:%SZ) test test-app 1234 - test" | nc -u 127.0.0.1 5514
```

**Nguyen nhan va giai phap**:

| Nguyen nhan | Giai phap |
|-------------|-----------|
| Process khong chay | Restart collector |
| Port bi chiem | Tat process khac tren port do |
| Firewall chan | Cho phep UDP port 5514 |
| Backend URL sai | Kiem tra `BACKEND_INGEST_URL` |

### 11.3.7 Frontend Khong Tai Duoc

**Trieu chung**: Dashboard hien trang trang hoac loi

**Kiem tra**:
```bash
# Kiem tra dev server
curl http://localhost:8080

# Kiem tra backend connectivity
curl http://127.0.0.1:9000/health
```

**Nguyen nhan va giai phap**:

| Nguyen nhan | Giai phap |
|-------------|-----------|
| Dev server chua chay | `cd frontend && npm run dev` |
| CORS loi | Kiem tra CORS config trong backend |
| Backend URL sai | Kiem tra `VITE_BACKEND_URL` |
| Node modules thieu | `npm install` |

### 11.3.8 Database Ket Noi That Bai

**Trieu chung**: Backend log hien "connection refused" hoac "authentication failed"

**Kiem tra**:
```bash
# Kiem tra PostgreSQL
pg_isready -h 127.0.0.1 -p 5432

# Thu ket noi
psql "host=127.0.0.1 port=5432 user=log_guardian_app dbname=log_guardian"
```

**Nguyen nhan va giai phap**:

| Nguyen nhan | Giai phap |
|-------------|-----------|
| PostgreSQL chua chay | Khoi dong PostgreSQL service |
| Sai credentials | Kiem tra `POSTGRES_URL` trong `.env` |
| Database chua tao | `CREATE DATABASE log_guardian;` |
| Max connections | Tang `max_connections` trong postgresql.conf |

## 11.4 Mau Thong Bao Su Co

```
## Su Co [SEV-X]: [Mo ta ngan]

**Thoi gian phat hien**: YYYY-MM-DD HH:MM UTC
**Thanh phan bi anh huong**: [Backend/Frontend/Collector/IPFS/Solana]
**Tac dong**: [Mo ta tac dong]

### Timeline
- HH:MM - Phat hien van de
- HH:MM - Bat dau dieu tra
- HH:MM - Xac dinh nguyen nhan
- HH:MM - Ap dung giai phap
- HH:MM - Xac nhan phuc hoi

### Nguyen nhan goc
[Mo ta chi tiet]

### Giai phap
[Cac buoc da thuc hien]

### Phong ngua
[Cac bien phap tranh lap lai]
```

## 11.5 Postmortem

Sau moi su co SEV-1 hoac SEV-2, can lam postmortem:

1. **Timeline chi tiet**: Tung buoc tu luc phat hien den khi phuc hoi
2. **Nguyen nhan goc**: Root cause analysis (5 Whys)
3. **Tac dong**: So luong log bi anh huong, thoi gian downtime
4. **Cac buoc phong ngua**: Action items cu the voi nguoi chiu trach nhiem va deadline
5. **Bai hoc rut ra**: Nhung gi lam tot va nhung gi can cai thien

## 11.6 Lien He Ho Tro

| Kenh | Mo ta |
|------|-------|
| Admin AI Chat | Dung AIChatbox hoac AdminSupportChat tren dashboard |
| Audit Log | Xem `/api/v1/admin/audit-log` de truy vet hanh dong |
| Metrics | Xem `/metrics` de phat hien xu huong bat thuong |
