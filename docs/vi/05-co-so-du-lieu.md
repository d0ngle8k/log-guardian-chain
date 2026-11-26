# 5. Co So Du Lieu

## 5.1 Tong Quan

- **He quan tri**: PostgreSQL >= 14
- **So luong bang**: 6 bang chinh
- **So luong migration**: 7 file SQL
- **Connection string**: Cau hinh qua `POSTGRES_URL` trong `.env`

Format ket noi:
```
host=127.0.0.1 port=5432 user=log_guardian_app password=change-me dbname=log_guardian
```

## 5.2 So Do Quan He

```
+------------------+     +------------------------+
|      logs        |     | verification_events    |
|------------------|     |------------------------|
| id (PK)          |<--->| log_id (FK)            |
| device_id        |     | event_type             |
| timestamp_ms     |     | detail                 |
| level            |     | created_at             |
| message          |     +------------------------+
| source           |
| hash             |     +------------------------+
| ipfs_cid         |     |    reported_logs       |
| blockchain_tx_id |     |------------------------|
| verification_    |     | id (PK)                |
|   status         |<--->| log_id (FK)            |
| retry_count      |     | report_flag            |
| format           |     | report_reason          |
| file_size        |     | reported_by_wallet     |
| raw_content      |     | reported_by_role       |
| pda_address      |     | created_at             |
| agent_id         |     +------------------------+
| source_type      |
| seq_no           |     +------------------------+
| batch_id         |     |     retry_jobs         |
| idempotency_key  |     |------------------------|
| created_at       |     | id (PK)                |
| updated_at       |<--->| log_id (FK)            |
+------------------+     | retry_count            |
                          | max_attempts           |
+------------------+     | reason                 |
|  wallet_roles    |     | status                 |
|------------------|     | last_attempted_at      |
| wallet_address   |     | next_attempt_at        |
|   (PK)           |     | created_at             |
| role             |     | completed_at           |
| granted_by       |     +------------------------+
| granted_at       |
+------------------+     +------------------------+
                          |     audit_log          |
                          |------------------------|
                          | id (PK)                |
                          | event_type             |
                          | log_id                 |
                          | device_id              |
                          | related_data           |
                          | actor_wallet           |
                          | actor_role             |
                          | created_at             |
                          +------------------------+
```

## 5.3 Chi Tiet Cac Bang

### 5.3.1 Bang `logs`

Bang chinh luu tru tat ca cac ban ghi log.

**Migration**: `0001_create_logs.sql`, `0003_extend_logs_runtime_columns.sql`, `0005_add_collector_metadata_and_idempotency.sql`

| Cot | Kieu | Rang buoc | Mo ta |
|-----|------|-----------|-------|
| `id` | UUID | PRIMARY KEY | Ma dinh danh duy nhat |
| `device_id` | TEXT | NOT NULL, INDEX | ID thiet bi nguon |
| `timestamp_ms` | BIGINT | INDEX | Thoi gian log (Unix epoch ms) |
| `level` | TEXT | — | Muc do log (INFO, WARN, ERROR...) |
| `message` | TEXT | — | Noi dung thong bao log |
| `source` | TEXT | — | Nguon log |
| `hash` | TEXT | NOT NULL | SHA-256 hash cua noi dung |
| `ipfs_cid` | TEXT | — | Content Identifier tren IPFS |
| `blockchain_tx_id` | TEXT | — | Chu ky giao dich Solana |
| `verification_status` | TEXT | NOT NULL, INDEX | Trang thai xac minh |
| `retry_count` | INT | DEFAULT 0 | So lan thu lai |
| `last_verified_at` | TIMESTAMP | — | Lan xac minh cuoi |
| `created_at` | TIMESTAMP | DEFAULT NOW(), INDEX | Thoi gian tao |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | Thoi gian cap nhat |
| `format` | TEXT | — | Dinh dang log |
| `file_size` | BIGINT | — | Kich thuoc file (bytes) |
| `raw_content` | TEXT | — | Noi dung goc cua log |
| `pda_address` | TEXT | — | Dia chi PDA tren Solana |
| `agent_id` | TEXT | — | ID agent thu thap |
| `source_type` | TEXT | — | Loai nguon (syslog, fluentd...) |
| `seq_no` | BIGINT | — | So thu tu tu collector |
| `batch_id` | TEXT | — | ID batch |
| `idempotency_key` | TEXT | UNIQUE INDEX | Khoa chong trung lap |

**Indexes**:
- `idx_logs_device_id` ON `(device_id)`
- `idx_logs_created_at` ON `(created_at)`
- `idx_logs_verification_status` ON `(verification_status)`
- `idx_logs_hash` ON `(hash)`
- `idx_logs_timestamp_ms` ON `(timestamp_ms)`
- `idx_logs_device_timestamp` ON `(device_id, timestamp_ms)`
- `idx_logs_idempotency_key` ON `(idempotency_key)` UNIQUE

### 5.3.2 Bang `verification_events`

Luu vet cac su kien xac minh va chuyen doi trang thai.

**Migration**: `0002_create_verification_events.sql`

| Cot | Kieu | Rang buoc | Mo ta |
|-----|------|-----------|-------|
| `id` | SERIAL | PRIMARY KEY | ID tu tang |
| `log_id` | UUID | REFERENCES logs(id) | Tham chieu den log |
| `event_type` | TEXT | NOT NULL | Loai su kien |
| `detail` | TEXT | — | Chi tiet su kien |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Thoi gian |

**Cac loai event_type**:
- `verify_success`: Xac minh thanh cong
- `verify_tampered`: Phat hien gia mao
- `status_change`: Thay doi trang thai
- `retry_attempt`: Thu lai thao tac

### 5.3.3 Bang `wallet_roles`

Quan ly vai tro nguoi dung dua tren dia chi wallet.

**Migration**: `0004_create_wallet_roles.sql`

| Cot | Kieu | Rang buoc | Mo ta |
|-----|------|-----------|-------|
| `wallet_address` | TEXT | PRIMARY KEY | Dia chi wallet |
| `role` | TEXT | NOT NULL | Vai tro: employee, manager, admin |
| `granted_by` | TEXT | — | Wallet da cap quyen |
| `granted_at` | TIMESTAMP | DEFAULT NOW() | Thoi gian cap quyen |

**Index**: `idx_wallet_roles_role` ON `(role)`

### 5.3.4 Bang `reported_logs`

Luu tru cac bao cao ve log dang ngo hoac gian lan.

**Migration**: `0006_create_reported_logs.sql`

| Cot | Kieu | Rang buoc | Mo ta |
|-----|------|-----------|-------|
| `id` | UUID | PRIMARY KEY | ID bao cao |
| `log_id` | UUID | REFERENCES logs(id) | Log duoc bao cao |
| `report_flag` | TEXT | NOT NULL | Loai co: suspicious, fraud |
| `report_reason` | TEXT | — | Ly do bao cao |
| `reported_by_wallet` | TEXT | NOT NULL | Wallet nguoi bao cao |
| `reported_by_role` | TEXT | NOT NULL | Vai tro nguoi bao cao |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Thoi gian bao cao |

**Indexes**:
- `idx_reported_logs_created_at` ON `(created_at)`
- `idx_reported_logs_flag` ON `(report_flag)`
- `idx_reported_logs_wallet` ON `(reported_by_wallet)`

### 5.3.5 Bang `audit_log`

Nhat ky kiem tra ghi lai moi hanh dong quan trong.

**Migration**: `0007_create_audit_and_retry_jobs.sql`

| Cot | Kieu | Rang buoc | Mo ta |
|-----|------|-----------|-------|
| `id` | UUID | PRIMARY KEY | ID ban ghi |
| `event_type` | TEXT | NOT NULL | Loai su kien |
| `log_id` | UUID | — | Log lien quan |
| `device_id` | TEXT | — | Thiet bi lien quan |
| `related_data` | TEXT | — | Du lieu bo sung (JSON) |
| `actor_wallet` | TEXT | — | Wallet thuc hien |
| `actor_role` | TEXT | — | Vai tro thuc hien |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Thoi gian |

**Indexes**:
- `idx_audit_log_event_type` ON `(event_type)`
- `idx_audit_log_created_at` ON `(created_at)`
- `idx_audit_log_actor_wallet` ON `(actor_wallet)`

**Cac loai event_type**:
- `log_ingested`: Log moi duoc ingest
- `log_verified`: Log duoc xac minh
- `log_tampered`: Phat hien gia mao
- `role_granted`: Cap quyen moi
- `role_revoked`: Thu hoi quyen
- `log_reported`: Log bi bao cao

### 5.3.6 Bang `retry_jobs`

Quan ly hang doi thu lai cho cac thao tac that bai.

**Migration**: `0007_create_audit_and_retry_jobs.sql`

| Cot | Kieu | Rang buoc | Mo ta |
|-----|------|-----------|-------|
| `id` | UUID | PRIMARY KEY | ID cong viec |
| `log_id` | UUID | REFERENCES logs(id) | Log lien quan |
| `retry_count` | INT | DEFAULT 0 | So lan da thu |
| `max_attempts` | INT | DEFAULT 5 | So lan thu toi da |
| `reason` | TEXT | — | Ly do can thu lai |
| `status` | TEXT | NOT NULL | Trang thai: pending, processing, completed, failed |
| `last_attempted_at` | TIMESTAMP | — | Lan thu cuoi |
| `next_attempt_at` | TIMESTAMP | — | Lan thu tiep theo |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Thoi gian tao |
| `completed_at` | TIMESTAMP | — | Thoi gian hoan thanh |

**Indexes**:
- `idx_retry_jobs_status` ON `(status)`
- `idx_retry_jobs_next_attempt` ON `(next_attempt_at)`
- `idx_retry_jobs_log_id` ON `(log_id)`

## 5.4 Chay Migration

Backend tu dong chay cac file migration khi khoi dong (ham `init_db()`). Cac file migration nam tai:

```
backend/sql/migrations/
├── 0001_create_logs.sql
├── 0002_create_verification_events.sql
├── 0003_extend_logs_runtime_columns.sql
├── 0004_create_wallet_roles.sql
├── 0005_add_collector_metadata_and_idempotency.sql
├── 0006_create_reported_logs.sql
└── 0007_create_audit_and_retry_jobs.sql
```

Moi migration duoc thiet ke idempotent (co the chay nhieu lan an toan) su dung `IF NOT EXISTS`.

## 5.5 Sao Luu va Phuc Hoi

### Sao luu

```bash
pg_dump -h 127.0.0.1 -p 5432 -U log_guardian_app -d log_guardian > backup_$(date +%Y%m%d).sql
```

### Phuc hoi

```bash
psql -h 127.0.0.1 -p 5432 -U log_guardian_app -d log_guardian < backup_20260315.sql
```

### Cac bang nen sao luu dinh ky

| Bang | Muc uu tien | Ly do |
|------|-------------|-------|
| `logs` | Cao | Du lieu log chinh |
| `wallet_roles` | Cao | Quyen truy cap |
| `audit_log` | Trung binh | Lich su kiem tra |
| `verification_events` | Trung binh | Lich su xac minh |
| `reported_logs` | Trung binh | Bao cao dang ngo |
| `retry_jobs` | Thap | Co the tai tao |
