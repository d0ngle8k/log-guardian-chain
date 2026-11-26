# 2. Huong Dan Cai Dat

## 2.1 Yeu Cau He Thong

### Phan mem bat buoc

| Phan mem | Phien ban | Muc dich |
|----------|-----------|----------|
| Rust | >= 1.75 | Build backend va collector |
| Node.js | >= 18 | Chay frontend |
| npm | >= 9 | Quan ly package frontend |
| PostgreSQL | >= 14 | Co so du lieu |
| Solana CLI | >= 1.18 | Tuong tac voi blockchain |
| Anchor | 0.30.1 | Build/deploy smart contract |

### Phan mem tuy chon

| Phan mem | Phien ban | Muc dich |
|----------|-----------|----------|
| Docker | >= 20 | Chay Fluentd |
| PowerShell | >= 7 | Chay scripts (Windows) |

### Tai khoan / Dich vu

| Dich vu | Muc dich | Bat buoc |
|---------|----------|----------|
| Pinata | IPFS pinning | Co (de upload log) |
| Solana Devnet | Blockchain | Co (de neo log) |
| Google Gemini API | AI support chat | Khong |

## 2.2 Cai Dat Backend

### Buoc 1: Clone repository

```bash
git clone https://github.com/d0ngle8k/log-guardian-chain.git
cd log-guardian-chain
```

### Buoc 2: Cau hinh PostgreSQL

Tao database va user:

```sql
CREATE DATABASE log_guardian;
CREATE USER log_guardian_app WITH PASSWORD 'your-password';
GRANT ALL PRIVILEGES ON DATABASE log_guardian TO log_guardian_app;
```

### Buoc 3: Cau hinh environment

```bash
cd backend
cp .env.example .env
```

Chinh sua file `.env` voi cac gia tri phu hop:

```env
# Bat buoc
APP_ENV=development
BACKEND_PORT=9000
POSTGRES_URL=host=127.0.0.1 port=5432 user=log_guardian_app password=your-password dbname=log_guardian
JWT_SECRET=your-jwt-secret-key
INGEST_API_KEY=your-api-key

# Blockchain (bat buoc de neo log)
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_PROGRAM_ID=6enXBVJChBad8Bs7yYjZkwzxGvVtTW7hNok3YLep5tF3
SYSTEM_KEYPAIR_PATH=/path/to/your/keypair.json

# IPFS (bat buoc de upload log)
PINATA_JWT=your-pinata-jwt-token

# Tuy chon
MAX_UPLOAD_BYTES=10485760
INGEST_RATE_LIMIT=30
INGEST_RATE_WINDOW_MS=60000
ADMIN_WALLET_ALLOWLIST=wallet1,wallet2
GEMINI_API_KEY=your-gemini-key
RUST_LOG=log_guardian_backend=debug,tower_http=info
```

### Buoc 4: Build va chay backend

```bash
cd backend
cargo build --release
./target/release/log-guardian-backend
```

Backend se chay tai `http://127.0.0.1:9000`. Kiem tra:

```bash
curl http://127.0.0.1:9000/health
```

## 2.3 Cai Dat Frontend

### Buoc 1: Cai dat dependencies

```bash
cd frontend
npm install
```

### Buoc 2: Cau hinh environment (tuy chon)

Tao file `.env` trong thu muc `frontend/`:

```env
VITE_BACKEND_URL=http://127.0.0.1:9000
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
VITE_SOLANA_PROGRAM_ID=6enXBVJChBad8Bs7yYjZkwzxGvVtTW7hNok3YLep5tF3
```

### Buoc 3: Chay development server

```bash
npm run dev
```

Frontend se chay tai `http://localhost:8080`.

### Buoc 4: Build production

```bash
npm run build
```

Output se nam trong thu muc `dist/`.

## 2.4 Cai Dat Solana Program

### Buoc 1: Tao keypair cho Devnet

```bash
solana-keygen new -o ~/.config/solana/log-guardian-devnet.json
solana config set --url devnet
solana airdrop 2 --keypair ~/.config/solana/log-guardian-devnet.json
```

### Buoc 2: Build program

```bash
cd solana-program
anchor build
```

### Buoc 3: Deploy len Devnet

```bash
anchor deploy --provider.cluster devnet
```

Luu lai Program ID va cap nhat vao:
- `solana-program/Anchor.toml`
- `solana-program/programs/log-evidence-anchor/src/lib.rs` (trong `declare_id!`)
- Backend `.env` (`SOLANA_PROGRAM_ID`)

## 2.5 Cai Dat Syslog Collector

Collector chay tu binary da build san trong `agent-syslog-collector/target/`.

Cau hinh thong qua bien moi truong:

```bash
export SYSLOG_BIND_ADDR=127.0.0.1:5514
export BACKEND_INGEST_URL=http://127.0.0.1:9000/api/v1/logs/ingest/fluentd
export AGENT_ID=my-syslog-agent
export BATCH_MAX_RECORDS=200
export BATCH_FLUSH_MS=10000
export CACHE_PATH=/path/to/collector-cache.log
export CACHE_KEY_HEX=00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff
export CACHE_REPLAY_MAX=100
```

Chay collector:

```bash
./agent-syslog-collector/target/release/agent-syslog-collector
```

## 2.6 Cai Dat Fluentd (Docker)

```bash
cd fluentd
# Cau hinh INGEST_API_KEY trong environment
export INGEST_API_KEY=your-api-key
docker compose up -d
```

## 2.7 Khoi Dong Toan Bo He Thong (Windows)

Su dung script khoi dong tat ca:

```powershell
./scripts/autostart/start-all.ps1
```

Voi du lieu syslog tu dong:

```powershell
./scripts/autostart/start-all.ps1 -SyntheticLogIntervalSeconds 10
```

Tat du lieu tu dong:

```powershell
./scripts/autostart/start-all.ps1 -DisableSyntheticLogs
```

## 2.8 Kiem Tra Suc Khoe He Thong

```powershell
./scripts/health-fullstack.ps1
```

Script nay kiem tra:
- Backend `/health` endpoint
- Collector process va UDP bind
- PostgreSQL connection va query
- Log moi nhat trong database
- Xac nhan on-chain cua transaction moi nhat

## 2.9 Tu Dong Khoi Dong Khi Reboot (Windows)

Cai dat:

```powershell
./scripts/install-startup-tasks.ps1
```

Go bo:

```powershell
./scripts/uninstall-startup-tasks.ps1
```

Cac task duoc dang ky:
- `GuardianLog-Postgres5433`: Khoi dong PostgreSQL
- `GuardianLog-Backend`: Khoi dong backend
- `GuardianLog-Collector`: Khoi dong syslog collector
- `GuardianLog-Sender`: Khoi dong synthetic log sender
