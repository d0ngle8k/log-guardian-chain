# 13. Thuat Ngu

## A

### Anchor
Framework phat trien smart contract tren Solana. Guardian Log su dung Anchor 0.30.1 de build va deploy chuong trinh on-chain. Anchor cung cap IDL tu dong, PDA derivation, va error handling tieu chuan.

### API Key
Khoa xac thuc dung cho cac endpoint ingest (machine-to-machine). Cau hinh qua bien moi truong `INGEST_API_KEY`. Duoc gui trong header `x-api-key`.

### Audit Log
Nhat ky kiem tra ghi nhan moi hanh dong quan trong trong he thong: ingest, verify, role changes, reports. Luu trong bang `audit_log` cua PostgreSQL.

### Axum
Web framework cho Rust duoc su dung lam backend API server. Phien ban 0.8.4, ho tro async, middleware, multipart upload.

## B

### Batch
Nhom cac ban ghi log duoc xu ly cung luc. Collector gom nhom syslog messages thanh batch truoc khi gui. Frontend ho tro batch verification.

### Blockchain
Cong nghe so cai phan tan. Guardian Log su dung Solana Devnet de neo bang chung mat ma cua log, dam bao tinh bat bien.

### Bump
Gia tri bo sung (u8) duoc su dung trong viec suy ra PDA tren Solana. Duoc luu cung voi moi LogRecord de co the tai tao dia chi PDA.

## C

### CID (Content Identifier)
Ma dinh danh noi dung tren IPFS. CID duoc suy ra tu noi dung file (content addressing), dam bao rang cung mot noi dung luon co cung CID. Vi du: `QmXyz...`

### Collector
Xem **Syslog Collector**.

### Confirmed
Trang thai xac minh noi bo cho biet viec neo blockchain da thanh cong. Duoc chuyen doi thanh "verified" khi hien thi tren frontend.

## D

### Devnet
Mang thu nghiem cua Solana dung cho phat trien va test. Khong co gia tri tien that. Co the nhan SOL mien phi qua `solana airdrop`.

### Device ID
Ma dinh danh cua thiet bi hoac nguon gui log. Vi du: `sensor-alpha-01`, `gateway-bravo-02`. Duoc su dung lam seed cho PDA derivation.

## E

### Exponential Backoff
Chien luoc retry tang dan thoi gian cho giua cac lan thu. Cong thuc: `delay = base_delay * 2^(retry_count - 1)`. Base delay cua Guardian Log la 8 giay.

## F

### Fluentd
He thong thu thap va chuyen tiep log dang open-source. Guardian Log su dung Fluentd (Docker) de doc log file va gui den backend API.

## G

### Gemini API
API cua Google Gemini duoc su dung cho tinh nang AI Support Chat. Admin co the hoi cau hoi ve van hanh va xu ly su co.

### Graceful Fallback
Co che du phong khi API keys hoac keypairs khong duoc cau hinh. Backend tao placeholder CID va signature thay vi that bai hoan toan, cho phep he thong van hoat dong o che do han che.

## H

### Hash
Gia tri bam mat ma SHA-256 cua noi dung log. Chuoi hex 64 ky tu. Duoc su dung de xac minh tinh toan ven cua du lieu.

## I

### IDL (Interface Definition Language)
File JSON mo ta giao dien cua smart contract Solana (instructions, accounts, errors). Duoc Anchor tu dong sinh ra khi build.

### Idempotency Key
Khoa duy nhat dinh kem theo moi request ingest de tranh xu ly trung lap. Neu key da ton tai, backend tra ve 409 Conflict.

### Ingest
Qua trinh nhan va xu ly log moi vao he thong. Bao gom: hash, luu PostgreSQL, upload IPFS, neo Solana.

### IPFS (InterPlanetary File System)
He thong file phi tap trung su dung content addressing. Guardian Log luu noi dung log goc tren IPFS qua dich vu Pinata.

## J

### JWT (JSON Web Token)
Token xac thuc dung cho cac API endpoint. Chua thong tin wallet address, role, va thoi gian het han. Duoc ky bang `JWT_SECRET`.

## K

### KPI (Key Performance Indicator)
Chi so hieu suat: ingest failure rate, retry backlog, retry failed, audit coverage, MTTR. Truy cap qua `/api/v1/admin/kpis`.

## L

### LogRecord
Account on-chain tren Solana chua bang chung log: device_id, timestamp, sha256_hex, ipfs_cid, tx_ref, created_at, bump. Kich thuoc toi da 389 bytes.

## M

### Memo Transaction
Giao dich Solana chua du lieu nho (JSON) voi log_id, sha256, va CID. Duoc su dung de neo bang chung log tren blockchain.

### Memo Program
Chuong trinh he thong Solana (`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`) cho phep dinh kem du lieu tuy y vao giao dich.

### Metrics
Cac counter kieu Prometheus duoc xuat tai endpoint `/metrics`. Bao gom 9 counter theo doi ingest, verify, va retry.

### MTTR (Mean Time To Resolve)
Thoi gian trung binh de giai quyet su co, tinh bang giay. Mot trong cac KPI chinh cua he thong.

## P

### PDA (Program Derived Address)
Dia chi Solana duoc suy ra tu cac seeds xac dinh truoc (khong co private key). Moi log entry co mot PDA duy nhat: `["log_record", device_id, timestamp_le]`.

### Phantom
Vi (wallet) pho bien tren Solana. La phuong thuc ket noi wallet chinh cua Guardian Log frontend.

### Pinata
Dich vu IPFS pinning. Guardian Log su dung Pinata de upload va luu tru noi dung log tren IPFS. Xac thuc qua JWT.

### PostgreSQL
He quan tri co so du lieu quan he. Luu tru metadata log, vai tro nguoi dung, audit log, va retry jobs (off-chain storage).

## R

### Rate Limiting
Co che gioi han so luong request trong mot khoang thoi gian. Mac dinh: 30 requests / 60 giay cho cac endpoint ingest.

### RBAC (Role-Based Access Control)
He thong phan quyen dua tren vai tro. 3 cap: employee, manager, admin. Moi cap bao gom tat ca quyen cua cap duoi.

### Retry Job
Cong viec thu lai cho cac thao tac that bai (IPFS upload hoac Solana transaction). Duoc quan ly boi background worker voi exponential backoff.

### RFC 5424
Tieu chuan dinh dang Syslog. Syslog Collector ho tro nhan va parse message theo dinh dang nay.

## S

### SHA-256
Thuat toan bam mat ma tao ra chuoi 256-bit (64 ky tu hex). Duoc su dung de dam bao tinh toan ven cua log.

### SLO (Service Level Objective)
Muc tieu chat luong dich vu: 99.5% availability, P95 ingest latency <= 2s, P95 verify latency <= 1s.

### Solana
Nen tang blockchain hieu suat cao. Guardian Log su dung Solana Devnet de neo bang chung log.

### Syslog
Giao thuc chuan de gui log he thong. Collector ho tro nhan syslog qua UDP (port mac dinh 5514).

### Syslog Collector (Agent)
Binary Rust chay tren edge, lang nghe UDP syslog, batch va gui den backend. Ho tro offline cache khi mat ket noi.

## T

### Tampered
Trang thai xac minh cho biet hash khong khop — du lieu log da bi thay doi sau khi ingest.

### Tokio
Runtime async cho Rust. Backend su dung Tokio cho xu ly dong thoi, timers, va signals.

## V

### Verified
Trang thai xac minh cho biet hash khop va du lieu toan ven.

### Verification
Qua trinh kiem tra tinh toan ven cua log bang cach tinh lai SHA-256 hash va so sanh voi hash da luu (trong PostgreSQL va tren blockchain).

### Vite
Build tool cho frontend. Su dung SWC de compile TypeScript/JSX nhanh. Dev server chay tai port 8080.

## W

### Wallet
Vi dien tu blockchain (Phantom, Metamask). Duoc su dung de xac thuc nguoi dung trong Guardian Log thay vi username/password.

### Wallet Roles
He thong quan ly vai tro dua tren dia chi wallet. Luu trong bang `wallet_roles` cua PostgreSQL.
