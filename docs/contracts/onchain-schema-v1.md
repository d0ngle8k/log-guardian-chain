# On-Chain Schema v1 (Anchor)

## Program
- Name: `log_evidence_anchor`
- Network: Solana Devnet
- Account model: PDA-backed `LogRecord`

## PDA Seeds
PDA for each evidence record:
- `b"log_record"`
- `device_id` bytes (utf8)
- `timestamp` LE bytes (i64)

Derivation formula:
`PDA = find_program_address(["log_record", device_id, timestamp_le], program_id)`

## Account: LogRecord

Fields:
- `device_id: String` (max 64)
- `timestamp: i64`
- `sha256_hex: String` (fixed 64)
- `ipfs_cid: String` (max 96)
- `tx_ref: String` (max 128)
- `created_at: i64`
- `bump: u8`

## Account Size Estimate
Anchor account discriminator: 8 bytes.

Estimated max serialized size:
- discriminator: 8
- device_id: 4 + 64
- timestamp: 8
- sha256_hex: 4 + 64
- ipfs_cid: 4 + 96
- tx_ref: 4 + 128
- created_at: 8
- bump: 1

Total = 389 bytes.
Add safety buffer 64 bytes -> allocate 453 bytes.

Recommended `space`: `8 + 453`.

## Rent (Devnet rough)
Rent changes by epoch and cluster config. Use CLI for exact estimate:

```bash
solana rent 461 --url devnet
```

(461 = discriminator + 453)

## Metadata DB Mapping
Postgres table `log_entries` keeps index/query fields:
- `id` (text PK)
- `device_id` (text)
- `timestamp` (bigint)
- `ipfs_cid` (text)
- `content_hash` (text)
- `format` (text)
- `file_size` (bigint)
- `tx_signature` (text)
- `pda_address` (text)
- `verification_status` (text)
- `retry_state` (text)
- `retry_attempt` (integer)
- `created_at` (bigint)
- `updated_at` (bigint)

## Constraints
- `device_id` required, max 64
- `sha256_hex` lowercase hex length 64
- `timestamp` is unix epoch millis
- `ipfs_cid` non-empty when upload succeeds
