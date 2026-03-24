# 6. Solana Smart Contract

## 6.1 Tong Quan

| Thuoc tinh | Gia tri |
|------------|---------|
| **Ten program** | `log_evidence_anchor` |
| **Framework** | Anchor 0.30.1 |
| **Mang** | Solana Devnet |
| **Program ID** | `6enXBVJChBad8Bs7yYjZkwzxGvVtTW7hNok3YLep5tF3` |
| **Ngon ngu** | Rust |
| **Source** | `solana-program/programs/log-evidence-anchor/src/lib.rs` |

Smart contract nay cung cap logic on-chain de neo metadata log len blockchain Solana. Moi ban ghi log duoc luu tru nhu mot PDA (Program Derived Address) account rieng biet.

## 6.2 Instruction: `store_log_evidence`

Day la instruction duy nhat cua program, dung de luu tru bang chung log tren blockchain.

### Tham so (Arguments)

| Tham so | Kieu | Rang buoc | Mo ta |
|---------|------|-----------|-------|
| `device_id` | String | Toi da 64 bytes | ID thiet bi nguon |
| `timestamp` | i64 | — | Thoi gian log (Unix epoch) |
| `sha256_hex` | String | Chinh xac 64 ky tu hex | SHA-256 hash cua noi dung log |
| `ipfs_cid` | String | Toi da 96 bytes | IPFS Content Identifier |
| `tx_ref` | String | Toi da 128 bytes | Tham chieu giao dich |

### Tai khoan (Accounts)

| Tai khoan | Quyen | Mo ta |
|-----------|-------|-------|
| `payer` | Signer, Writable | Nguoi ky va tra phi giao dich |
| `log_record` | Writable | PDA account duoc tao moi |
| `system_program` | — | Solana System Program |

### Logic xu ly

```rust
1. Kiem tra device_id.len() <= 64
2. Kiem tra sha256_hex.len() == 64
3. Kiem tra ipfs_cid.len() <= 96
4. Kiem tra tx_ref.len() <= 128
5. Ghi du lieu vao log_record PDA account
6. Ghi created_at = Clock::get().unix_timestamp
7. Ghi bump = ctx.bumps.log_record
```

## 6.3 PDA (Program Derived Address)

Moi ban ghi log duoc luu tru tai mot dia chi PDA duy nhat, duoc suy ra tu cac seeds:

### Seeds

```
seeds = [b"log_record", device_id.as_bytes(), &timestamp.to_le_bytes()]
```

| Seed | Gia tri | Mo ta |
|------|---------|-------|
| Hang so | `b"log_record"` | Tien to co dinh |
| `device_id` | UTF-8 bytes | ID thiet bi |
| `timestamp` | i64 LE bytes | Thoi gian (little-endian) |

### Cong thuc suy ra

```
PDA = find_program_address(
    ["log_record", device_id_bytes, timestamp_le_bytes],
    program_id
)
```

**Luu y**: Moi cap (device_id, timestamp) chi co the tao mot PDA duy nhat. Neu co gang tao PDA trung lap, giao dich se that bai.

## 6.4 Account: `LogRecord`

| Truong | Kieu | Kich thuoc | Mo ta |
|--------|------|------------|-------|
| `device_id` | String | 4 + 64 bytes | ID thiet bi |
| `timestamp` | i64 | 8 bytes | Thoi gian |
| `sha256_hex` | String | 4 + 64 bytes | SHA-256 hash |
| `ipfs_cid` | String | 4 + 96 bytes | IPFS CID |
| `tx_ref` | String | 4 + 128 bytes | Tham chieu giao dich |
| `created_at` | i64 | 8 bytes | Thoi gian tao tren blockchain |
| `bump` | u8 | 1 byte | PDA bump seed |

### Kich thuoc Account

```
Anchor discriminator:  8 bytes
MAX_SPACE:           381 bytes
----------------------------
Tong cong:           389 bytes
```

### Phi Rent (Devnet)

Uoc tinh phi rent cho mot account 389 bytes:

```bash
solana rent 389 --url devnet
```

Khoang ~0.003 SOL cho moi log record.

## 6.5 Ma Loi (Error Codes)

| Ma | Ten | Thong bao |
|----|-----|-----------|
| 6000 | `DeviceIdTooLong` | device_id exceeds 64 bytes |
| 6001 | `InvalidHashLength` | sha256 must be 64 hex chars |
| 6002 | `CidTooLong` | ipfs cid exceeds 96 bytes |
| 6003 | `TxRefTooLong` | tx_ref exceeds 128 bytes |

## 6.6 IDL (Interface Definition Language)

File IDL duoc sinh tu dong khi build voi Anchor:

- **Nguon goc**: `solana-program/target/idl/log_evidence_anchor.json`
- **Ban sao**: `backend/idl/log_evidence_anchor.json`

IDL dinh nghia:
- Dia chi program
- Danh sach instructions va arguments
- Danh sach accounts va truong du lieu
- Danh sach error codes

### Su dung IDL

**Trong Rust (backend)**:
Backend su dung Solana RPC truc tiep de gui memo transaction, khong su dung IDL truc tiep.

**Trong JavaScript (frontend)**:
```typescript
import idl from './idl/log_evidence_anchor.json';
const programId = new PublicKey(idl.address);
```

## 6.7 Memo Transaction

Ngoai viec luu tru trong PDA, backend cung gui **memo transaction** len Solana chua thong tin tom tat:

```json
{
  "log_id": "uuid",
  "sha256": "64_hex_chars",
  "cid": "QmXyz..."
}
```

Memo duoc su dung de:
- Xac minh nhanh tren blockchain explorer
- Kiem tra bat doi xung (khong can truy cap PostgreSQL)
- Lam bang chung khong the choi cai

## 6.8 Build va Deploy

### Build

```bash
cd solana-program
anchor build
```

Output:
- Program binary: `target/deploy/log_evidence_anchor.so`
- IDL: `target/idl/log_evidence_anchor.json`
- Keypair: `target/deploy/log_evidence_anchor-keypair.json`

### Deploy len Devnet

```bash
# Dam bao co du SOL
solana balance --keypair ~/.config/solana/log-guardian-devnet.json --url devnet

# Airdrop neu can
solana airdrop 2 --keypair ~/.config/solana/log-guardian-devnet.json --url devnet

# Deploy
anchor deploy --provider.cluster devnet
```

### Kiem tra Program

```bash
# Xem thong tin program
solana program show 6enXBVJChBad8Bs7yYjZkwzxGvVtTW7hNok3YLep5tF3 --url devnet

# Xem giao dich gan day
solana confirm <tx_signature> --url devnet -v
```

## 6.9 Chinh Sach Khoa Ky (Signer Policy)

- Keypair ky phai duoc luu **ngoai repository**
- Chi backend service account moi duoc ky giao dich on-chain
- Frontend wallet chi dung cho xac thuc phien va UX xac minh
- Xoay vong khoa moi quy hoac khi co su co
- Dat canh bao khi so du SOL thap
