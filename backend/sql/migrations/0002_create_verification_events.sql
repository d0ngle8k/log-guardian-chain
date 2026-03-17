-- Audit trail for verification attempts and state transitions
CREATE TABLE IF NOT EXISTS verification_events (
    id BIGSERIAL PRIMARY KEY,
    log_id TEXT NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    detail TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_events_log_id ON verification_events(log_id);
CREATE INDEX IF NOT EXISTS idx_verification_events_created_at ON verification_events(created_at DESC);
