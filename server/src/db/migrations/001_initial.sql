-- Initial schema for AnixOps self-hosted
-- Run automatically by Docker postgres container

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    balance REAL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
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
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE,
    paused_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_rental ON payments(rental_id);

CREATE TABLE IF NOT EXISTS redeem_codes (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    duration_hours INTEGER NOT NULL,
    used_by TEXT REFERENCES users(id),
    used_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_redeem_codes_code ON redeem_codes(code);
CREATE INDEX IF NOT EXISTS idx_redeem_codes_used ON redeem_codes(used_by);

CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    rental_id TEXT,
    action TEXT NOT NULL,
    detail TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Auto-update updated_at function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for auto-updating updated_at
DROP TRIGGER IF EXISTS rentals_updated ON rentals;
CREATE TRIGGER rentals_updated
    BEFORE UPDATE ON rentals
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS payments_updated ON payments;
CREATE TRIGGER payments_updated
    BEFORE UPDATE ON payments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
