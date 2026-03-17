-- Extend base logs schema for runtime ingestion/query fields used by backend API
ALTER TABLE logs ADD COLUMN IF NOT EXISTS format TEXT;
ALTER TABLE logs ADD COLUMN IF NOT EXISTS file_size BIGINT NOT NULL DEFAULT 0;
ALTER TABLE logs ADD COLUMN IF NOT EXISTS raw_content BYTEA;
ALTER TABLE logs ADD COLUMN IF NOT EXISTS pda_address TEXT;

CREATE INDEX IF NOT EXISTS idx_logs_timestamp_ms ON logs(timestamp_ms DESC);
CREATE INDEX IF NOT EXISTS idx_logs_device_timestamp ON logs(device_id, timestamp_ms DESC);
