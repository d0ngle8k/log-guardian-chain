CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  public_key TEXT,
  organization TEXT,
  created_at BIGINT NOT NULL,
  last_seen BIGINT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS log_entries (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  timestamp BIGINT NOT NULL,
  ipfs_cid TEXT,
  content_hash TEXT NOT NULL,
  format TEXT,
  file_size INTEGER NOT NULL,
  tx_signature TEXT,
  pda_address TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_log_entries_device_ts ON log_entries(device_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_log_entries_status_ts ON log_entries(verification_status, timestamp DESC);