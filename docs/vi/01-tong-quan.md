# 1. Tong Quan Du An

## 1.1 Gioi Thieu

**Guardian Log** la mot nen tang dam bao tinh toan ven cua log (log integrity platform) su dung cong nghe blockchain. He thong cung cap mot chuoi kiem tra bat bien (immutable audit trail) cho cac ban ghi log he thong, dam bao rang du lieu log khong bi thay doi sau khi duoc thu thap.

He thong duoc thiet ke cho cac to chuc can tinh khong the choi cai (non-repudiation) va bang chung chong gia mao (tamper-evidence) cho log he thong cua ho.

## 1.2 Muc Tieu

- **Tinh toan ven**: Dam bao log khong bi thay doi sau khi duoc thu thap
- **Khong the choi cai**: Moi ban ghi log deu co bang chung mat ma tren blockchain
- **Luu tru phi tap trung**: Log duoc luu tru tren IPFS thong qua Pinata
- **Xac minh doc lap**: Bat ky ai cung co the xac minh tinh toan ven cua log thong qua blockchain
- **Giam sat thoi gian thuc**: Dashboard truc quan de theo doi trang thai log

## 1.3 Cac Thanh Phan Chinh

| Thanh phan | Cong nghe | Mo ta |
|------------|-----------|-------|
| **Backend** | Rust (Axum) | API server, xu ly ingest, IPFS upload, Solana transaction |
| **Frontend** | React + TypeScript + Vite | Dashboard quan ly va giam sat |
| **Solana Program** | Rust (Anchor) | Smart contract luu tru bang chung tren blockchain |
| **Syslog Collector** | Rust | Agent thu thap syslog tu cac thiet bi edge |
| **Fluentd** | Docker | Log shipper chuyen tiep log den backend |
| **PostgreSQL** | SQL | Co so du lieu off-chain luu tru metadata |

## 1.4 Luong Du Lieu Chinh

```
Thiet Bi / Nguon Log
        |
        v
[Agent Syslog Collector]  hoac  [Fluentd]
        |                          |
        +---------+----------------+
                  |
                  v
          [Backend API]
          /     |     \
         v      v      v
   [PostgreSQL] [IPFS/Pinata] [Solana Devnet]
                                    |
                                    v
                          [On-chain LogRecord PDA]
```

1. **Thu thap**: Syslog Collector hoac Fluentd thu thap log tu cac nguon
2. **Ingest**: Backend nhan log, tinh SHA-256 hash
3. **Luu tru off-chain**: Luu metadata vao PostgreSQL
4. **Luu tru phi tap trung**: Upload noi dung log len IPFS qua Pinata
5. **Neo blockchain**: Gui memo transaction len Solana Devnet voi log_id, sha256, CID
6. **Xac minh**: Nguoi dung co the xac minh tinh toan ven bat ky luc nao

## 1.5 Trang Thai Xac Minh

| Trang thai | Y nghia |
|------------|---------|
| `confirmed` | Neo blockchain thanh cong (backend noi bo) |
| `verified` | Hash khop khi xac minh |
| `tampered` | Phat hien hash khong khop |
| `pending` | Dang cho xu ly |
| `pending_no_solana` | Khong co Solana keypair cau hinh |
| `pending_funding` | Tai khoan Solana khong du SOL |
| `unverified` | Trang thai mac dinh truoc khi xac minh |

## 1.6 Vai Tro Nguoi Dung

| Vai tro | Quyen han |
|---------|-----------|
| `employee` | Xem Dashboard, Log Explorer |
| `manager` | + Xac minh hang loat (Batch Verification) |
| `admin` | + Analytics, Settings, Quan ly vai tro, KPIs, Audit Log, AI Support |

## 1.7 Cau Truc Thu Muc

```
log-guardian-chain/
├── backend/              # Rust API server
├── frontend/             # React dashboard
├── solana-program/       # Anchor smart contract
├── agent-syslog-collector/  # Syslog agent
├── fluentd/              # Fluentd config
├── scripts/              # PowerShell automation
└── docs/                 # Tai lieu
    ├── contracts/        # Data contracts
    ├── ops/              # Van hanh
    └── vi/               # Tai lieu tieng Viet
```
