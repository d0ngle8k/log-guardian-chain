# Log Guardian Data Contract v1

## Scope
This contract defines canonical API payloads between frontend and backend, plus shared status and error shapes.

## Log Entry (API -> Frontend)

```json
{
  "id": "log-uuid",
  "deviceId": "sensor-alpha-01",
  "timestamp": 1773721921209,
  "ipfsCid": "Qm...",
  "hashOnChain": "hex_sha256_64",
  "format": "Plain Text",
  "fileSize": 35,
  "status": "pending",
  "txSignature": "base58_sig",
  "pdaAddress": "base58_pubkey",
  "retryState": "none",
  "createdAt": 1773721921209,
  "updatedAt": 1773721921209
}
```

## Verification Status Enum
- `pending`: Not verified yet.
- `verified`: Payload hash matches canonical hash.
- `tampered`: Payload hash mismatch.
- `unverified`: Legacy/default state before verification.

## Retry State Enum
- `none`
- `queued`
- `processing`
- `failed`
- `completed`

## Pagination Response

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "page_size": 50
}
```

Rules:
- `page >= 1`
- `1 <= page_size <= 200`

## Error Shape (Canonical)

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "human readable",
    "request_id": "uuid",
    "details": {"key": "value"}
  }
}
```

Standard error codes:
- `BAD_REQUEST`
- `UNAUTHORIZED`
- `FORBIDDEN`
- `NOT_FOUND`
- `RATE_LIMIT_EXCEEDED`
- `IPFS_UPLOAD_FAILED`
- `SOLANA_TX_FAILED`
- `INTERNAL_ERROR`

## Ingest Request
- Method: `POST /api/v1/logs/ingest`
- Multipart fields:
  - `file` (required)
  - `device_id` (optional)
  - `timestamp` (optional)
  - `format` (optional)

Auth headers:
- `x-api-key: <key>` or `Authorization: Bearer <key>`

## Verify Response

```json
{
  "logId": "log-uuid",
  "expectedHash": "hex_sha256_64",
  "actualHash": "hex_sha256_64",
  "verified": true,
  "status": "verified"
}
```
