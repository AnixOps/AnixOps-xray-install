import { eq, sql } from "drizzle-orm";
import { auditLog, db, provisionAttempts } from "./db/index.js";
import {
  buildProvisionAttemptId,
  getProvisionAttemptNo,
  getProvisionMaxAttempts,
  calculateProvisionAttemptCloudCost,
  summarizeProvisionAttemptStageLogs,
} from "./lib/provision-attempts.js";

export {
  buildProvisionAttemptId,
  calculateProvisionAttemptCloudCost,
  getProvisionAttemptNo,
  getProvisionMaxAttempts,
  summarizeProvisionAttemptStageLogs,
};

export type ProvisionAttemptStatus = "running" | "succeeded" | "failed" | "failed_destroyed" | "abandoned";

export type StartProvisionAttemptInput = {
  rentalId: string;
  attemptNo: number;
  maxAttempts: number;
  protocol?: string | null;
  provider?: string | null;
  region?: string | null;
  plan?: string | null;
};

export type FinishProvisionAttemptInput = {
  attemptId: string;
  rentalId: string;
  status: ProvisionAttemptStatus;
  failureReason?: string | null;
  vpsId?: string | null;
  ip?: string | null;
  probeRunId?: string | null;
  cloudCostAmount?: number | null;
  cloudCostCurrency?: string | null;
};

let ensureProvisionAttemptSchemaPromise: Promise<void> | null = null;

export async function ensureProvisionAttemptSchema() {
  if (!ensureProvisionAttemptSchemaPromise) {
    ensureProvisionAttemptSchemaPromise = (async () => {
      await db.execute(sql`
        ALTER TABLE rentals
        DROP CONSTRAINT IF EXISTS rentals_status_check
      `);
      await db.execute(sql`
        ALTER TABLE rentals
        ADD CONSTRAINT rentals_status_check
        CHECK (status IN (
          'pending_payment',
          'pending',
          'provisioning',
          'probing',
          'configuring',
          'active',
          'paused',
          'destroying',
          'destroyed',
          'expired',
          'failed',
          'released'
        ))
      `);
      await db.execute(sql`
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
        )
      `);
      await db.execute(sql`ALTER TABLE provision_attempts ADD COLUMN IF NOT EXISTS cloud_cost_amount REAL NOT NULL DEFAULT 0`);
      await db.execute(sql`ALTER TABLE provision_attempts ADD COLUMN IF NOT EXISTS cloud_cost_currency TEXT NOT NULL DEFAULT 'usd'`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_provision_attempts_rental_attempt ON provision_attempts(rental_id, attempt_no)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_provision_attempts_rental ON provision_attempts(rental_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_provision_attempts_status ON provision_attempts(status)`);
    })();
  }

  return ensureProvisionAttemptSchemaPromise;
}

export async function startProvisionAttempt(input: StartProvisionAttemptInput) {
  await ensureProvisionAttemptSchema();

  const attemptId = buildProvisionAttemptId(input.rentalId, input.attemptNo);
  await db.execute(sql`
    INSERT INTO provision_attempts (
      id,
      rental_id,
      attempt_no,
      max_attempts,
      protocol,
      provider,
      region,
      plan,
      cloud_cost_amount,
      cloud_cost_currency,
      status,
      started_at,
      completed_at,
      failure_reason,
      updated_at
    )
    VALUES (
      ${attemptId},
      ${input.rentalId},
      ${input.attemptNo},
      ${input.maxAttempts},
      ${input.protocol || null},
      ${input.provider || null},
      ${input.region || null},
      ${input.plan || null},
      0,
      'usd',
      'running',
      CURRENT_TIMESTAMP,
      NULL,
      NULL,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (id) DO UPDATE SET
      max_attempts = EXCLUDED.max_attempts,
      protocol = EXCLUDED.protocol,
      provider = EXCLUDED.provider,
      region = EXCLUDED.region,
      plan = EXCLUDED.plan,
      cloud_cost_amount = 0,
      cloud_cost_currency = 'usd',
      status = 'running',
      completed_at = NULL,
      failure_reason = NULL,
      updated_at = CURRENT_TIMESTAMP
  `);
  await insertProvisionAttemptAudit(input.rentalId, "provision_attempt_started", {
    attemptId,
    attemptNo: input.attemptNo,
    maxAttempts: input.maxAttempts,
    protocol: input.protocol || null,
    provider: input.provider || null,
    region: input.region || null,
    plan: input.plan || null,
    cloudCostAmount: 0,
    cloudCostCurrency: "usd",
  });

  return { attemptId, attemptNo: input.attemptNo, maxAttempts: input.maxAttempts };
}

export async function finishProvisionAttempt(input: FinishProvisionAttemptInput) {
  await ensureProvisionAttemptSchema();

  await db.update(provisionAttempts)
    .set({
      status: input.status,
      failureReason: input.failureReason || null,
      vpsId: input.vpsId || null,
      ip: input.ip || null,
      probeRunId: input.probeRunId || null,
      cloudCostAmount: input.cloudCostAmount || 0,
      cloudCostCurrency: input.cloudCostCurrency || "usd",
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(provisionAttempts.id, input.attemptId));

  await insertProvisionAttemptAudit(input.rentalId, `provision_attempt_${input.status}`, {
    attemptId: input.attemptId,
    status: input.status,
    vpsId: input.vpsId || null,
    ip: input.ip || null,
    probeRunId: input.probeRunId || null,
    failureReason: input.failureReason || null,
    cloudCostAmount: input.cloudCostAmount || 0,
    cloudCostCurrency: input.cloudCostCurrency || "usd",
  });
}

function truncate(value: string, max = 500) {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

async function insertProvisionAttemptAudit(rentalId: string, action: string, detail: Record<string, unknown>) {
  await db.insert(auditLog).values({
    rentalId,
    action,
    detail: truncate(JSON.stringify(detail)),
  });
}
