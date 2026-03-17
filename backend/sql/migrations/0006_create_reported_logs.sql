CREATE TABLE IF NOT EXISTS reported_logs (
    id BIGSERIAL PRIMARY KEY,
    log_id TEXT NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
    report_flag TEXT NOT NULL CHECK (report_flag IN ('suspicious', 'fraud')),
    report_reason TEXT,
    reported_by_wallet TEXT NOT NULL,
    reported_by_role TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (log_id)
);

CREATE INDEX IF NOT EXISTS idx_reported_logs_created_at ON reported_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reported_logs_flag ON reported_logs(report_flag);
CREATE INDEX IF NOT EXISTS idx_reported_logs_reporter ON reported_logs(reported_by_wallet);
