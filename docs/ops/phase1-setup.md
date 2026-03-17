# Phase 1 Setup Notes

## Required Manual Inputs

1. Solana program id for `log_evidence_anchor`.
2. Devnet signer keypair path for local Anchor commands.
3. PostgreSQL DSN for backend runtime.

## Anchor

1. Open `solana-program/Anchor.toml` and replace `REPLACE_WITH_PROGRAM_ID`.
2. Open `solana-program/programs/log-evidence-anchor/src/lib.rs` and replace `REPLACE_WITH_PROGRAM_ID` in `declare_id!`.
3. Run:

```bash
cd solana-program
anchor build
```

## Database

Apply SQL files in order:

1. `backend/sql/migrations/0001_create_logs.sql`
2. `backend/sql/migrations/0002_create_verification_events.sql`

## Backend Environment

Ensure backend `.env` includes:

- `DATABASE_URL=postgres://...`
- `REDIS_URL=redis://...` (optional for Phase 1 cache)
- Existing web3 keys already documented in `docs/ops/runtime-baseline.md`
