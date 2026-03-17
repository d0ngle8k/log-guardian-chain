-- Initial PostgreSQL schema for log records aligned with docs/contracts/data-contract-v1.md
CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    timestamp_ms BIGINT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    source TEXT NOT NULL,
    hash TEXT NOT NULL,
    ipfs_cid TEXT,
    blockchain_tx_id TEXT,
    verification_status TEXT NOT NULL DEFAULT 'pending',
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logs_device_id ON logs(device_id);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_verification_status ON logs(verification_status);
CREATE INDEX IF NOT EXISTS idx_logs_hash ON logs(hash);
