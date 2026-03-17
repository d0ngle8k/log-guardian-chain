-- Collector lane metadata + idempotency support
ALTER TABLE logs ADD COLUMN IF NOT EXISTS agent_id TEXT;
ALTER TABLE logs ADD COLUMN IF NOT EXISTS source_type TEXT;
ALTER TABLE logs ADD COLUMN IF NOT EXISTS seq_no BIGINT;
ALTER TABLE logs ADD COLUMN IF NOT EXISTS batch_id TEXT;
ALTER TABLE logs ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE INDEX IF NOT EXISTS idx_logs_agent_id ON logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_logs_source_type ON logs(source_type);
CREATE INDEX IF NOT EXISTS idx_logs_batch_id ON logs(batch_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_logs_idempotency_key_unique
    ON logs(idempotency_key)
    WHERE idempotency_key IS NOT NULL;
