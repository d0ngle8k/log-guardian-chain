-- Runtime reliability tables used by backend retry worker and audit endpoints.

CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'log_ingested', 'log_verified', 'log_tampered', 'log_reported',
        'retry_job_created', 'retry_job_completed', 'retry_job_failed'
    )),
    log_id TEXT REFERENCES logs(id) ON DELETE SET NULL,
    device_id TEXT,
    related_data JSONB,
    actor_wallet TEXT,
    actor_role TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_log_id ON audit_log(log_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_device_id ON audit_log(device_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_event_type ON audit_log(event_type);

CREATE TABLE IF NOT EXISTS retry_jobs (
    id BIGSERIAL PRIMARY KEY,
    log_id TEXT NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    reason TEXT NOT NULL CHECK (reason IN (
        'pinata_timeout', 'pinata_upload_failed', 'pinata_auth_error',
        'solana_unfunded', 'solana_network_error', 'solana_timeout',
        'ingest_validation_error', 'internal_error'
    )),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'abandoned')),
    last_attempted_at TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_retry_jobs_log_id ON retry_jobs(log_id);
CREATE INDEX IF NOT EXISTS idx_retry_jobs_status ON retry_jobs(status);
CREATE INDEX IF NOT EXISTS idx_retry_jobs_next_attempt ON retry_jobs(next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_retry_jobs_created_at ON retry_jobs(created_at DESC);
