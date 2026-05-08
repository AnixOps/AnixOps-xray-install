import { sql } from "drizzle-orm";
import { db } from "./db/index.js";
import { buildBillingTickIdempotencyKey, calculateBillingChargeAmount } from "./lib/billing-ticks.js";

export { buildBillingTickIdempotencyKey, calculateBillingChargeAmount };

let ensureBillingTickSchemaPromise: Promise<void> | null = null;

export async function ensureBillingTickSchema() {
  if (!ensureBillingTickSchemaPromise) {
    ensureBillingTickSchemaPromise = (async () => {
      await db.execute(sql`
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
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_billing_ticks_rental_period ON billing_ticks(rental_id, period_start, period_end)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_billing_ticks_user ON billing_ticks(user_id)`);
    })();
  }

  return ensureBillingTickSchemaPromise;
}
