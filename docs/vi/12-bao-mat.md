# 12. Bao Mat

## 12.1 Tong Quan

Guardian Log ap dung nhieu lop bao mat de bao ve tinh toan ven cua du lieu log:

1. **Mat ma**: SHA-256 hash cho moi log entry
2. **Blockchain**: Bang chung bat bien tren Solana
3. **IPFS**: Luu tru phi tap trung voi content addressing
4. **Xac thuc**: JWT tokens va API keys
5. **Phan quyen**: Role-based access control (RBAC)
6. **Rate limiting**: Chong bao hoa API

## 12.2 Xac Thuc (Authentication)

### 12.2.1 Wallet-based Login

He thong su dung xac thuc dua tren wallet blockchain thay vi username/password truyen thong.

**Luong**:
1. Nguoi dung ket noi wallet (Phantom, Metamask, hoac nhap dia chi thu cong)
2. Frontend gui dia chi wallet den backend
3. Backend tra ve JWT token

**JWT Token**:
```json
{
  "wallet": "AbC123...",
  "role": "employee",
  "exp": 1773808321
}
```

- **Signing**: Su dung `JWT_SECRET` tu bien moi truong
- **Thu vien**: `jsonwebtoken` v9
- **Luu tru**: localStorage phia frontend

### 12.2.2 API Key Authentication

Cho cac endpoint ingest (machine-to-machine):

```
x-api-key: <INGEST_API_KEY>
```

Duoc su dung boi:
- Syslog Collector
- Fluentd
- Bat ky dich vu nao gui log den backend

### 12.2.3 Admin Wallet Allowlist

Cac wallet duoc liet ke trong `ADMIN_WALLET_ALLOWLIST` se tu dong duoc gan quyen admin khi dang nhap lan dau.

```env
ADMIN_WALLET_ALLOWLIST=wallet1Address,wallet2Address
```

## 12.3 Phan Quyen (Authorization)

### Role-Based Access Control (RBAC)

| Vai tro | Cap | Quyen |
|---------|-----|-------|
| `employee` | 1 | Xem dashboard, log explorer |
| `manager` | 2 | + Batch verification |
| `admin` | 3 | + Analytics, settings, role management, KPIs, audit log |

### Kiem tra quyen

- **Backend**: Middleware kiem tra JWT claims truoc khi xu ly request
- **Frontend**: `AppLayout` component kiem tra role truoc khi render route
- **Database**: Bang `wallet_roles` luu tru phan quyen

### Gan va thu hoi quyen

Chi admin moi co the:
```bash
# Gan quyen
curl -X POST http://127.0.0.1:9000/api/v1/admin/roles \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"wallet_address": "NewWallet...", "role": "manager"}'

# Thu hoi quyen
curl -X DELETE http://127.0.0.1:9000/api/v1/admin/roles \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"wallet_address": "WalletToRevoke..."}'
```

## 12.4 Mat Ma & Hash

### SHA-256 Hashing

Moi log entry duoc hash bang SHA-256:

```
raw_content -> SHA-256 -> 64-char hex string
```

Hash duoc su dung de:
1. Luu tru trong PostgreSQL (`hash` column)
2. Neo tren Solana (trong PDA va memo)
3. Xac minh tinh toan ven (so sanh hash)

### Client-side Verification

Frontend co the xac minh doc lap:
```typescript
// Tinh hash tu noi dung
const hash = await computeSHA256(content);
// So sanh voi hash da luu
const isIntact = hash === log.hashOnChain;
```

## 12.5 Quan Ly Khoa (Key Management)

### Cac loai khoa

| Khoa | Muc dich | Luu tru |
|------|----------|---------|
| `JWT_SECRET` | Ky JWT tokens | Bien moi truong |
| `SYSTEM_KEYPAIR_PATH` | Ky giao dich Solana | File keypair (ngoai repo) |
| `PINATA_JWT` | Xac thuc Pinata API | Bien moi truong |
| `INGEST_API_KEY` | Xac thuc ingest API | Bien moi truong |
| `GEMINI_API_KEY` | Xac thuc Gemini AI | Bien moi truong |
| `CACHE_KEY_HEX` | Ma hoa cache collector | Bien moi truong |

### Chinh sach quan ly khoa

1. **Khong commit khoa vao repository**: Luon su dung `.env` va `.gitignore`
2. **Solana keypair**: Luu ngoai repository, chi backend service account moi duoc truy cap
3. **Xoay vong**: Xoay vong khoa moi quy hoac khi co su co
4. **Toi thieu quyen**: Moi khoa chi co quyen can thiet (principle of least privilege)

### Xoay vong khoa

| Khoa | Chu ky | Cach xoay |
|------|--------|-----------|
| `JWT_SECRET` | 90 ngay | Cap nhat `.env`, restart backend |
| `INGEST_API_KEY` | 90 ngay | Cap nhat `.env` va tat ca collectors |
| `PINATA_JWT` | 90 ngay | Tao JWT moi tren Pinata dashboard |
| Solana keypair | 90 ngay hoac khi su co | Tao keypair moi, cap nhat `.env`, deploy lai program neu can |

## 12.6 Rate Limiting

### Cau hinh

```env
INGEST_RATE_LIMIT=30          # So request toi da
INGEST_RATE_WINDOW_MS=60000   # Cua so thoi gian (60 giay)
```

### Hanh vi

- Ap dung cho cac endpoint ingest
- Tra ve `429 Too Many Requests` khi vuot gioi han
- Counter duoc theo doi trong metrics (`ingest_rejected_total`)

### Khuyen nghi

| Moi truong | Rate Limit | Window |
|------------|------------|--------|
| Development | 30 | 60s |
| Staging | 100 | 60s |
| Production | 500 | 60s |

## 12.7 Bao Ve Du Lieu

### Layers bao ve

```
Layer 1: HTTPS/TLS (transport encryption)
    |
Layer 2: API Key / JWT (authentication)
    |
Layer 3: RBAC (authorization)
    |
Layer 4: Rate Limiting (abuse prevention)
    |
Layer 5: SHA-256 Hash (integrity)
    |
Layer 6: IPFS CID (content addressing)
    |
Layer 7: Solana Blockchain (immutable proof)
```

### Tinh toan ven (Integrity)

1. **Tinh hash**: SHA-256 cua noi dung log khi ingest
2. **Luu hash**: Trong PostgreSQL va tren Solana
3. **Xac minh**: So sanh hash khi can kiem tra
4. **Bat bien**: Hash tren blockchain khong the sua doi

### Phi tap trung (Decentralization)

- **IPFS**: Noi dung log duoc luu phi tap trung, co the truy cap tu bat ky IPFS gateway nao
- **Blockchain**: Bang chung mat ma tren mang phi tap trung Solana
- **Khong phu thuoc**: Ngay ca khi backend bi hack, du lieu tren IPFS va blockchain van nguyen ven

## 12.8 Bao Mat Frontend

### localStorage

Frontend luu cac gia tri nhay cam trong localStorage:
- `guardian_log_token`: JWT token
- `guardian_log_role`: Vai tro nguoi dung
- `guardian_log_wallet`: Dia chi wallet

**Rui ro**: localStorage co the bi truy cap boi JavaScript malicious (XSS)

**Giam thieu**:
- Khong luu du lieu nhay cam khac trong localStorage
- JWT token co thoi han het han (`exp`)
- Dang xuat xoa tat ca du lieu localStorage

### CORS

Backend cau hinh CORS de chi chap nhan request tu frontend domain.

### Input Validation

- Frontend su dung Zod de validate input
- Backend validate tat ca cac truong truoc khi xu ly

## 12.9 Checklist Bao Mat

| Hang muc | Trang thai | Mo ta |
|----------|-----------|-------|
| HTTPS | Can cau hinh | Cau hinh TLS cho production |
| JWT Secret | Bat buoc | Dat gia tri manh cho `JWT_SECRET` |
| API Key | Bat buoc | Dat gia tri manh cho `INGEST_API_KEY` |
| Solana Keypair | Bat buoc | Luu ngoai repo, gioi han quyen |
| Rate Limiting | Co | Cau hinh phu hop voi moi truong |
| CORS | Co | Gioi han origin |
| Input Validation | Co | Zod (frontend), custom (backend) |
| Audit Logging | Co | Ghi nhan moi hanh dong quan trong |
| Role Management | Co | RBAC voi 3 cap |
| Key Rotation | Can lap lich | Xoay vong moi 90 ngay |

## 12.10 Cac Moi De Doa va Giam Thieu

| Moi de doa | Rui ro | Giam thieu |
|------------|--------|-----------|
| SQL Injection | Thap | Su dung parameterized queries |
| XSS | Trung binh | React auto-escaping, nhung localStorage van rui ro |
| DDoS | Trung binh | Rate limiting, co the them Cloudflare |
| Man-in-the-Middle | Cao (neu khong co HTTPS) | Bat buoc HTTPS cho production |
| Key Compromise | Cao | Xoay vong dinh ky, gioi han quyen |
| Data Tampering | Rat thap | SHA-256 + blockchain verification |
| Unauthorized Access | Thap | JWT + RBAC + API Key |
