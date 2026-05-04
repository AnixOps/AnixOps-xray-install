-- D1 Database Schema for AnixOps
-- Run: npx wrangler d1 execute anixops --file sql/schema.sql

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    balance REAL DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rentals (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    protocol TEXT NOT NULL CHECK (protocol IN ('vless-reality', 'hysteria2')),
    status TEXT NOT NULL DEFAULT 'provisioning' CHECK (status IN ('provisioning', 'active', 'paused', 'expired', 'destroyed')),
    ip TEXT,
    vps_id TEXT,
    duration_hours INTEGER NOT NULL,
    price_per_hour REAL NOT NULL,
    total_price REAL NOT NULL,
    payment_method TEXT,
    payment_status TEXT DEFAULT 'paid' CHECK (payment_status IN ('pending', 'paid', 'refunded')),
    started_at DATETIME DEFAULT (datetime('now')),
    expires_at DATETIME,
    paused_at DATETIME,
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rentals_status ON rentals(status);
CREATE INDEX IF NOT EXISTS idx_rentals_user ON rentals(user_id);
CREATE INDEX IF NOT EXISTS idx_rentals_expires ON rentals(expires_at);

CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    rental_id TEXT REFERENCES rentals(id),
    user_id TEXT REFERENCES users(id),
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'usd',
    method TEXT NOT NULL CHECK (method IN ('stripe', 'free_trial', 'redeem_code')),
    stripe_session_id TEXT,
    status TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_rental ON payments(rental_id);

-- Redeem codes table for prepaid tokens
CREATE TABLE IF NOT EXISTS redeem_codes (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    duration_hours INTEGER NOT NULL,
    used_by TEXT REFERENCES users(id),
    used_at DATETIME,
    expires_at DATETIME,
    created_at DATETIME DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_redeem_codes_code ON redeem_codes(code);
CREATE INDEX IF NOT EXISTS idx_redeem_codes_used ON redeem_codes(used_by);

-- Auto-update updated_at on rentals
CREATE TRIGGER IF NOT EXISTS rentals_updated
AFTER UPDATE ON rentals
BEGIN
    UPDATE rentals SET updated_at = datetime('now') WHERE id = OLD.id;
END;

-- Auto-update updated_at on payments
CREATE TRIGGER IF NOT EXISTS payments_updated
AFTER UPDATE ON payments
BEGIN
    UPDATE payments SET updated_at = datetime('now') WHERE id = OLD.id;
END;

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rental_id TEXT,
    action TEXT NOT NULL,
    detail TEXT,
    created_at DATETIME DEFAULT (datetime('now'))
);
