import { pgTable, text, integer, real, timestamp, serial, boolean } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").unique(),
  balance: real("balance").default(0),
  isFrozen: boolean("is_frozen").default(false),
  frozenAt: timestamp("frozen_at", { withTimezone: true }),
  freezeReason: text("freeze_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const rentals = pgTable("rentals", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id),
  protocol: text("protocol").notNull(), // 'vless-reality' | 'hysteria2'
  status: text("status").notNull().default("provisioning"), // target state machine: pending/provisioning/probing/configuring/active/destroying/failed/released
  provider: text("provider"),
  region: text("region"),
  plan: text("plan"),
  attemptCount: integer("attempt_count").default(0),
  lastStage: text("last_stage"),
  failedReason: text("failed_reason"),
  ip: text("ip"),
  vpsId: text("vps_id"),
  durationHours: integer("duration_hours").notNull(),
  pricePerHour: real("price_per_hour").notNull(),
  totalPrice: real("total_price").notNull(),
  paymentMethod: text("payment_method"),
  paymentStatus: text("payment_status").default("paid"), // 'pending' | 'paid' | 'refunded'
  complianceProfileId: text("compliance_profile_id"),
  compliancePolicyVersion: text("compliance_policy_version"),
  complianceEnforcedAt: timestamp("compliance_enforced_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  billingStartedAt: timestamp("billing_started_at", { withTimezone: true }),
  billingLastChargedAt: timestamp("billing_last_charged_at", { withTimezone: true }),
  destroyReason: text("destroy_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const payments = pgTable("payments", {
  id: text("id").primaryKey(),
  rentalId: text("rental_id").references(() => rentals.id),
  userId: text("user_id").references(() => users.id),
  amount: real("amount").notNull(),
  currency: text("currency").default("usd"),
  method: text("method").notNull(), // 'stripe' | 'wallet' | 'x402' | 'redeem_code'
  stripeSessionId: text("stripe_session_id"),
  status: text("status").default("completed"), // 'pending' | 'completed' | 'failed' | 'refunded'
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const topups = pgTable("topups", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  provider: text("provider").notNull(),
  amount: real("amount").notNull(),
  currency: text("currency").default("usd"),
  status: text("status").notNull().default("pending"),
  stripeSessionId: text("stripe_session_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const walletLedger = pgTable("wallet_ledger", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  type: text("type").notNull(),
  amount: real("amount").notNull(),
  currency: text("currency").default("usd"),
  rentalId: text("rental_id"),
  topupId: text("topup_id"),
  balanceAfter: real("balance_after").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const billingTicks = pgTable("billing_ticks", {
  id: text("id").primaryKey(),
  rentalId: text("rental_id").notNull(),
  userId: text("user_id").notNull(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  amount: real("amount").notNull(),
  status: text("status").notNull().default("charged"),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const redeemCodes = pgTable("redeem_codes", {
  id: text("id").primaryKey(),
  code: text("code").unique().notNull(),
  codeType: text("code_type").notNull().default("duration"),
  durationHours: integer("duration_hours").notNull(),
  walletAmount: real("wallet_amount"),
  usedBy: text("used_by").references(() => users.id),
  usedAt: timestamp("used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const inviteCodes = pgTable("invite_codes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  code: text("code").unique().notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const inviteBindings = pgTable("invite_bindings", {
  id: text("id").primaryKey(),
  inviterId: text("inviter_id").notNull(),
  inviteeId: text("invitee_id").notNull(),
  inviteCodeId: text("invite_code_id").notNull(),
  boundAt: timestamp("bound_at", { withTimezone: true }).defaultNow(),
});

export const referralRewards = pgTable("referral_rewards", {
  id: text("id").primaryKey(),
  inviterId: text("inviter_id").notNull(),
  inviteeId: text("invitee_id").notNull(),
  triggerType: text("trigger_type").notNull(),
  triggerId: text("trigger_id").notNull(),
  amount: real("amount").notNull(),
  currency: text("currency").default("usd"),
  status: text("status").notNull().default("credited"),
  ledgerId: text("ledger_id"),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  creditedAt: timestamp("credited_at", { withTimezone: true }),
});

export const cryptoTopups = pgTable("crypto_topups", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  asset: text("asset").notNull(),
  network: text("network").notNull(),
  rail: text("rail").notNull().default("wallet"),
  address: text("address").notNull(),
  expectedAmount: real("expected_amount").notNull(),
  receivedAmount: real("received_amount"),
  fiatAmount: real("fiat_amount").notNull(),
  currency: text("currency").default("usd"),
  status: text("status").notNull().default("pending"),
  txHash: text("tx_hash"),
  confirmations: integer("confirmations").default(0),
  ledgerId: text("ledger_id"),
  idempotencyKey: text("idempotency_key").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const complianceProfiles = pgTable("compliance_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  mode: text("mode").notNull().default("standard"),
  version: text("version").notNull(),
  description: text("description"),
  allowedPorts: text("allowed_ports"),
  allowedCidrs: text("allowed_cidrs"),
  blockedProtocols: text("blocked_protocols"),
  isDefault: boolean("is_default").default(false),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const complianceStats = pgTable("compliance_stats", {
  id: text("id").primaryKey(),
  rentalId: text("rental_id").notNull(),
  complianceProfileId: text("compliance_profile_id"),
  policyVersion: text("policy_version"),
  rejectPackets: integer("reject_packets").notNull().default(0),
  rejectBytes: integer("reject_bytes").notNull().default(0),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  sourceIp: text("source_ip"),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  rentalId: text("rental_id"),
  action: text("action").notNull(),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey(),
  traceId: text("trace_id").notNull(),
  actorType: text("actor_type").notNull().default("system"),
  actorUserId: text("actor_user_id"),
  rentalId: text("rental_id"),
  eventType: text("event_type").notNull(),
  eventVersion: integer("event_version").notNull().default(1),
  payload: text("payload").notNull(),
  previousHash: text("previous_hash").notNull(),
  eventHash: text("event_hash").notNull(),
  anchorBatchId: text("anchor_batch_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const auditAnchorBatches = pgTable("audit_anchor_batches", {
  id: text("id").primaryKey(),
  fromEventId: text("from_event_id").notNull(),
  toEventId: text("to_event_id").notNull(),
  eventCount: integer("event_count").notNull(),
  merkleRoot: text("merkle_root").notNull(),
  status: text("status").notNull().default("pending"),
  chain: text("chain"),
  txHash: text("tx_hash"),
  receipt: text("receipt"),
  submissionStartedAt: timestamp("submission_started_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  anchoredAt: timestamp("anchored_at", { withTimezone: true }),
});

export const provisionAttempts = pgTable("provision_attempts", {
  id: text("id").primaryKey(),
  rentalId: text("rental_id").notNull(),
  attemptNo: integer("attempt_no").notNull(),
  maxAttempts: integer("max_attempts").notNull(),
  protocol: text("protocol"),
  provider: text("provider"),
  region: text("region"),
  plan: text("plan"),
  cloudCostAmount: real("cloud_cost_amount").notNull().default(0),
  cloudCostCurrency: text("cloud_cost_currency").notNull().default("usd"),
  vpsId: text("vps_id"),
  ip: text("ip"),
  status: text("status").notNull().default("running"),
  failureReason: text("failure_reason"),
  probeRunId: text("probe_run_id"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const probeNodes = pgTable("probe_nodes", {
  id: text("id").primaryKey(),
  provider: text("provider"),
  region: text("region"),
  province: text("province"),
  city: text("city"),
  endpoint: text("endpoint"),
  status: text("status").notNull().default("active"),
  weight: real("weight").default(1),
  version: text("version"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const probeRuns = pgTable("probe_runs", {
  id: text("id").primaryKey(),
  rentalId: text("rental_id"),
  attemptId: text("attempt_id"),
  ip: text("ip").notNull(),
  port: integer("port").notNull(),
  protocol: text("protocol"),
  provider: text("provider"),
  providerRunId: text("provider_run_id"),
  status: text("status").notNull().default("running"),
  decision: text("decision"),
  passRatio: real("pass_ratio"),
  passThreshold: real("pass_threshold").default(0.7),
  completedNodes: integer("completed_nodes").default(0),
  requiredNodes: integer("required_nodes").default(3),
  detail: text("detail"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const probeResults = pgTable("probe_results", {
  id: text("id").primaryKey(),
  probeRunId: text("probe_run_id").notNull(),
  probeNodeId: text("probe_node_id").notNull(),
  ok: boolean("ok").notNull(),
  latencyMs: integer("latency_ms"),
  errorCode: text("error_code"),
  rawDetail: text("raw_detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// Types
export type User = typeof users.$inferSelect;
export type Rental = typeof rentals.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Topup = typeof topups.$inferSelect;
export type WalletLedger = typeof walletLedger.$inferSelect;
export type BillingTick = typeof billingTicks.$inferSelect;
export type RedeemCode = typeof redeemCodes.$inferSelect;
export type InviteCode = typeof inviteCodes.$inferSelect;
export type InviteBinding = typeof inviteBindings.$inferSelect;
export type ReferralReward = typeof referralRewards.$inferSelect;
export type CryptoTopup = typeof cryptoTopups.$inferSelect;
export type ComplianceProfile = typeof complianceProfiles.$inferSelect;
export type ComplianceStat = typeof complianceStats.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type AuditAnchorBatch = typeof auditAnchorBatches.$inferSelect;
export type ProvisionAttempt = typeof provisionAttempts.$inferSelect;
export type ProbeNode = typeof probeNodes.$inferSelect;
export type ProbeRun = typeof probeRuns.$inferSelect;
export type ProbeResult = typeof probeResults.$inferSelect;
