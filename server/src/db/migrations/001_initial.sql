-- Initial schema for AnixOps self-hosted
-- Run automatically by Docker postgres container

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    balance REAL DEFAULT 0,
    is_frozen BOOLEAN DEFAULT FALSE,
    frozen_at TIMESTAMP WITH TIME ZONE,
    freeze_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rentals (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    protocol TEXT NOT NULL CHECK (protocol IN ('vless-reality', 'hysteria2')),
    status TEXT NOT NULL DEFAULT 'provisioning' CHECK (status IN ('pending_payment', 'pending', 'provisioning', 'probing', 'configuring', 'active', 'paused', 'destroying', 'destroyed', 'expired', 'failed', 'released')),
    provider TEXT,
    region TEXT,
    plan TEXT,
    attempt_count INTEGER DEFAULT 0,
    last_stage TEXT,
    failed_reason TEXT,
    ip TEXT,
    vps_id TEXT,
    duration_hours INTEGER NOT NULL,
    price_per_hour REAL NOT NULL,
    total_price REAL NOT NULL,
    payment_method TEXT,
    payment_status TEXT DEFAULT 'paid' CHECK (payment_status IN ('pending', 'paid', 'refunded')),
    compliance_profile_id TEXT,
    compliance_policy_version TEXT,
    compliance_enforced_at TIMESTAMP WITH TIME ZONE,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE,
    paused_at TIMESTAMP WITH TIME ZONE,
    billing_started_at TIMESTAMP WITH TIME ZONE,
    billing_last_charged_at TIMESTAMP WITH TIME ZONE,
    destroy_reason TEXT,
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
    method TEXT NOT NULL CHECK (method IN ('stripe', 'free_trial', 'redeem_code', 'wallet', 'x402')),
    stripe_session_id TEXT,
    status TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_rental ON payments(rental_id);

CREATE TABLE IF NOT EXISTS topups (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('stripe')),
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'usd',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
    stripe_session_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_topups_user ON topups(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_topups_stripe_session ON topups(stripe_session_id) WHERE stripe_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS wallet_ledger (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'usd',
    rental_id TEXT,
    topup_id TEXT,
    balance_after REAL NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_user_created ON wallet_ledger(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_topup ON wallet_ledger(topup_id);

CREATE TABLE IF NOT EXISTS billing_ticks (
    id TEXT PRIMARY KEY,
    rental_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'charged' CHECK (status IN ('charged', 'skipped', 'failed')),
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_billing_ticks_rental_period ON billing_ticks(rental_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_billing_ticks_user ON billing_ticks(user_id);

CREATE TABLE IF NOT EXISTS redeem_codes (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    code_type TEXT NOT NULL DEFAULT 'duration' CHECK (code_type IN ('duration', 'wallet')),
    duration_hours INTEGER NOT NULL,
    wallet_amount REAL,
    used_by TEXT REFERENCES users(id),
    used_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_redeem_codes_code ON redeem_codes(code);
CREATE INDEX IF NOT EXISTS idx_redeem_codes_used ON redeem_codes(used_by);

CREATE TABLE IF NOT EXISTS invite_codes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invite_codes_user ON invite_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code);

CREATE TABLE IF NOT EXISTS invite_bindings (
    id TEXT PRIMARY KEY,
    inviter_id TEXT NOT NULL,
    invitee_id TEXT NOT NULL,
    invite_code_id TEXT NOT NULL,
    bound_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invite_bindings_invitee ON invite_bindings(invitee_id);
CREATE INDEX IF NOT EXISTS idx_invite_bindings_inviter ON invite_bindings(inviter_id);

CREATE TABLE IF NOT EXISTS referral_rewards (
    id TEXT PRIMARY KEY,
    inviter_id TEXT NOT NULL,
    invitee_id TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    trigger_id TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'usd',
    status TEXT NOT NULL DEFAULT 'credited' CHECK (status IN ('credited', 'held')),
    ledger_id TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    credited_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_referral_rewards_inviter ON referral_rewards(inviter_id);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_invitee ON referral_rewards(invitee_id);

CREATE TABLE IF NOT EXISTS crypto_topups (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    asset TEXT NOT NULL,
    network TEXT NOT NULL,
    rail TEXT NOT NULL DEFAULT 'wallet',
    address TEXT NOT NULL,
    expected_amount REAL NOT NULL,
    received_amount REAL,
    fiat_amount REAL NOT NULL,
    currency TEXT DEFAULT 'usd',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'expired', 'cancelled', 'short_paid')),
    tx_hash TEXT,
    confirmations INTEGER DEFAULT 0,
    ledger_id TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE crypto_topups ADD COLUMN IF NOT EXISTS rail TEXT NOT NULL DEFAULT 'wallet';

CREATE INDEX IF NOT EXISTS idx_crypto_topups_user ON crypto_topups(user_id);
CREATE INDEX IF NOT EXISTS idx_crypto_topups_status ON crypto_topups(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crypto_topups_tx_hash ON crypto_topups(network, tx_hash) WHERE tx_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS compliance_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'standard' CHECK (mode IN ('standard', 'restricted')),
    version TEXT NOT NULL,
    description TEXT,
    allowed_ports TEXT,
    allowed_cidrs TEXT,
    blocked_protocols TEXT,
    is_default BOOLEAN DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_compliance_profiles_default ON compliance_profiles(is_default);
CREATE INDEX IF NOT EXISTS idx_compliance_profiles_status ON compliance_profiles(status);

CREATE TABLE IF NOT EXISTS compliance_stats (
    id TEXT PRIMARY KEY,
    rental_id TEXT NOT NULL UNIQUE,
    compliance_profile_id TEXT,
    policy_version TEXT,
    reject_packets INTEGER NOT NULL DEFAULT 0,
    reject_bytes INTEGER NOT NULL DEFAULT 0,
    last_synced_at TIMESTAMP WITH TIME ZONE,
    source_ip TEXT,
    detail TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_compliance_stats_profile ON compliance_stats(compliance_profile_id);
CREATE INDEX IF NOT EXISTS idx_compliance_stats_synced ON compliance_stats(last_synced_at);

CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    rental_id TEXT,
    action TEXT NOT NULL,
    detail TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    actor_type TEXT NOT NULL DEFAULT 'system',
    actor_user_id TEXT,
    rental_id TEXT,
    event_type TEXT NOT NULL,
    event_version INTEGER NOT NULL DEFAULT 1,
    payload TEXT NOT NULL,
    previous_hash TEXT NOT NULL,
    event_hash TEXT NOT NULL,
    anchor_batch_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_trace ON audit_events(trace_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_anchor ON audit_events(anchor_batch_id);

CREATE TABLE IF NOT EXISTS audit_anchor_batches (
    id TEXT PRIMARY KEY,
    from_event_id TEXT NOT NULL,
    to_event_id TEXT NOT NULL,
    event_count INTEGER NOT NULL,
    merkle_root TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'anchored')),
    chain TEXT,
    tx_hash TEXT,
    receipt TEXT,
    submission_started_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    anchored_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_audit_anchor_batches_created ON audit_anchor_batches(created_at);

CREATE TABLE IF NOT EXISTS provision_attempts (
    id TEXT PRIMARY KEY,
    rental_id TEXT NOT NULL,
    attempt_no INTEGER NOT NULL,
    max_attempts INTEGER NOT NULL,
    protocol TEXT,
    provider TEXT,
    region TEXT,
    plan TEXT,
    cloud_cost_amount REAL NOT NULL DEFAULT 0,
    cloud_cost_currency TEXT NOT NULL DEFAULT 'usd',
    vps_id TEXT,
    ip TEXT,
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed', 'failed_destroyed', 'abandoned')),
    failure_reason TEXT,
    probe_run_id TEXT,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_provision_attempts_rental_attempt ON provision_attempts(rental_id, attempt_no);
CREATE INDEX IF NOT EXISTS idx_provision_attempts_rental ON provision_attempts(rental_id);
CREATE INDEX IF NOT EXISTS idx_provision_attempts_status ON provision_attempts(status);

CREATE TABLE IF NOT EXISTS probe_nodes (
    id TEXT PRIMARY KEY,
    provider TEXT,
    region TEXT,
    province TEXT,
    city TEXT,
    endpoint TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    weight REAL DEFAULT 1,
    version TEXT,
    last_seen_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_probe_nodes_status ON probe_nodes(status);
CREATE INDEX IF NOT EXISTS idx_probe_nodes_last_seen ON probe_nodes(last_seen_at);

CREATE TABLE IF NOT EXISTS probe_runs (
    id TEXT PRIMARY KEY,
    rental_id TEXT,
    attempt_id TEXT,
    ip TEXT NOT NULL,
    port INTEGER NOT NULL,
    protocol TEXT,
    provider TEXT,
    provider_run_id TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    decision TEXT,
    pass_ratio REAL,
    pass_threshold REAL DEFAULT 0.7,
    completed_nodes INTEGER DEFAULT 0,
    required_nodes INTEGER DEFAULT 3,
    detail TEXT,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_probe_runs_rental ON probe_runs(rental_id);
CREATE INDEX IF NOT EXISTS idx_probe_runs_status ON probe_runs(status);

CREATE TABLE IF NOT EXISTS probe_results (
    id TEXT PRIMARY KEY,
    probe_run_id TEXT NOT NULL,
    probe_node_id TEXT NOT NULL,
    ok BOOLEAN NOT NULL,
    latency_ms INTEGER,
    error_code TEXT,
    raw_detail TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_probe_results_run ON probe_results(probe_run_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_probe_results_run_node ON probe_results(probe_run_id, probe_node_id);

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

DROP TRIGGER IF EXISTS topups_updated ON topups;
CREATE TRIGGER topups_updated
    BEFORE UPDATE ON topups
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS crypto_topups_updated ON crypto_topups;
CREATE TRIGGER crypto_topups_updated
    BEFORE UPDATE ON crypto_topups
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS compliance_profiles_updated ON compliance_profiles;
CREATE TRIGGER compliance_profiles_updated
    BEFORE UPDATE ON compliance_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS compliance_stats_updated ON compliance_stats;
CREATE TRIGGER compliance_stats_updated
    BEFORE UPDATE ON compliance_stats
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS provision_attempts_updated ON provision_attempts;
CREATE TRIGGER provision_attempts_updated
    BEFORE UPDATE ON provision_attempts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS probe_nodes_updated ON probe_nodes;
CREATE TRIGGER probe_nodes_updated
    BEFORE UPDATE ON probe_nodes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS probe_runs_updated ON probe_runs;
CREATE TRIGGER probe_runs_updated
    BEFORE UPDATE ON probe_runs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS probe_results_updated ON probe_results;
CREATE TRIGGER probe_results_updated
    BEFORE UPDATE ON probe_results
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
