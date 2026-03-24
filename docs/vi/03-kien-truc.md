# 3. Kien Truc He Thong

## 3.1 So Do Kien Truc Tong The

```
                         +-------------------+
                         |   Frontend (React) |
                         |   Port: 8080       |
                         +--------+----------+
                                  |
                          HTTPS / REST API
                                  |
                         +--------v----------+
                         |   Backend (Axum)   |
                         |   Port: 9000       |
                         +--+------+------+--+
                            |      |      |
               +------------+   +--+--+   +------------+
               |                |     |                 |
      +--------v-------+  +----v-+  +v-----------+  +--v-----------+
      |  PostgreSQL     |  | IPFS |  | Solana     |  | Gemini API   |
      |  (Off-chain DB) |  | via  |  | Devnet     |  | (AI Support) |
      +----------------+  |Pinata|  | Blockchain |  +--------------+
                           +------+  +------------+

   +---------------------+          +------------------+
   | Agent Syslog        |  UDP/TCP | Thiet bi / Server|
   | Collector           |<---------| (Nguon log)      |
   +----------+----------+          +------------------+
              |
     HTTP POST (Fluentd format)
              |
   +----------v----------+
   |   Backend API        |
   |   /ingest/fluentd    |
   +---------------------+

   +---------------------+
   | Fluentd (Docker)    |   Tail log file
   |                     |---------> Backend API
   +---------------------+          /ingest/fluentd
```

## 3.2 Cac Tang (Layers)

### Tang 1: Thu Thap Du Lieu (Data Collection Layer)

| Thanh phan | Giao thuc | Mo ta |
|------------|-----------|-------|
| Agent Syslog Collector | UDP (RFC 5424) | Lang nghe syslog tu thiet bi, batch va gui den backend |
| Fluentd | File tail + HTTP | Doc log file cua backend, chuyen doi va gui den API ingest |
| Direct Upload | HTTP multipart | Nguoi dung upload file log truc tiep qua dashboard |

### Tang 2: Xu Ly (Processing Layer)

Backend API server (Rust/Axum) chiu trach nhiem:

1. **Nhan log**: Qua endpoint ingest (multipart hoac JSON)
2. **Hash**: Tinh SHA-256 hash cua noi dung log
3. **Luu PostgreSQL**: Luu metadata, hash, noi dung vao database
4. **Upload IPFS**: Gui noi dung log len Pinata de luu tru phi tap trung
5. **Neo Solana**: Gui memo transaction chua log_id, sha256, CID len blockchain
6. **Retry**: Xu ly lai cac thao tac that bai (IPFS/Solana) voi exponential backoff

### Tang 3: Luu Tru (Storage Layer)

| Kho luu tru | Loai | Du lieu |
|-------------|------|--------|
| PostgreSQL | Tap trung | Metadata log, trang thai, vai tro, audit log, retry jobs |
| IPFS/Pinata | Phi tap trung | Noi dung log goc (bat bien) |
| Solana Devnet | Blockchain | Bang chung mat ma: hash + CID + log_id |

### Tang 4: Giao Dien (Presentation Layer)

Frontend React cung cap:
- Dashboard tong quan voi thong ke thoi gian thuc
- Log Explorer de tim kiem, loc, va xac minh log
- Analytics voi bieu do phan tich
- Quan ly vai tro va cau hinh
- AI Chatbox ho tro xu ly su co

## 3.3 Luong Xu Ly Ingest

```
Client gui log
      |
      v
[Rate Limiter] --> Reject neu vuot qua gioi han
      |
      v
[Auth Check] --> Kiem tra API Key hoac JWT
      |
      v
[Validate] --> Kiem tra kich thuoc, format
      |
      v
[SHA-256 Hash] --> Tinh hash cua noi dung
      |
      v
[PostgreSQL INSERT] --> Luu metadata + noi dung
      |
      v
[Upload IPFS] --> Gui len Pinata
      |          |
      |    [That bai] --> Tao retry job
      |          |
      v          v
[Memo Solana] --> Gui transaction
      |          |
      |    [That bai] --> Tao retry job
      |          |
      v          v
[Cap nhat status] --> confirmed / pending_*
      |
      v
[Tra ve response]
```

## 3.4 Luong Xac Minh (Verification Flow)

```
Nguoi dung yeu cau xac minh log
      |
      v
[Doc log tu PostgreSQL]
      |
      v
[Tinh lai SHA-256 hash tu raw_content]
      |
      v
[So sanh voi hash da luu]
      |
      +--- Khop -------> [Kiem tra on-chain]
      |                         |
      |                   [Lay transaction tu Solana]
      |                         |
      |                   [Parse memo data]
      |                         |
      |                   [So sanh sha256 + CID]
      |                         |
      |                   +--Khop--> "verified"
      |                   |
      |                   +--Khong khop--> "tampered"
      |
      +--- Khong khop --> "tampered"
```

## 3.5 Luong Retry

```
Retry Worker (background task)
      |
      v
[Query retry_jobs WHERE status = 'pending']
      |
      v
[Cho toi next_attempt_at]
      |
      v
[Thu lai thao tac (IPFS upload hoac Solana tx)]
      |
      +--- Thanh cong --> Cap nhat log status, danh dau job "completed"
      |
      +--- That bai --> Tang retry_count
                  |
                  +--- retry_count < 5 --> Tinh next_attempt_at (exponential backoff)
                  |
                  +--- retry_count >= 5 --> Danh dau job "failed"
```

**Exponential backoff**: `delay = base_delay * 2^(retry_count - 1)`
- Base delay: 8,000ms
- Retry 1: 8s, Retry 2: 16s, Retry 3: 32s, Retry 4: 64s, Retry 5: 128s

## 3.6 Xac Thuc va Phan Quyen

```
[Wallet Login]
      |
      v
[POST /api/v1/auth/wallet/login]
      |
      v
[Backend kiem tra wallet_roles table]
      |
      +--- Co vai tro --> Dung vai tro da gan
      |
      +--- Khong co --> Gan "employee" mac dinh
      |
      v
[Tao JWT token (wallet, role, exp)]
      |
      v
[Tra ve token + role cho frontend]
      |
      v
[Frontend luu vao localStorage]
```

### Ma tran quyen truy cap

| Endpoint | employee | manager | admin |
|----------|----------|---------|-------|
| `/health`, `/metrics` | Public | Public | Public |
| `/api/v1/logs/*` | Co | Co | Co |
| `/api/v1/dashboard/*` | Co | Co | Co |
| `/api/v1/activity` | Co | Co | Co |
| `/api/v1/logs/ingest` | API Key | API Key | API Key |
| `/api/v1/admin/*` | Khong | Khong | Co |

## 3.7 Giao Tiep Giua Cac Thanh Phan

| Tu | Den | Giao thuc | Endpoint |
|----|-----|-----------|----------|
| Frontend | Backend | HTTP REST | `/api/v1/*` |
| Collector | Backend | HTTP POST | `/api/v1/logs/ingest/fluentd` |
| Fluentd | Backend | HTTP POST | `/api/v1/logs/ingest/fluentd` |
| Backend | PostgreSQL | TCP | PostgreSQL wire protocol |
| Backend | Pinata | HTTPS | Pinata API (upload) |
| Backend | Solana | HTTPS | Solana JSON-RPC |
| Frontend | Solana | HTTPS | Solana JSON-RPC (balance) |
