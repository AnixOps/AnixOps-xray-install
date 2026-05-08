import { sql } from "drizzle-orm";
import { db } from "./db/index.js";

let ensureAdminUserSchemaPromise: Promise<void> | null = null;

export async function ensureAdminUserSchema() {
  if (!ensureAdminUserSchemaPromise) {
    ensureAdminUserSchemaPromise = (async () => {
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_frozen BOOLEAN DEFAULT FALSE`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS frozen_at TIMESTAMP WITH TIME ZONE`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS freeze_reason TEXT`);
    })();
  }

  return ensureAdminUserSchemaPromise;
}
