import { randomUUID } from "crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { complianceStats, db, rentals } from "./db/index.js";

let ensureComplianceStatsSchemaPromise: Promise<void> | null = null;

function toCount(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

export async function ensureComplianceStatsSchema() {
  if (!ensureComplianceStatsSchemaPromise) {
    ensureComplianceStatsSchemaPromise = (async () => {
      await db.execute(sql`
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
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_compliance_stats_profile ON compliance_stats(compliance_profile_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_compliance_stats_synced ON compliance_stats(last_synced_at)`);
    })();
  }

  return ensureComplianceStatsSchemaPromise;
}

export async function upsertComplianceStat(input: {
  rentalId: string;
  complianceProfileId?: string | null;
  policyVersion?: string | null;
  rejectPackets?: number | string | null;
  rejectBytes?: number | string | null;
  sourceIp?: string | null;
  detail?: string | null;
  lastSyncedAt?: Date;
}) {
  await ensureComplianceStatsSchema();
  const existing = await db.select()
    .from(complianceStats)
    .where(eq(complianceStats.rentalId, input.rentalId))
    .limit(1);

  const values = {
    complianceProfileId: input.complianceProfileId || null,
    policyVersion: input.policyVersion || null,
    rejectPackets: toCount(input.rejectPackets),
    rejectBytes: toCount(input.rejectBytes),
    sourceIp: input.sourceIp || null,
    detail: input.detail || null,
    lastSyncedAt: input.lastSyncedAt || new Date(),
    updatedAt: new Date(),
  };

  if (existing.length > 0) {
    const updated = await db.update(complianceStats)
      .set(values)
      .where(eq(complianceStats.id, existing[0].id))
      .returning();
    return updated[0];
  }

  const inserted = await db.insert(complianceStats)
    .values({
      id: randomUUID(),
      rentalId: input.rentalId,
      ...values,
    })
    .returning();
  return inserted[0];
}

export async function getComplianceStatByRentalId(rentalId: string) {
  await ensureComplianceStatsSchema();
  const rows = await db.select().from(complianceStats).where(eq(complianceStats.rentalId, rentalId)).limit(1);
  return rows[0] || null;
}

export async function listComplianceStatsForRentals(rentalIds: string[]) {
  await ensureComplianceStatsSchema();
  if (rentalIds.length === 0) {
    return [];
  }
  return db.select()
    .from(complianceStats)
    .where(inArray(complianceStats.rentalId, rentalIds))
    .orderBy(desc(complianceStats.lastSyncedAt), desc(complianceStats.updatedAt));
}

export async function listActiveRestrictedRentals(limit = 100) {
  return db.select({
    rentalId: rentals.id,
    ip: rentals.ip,
    complianceProfileId: rentals.complianceProfileId,
    policyVersion: rentals.compliancePolicyVersion,
  })
    .from(rentals)
    .where(and(
      eq(rentals.status, "active"),
      sql`${rentals.ip} IS NOT NULL`,
      sql`${rentals.complianceProfileId} IS NOT NULL`,
    ))
    .limit(Math.max(1, Math.min(1000, limit)));
}

export function formatComplianceStat(stat: typeof complianceStats.$inferSelect | null) {
  if (!stat) {
    return null;
  }
  return {
    rentalId: stat.rentalId,
    complianceProfileId: stat.complianceProfileId || null,
    policyVersion: stat.policyVersion || null,
    rejectPackets: toCount(stat.rejectPackets),
    rejectBytes: toCount(stat.rejectBytes),
    lastSyncedAt: stat.lastSyncedAt ? stat.lastSyncedAt.toISOString() : null,
    sourceIp: stat.sourceIp || null,
    detail: stat.detail || null,
  };
}
