# Runtime Baseline

## Environments
- `local`
- `devnet`

## Required Secrets / Config

Backend:
- `SOLANA_RPC_URL`
- `SOLANA_PROGRAM_ID`
- `SYSTEM_KEYPAIR_PATH`
- `PINATA_JWT`
- `INGEST_API_KEY`
- `JWT_SECRET`
- `DATABASE_URL`
- `REDIS_URL` (optional)

Frontend:
- `VITE_BACKEND_URL`
- `VITE_SOLANA_RPC_URL`
- `VITE_SOLANA_PROGRAM_ID`

## Admin Signer Policy
- Admin signer keypair must be stored outside repository.
- Only backend service account signs on-chain writes.
- Frontend wallet signatures are for user/session and verification UX only.
- Rotate key quarterly or on incident.
- Enforce minimum SOL balance alarm threshold.

## Solana Devnet Baseline
- Cluster: Devnet
- Program deployed from controlled keypair
- Verify program id in backend and frontend env parity

## Pinata/IPFS Baseline
- JWT scope limited to pinning operations
- CID gateway fetch through trusted gateway allowlist

## Security Baseline
- Ingest endpoint protected by API key/JWT and optional IP allowlist.
- Rate limiting per client key/ip.
- Retry queue for transient Solana/IPFS errors.
