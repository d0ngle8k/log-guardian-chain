CREATE TABLE IF NOT EXISTS wallet_roles (
    wallet_address TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('employee', 'manager', 'admin')),
    granted_by TEXT NOT NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_roles_role ON wallet_roles(role);
