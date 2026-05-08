import { sql } from "drizzle-orm";
import { db } from "./db/index.js";

let ensureRentalPlacementSchemaPromise: Promise<void> | null = null;

export async function ensureRentalPlacementSchema() {
  if (!ensureRentalPlacementSchemaPromise) {
    ensureRentalPlacementSchemaPromise = (async () => {
      await db.execute(sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS provider TEXT`);
      await db.execute(sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS region TEXT`);
      await db.execute(sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS plan TEXT`);
      await db.execute(sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS attempt_count INTEGER DEFAULT 0`);
      await db.execute(sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS last_stage TEXT`);
      await db.execute(sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS failed_reason TEXT`);
      await db.execute(sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS billing_started_at TIMESTAMP WITH TIME ZONE`);
      await db.execute(sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS billing_last_charged_at TIMESTAMP WITH TIME ZONE`);
      await db.execute(sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS destroy_reason TEXT`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_rentals_provider_region_plan ON rentals(provider, region, plan)`);
    })();
  }

  return ensureRentalPlacementSchemaPromise;
}
