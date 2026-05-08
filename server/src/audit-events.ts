import { createHash, randomUUID } from "crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { auditAnchorBatches, auditEvents, db } from "./db/index.js";

let ensureAuditEventSchemaPromise: Promise<void> | null = null;

export type AppendAuditEventInput = {
  traceId: string;
  actorType?: string;
  actorUserId?: string | null;
  rentalId?: string | null;
  eventType: string;
  payload?: unknown;
  now?: Date;
};

type AuditEventHashInput = {
  id: string;
  traceId: string;
  actorType: string;
  actorUserId: string | null;
  rentalId: string | null;
  eventType: string;
  eventVersion: number;
  payload: string;
  previousHash: string;
  createdAt: Date | string;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (value == null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalize(value ?? {}));
}

function toIso(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export type AuditAnchorReceiptSummary = {
  blockNumber: number | null;
  status: number | null;
  gasUsed: string | null;
  from: string | null;
  to: string | null;
};

export function formatAuditAnchorReceipt(value: string | null | undefined): AuditAnchorReceiptSummary | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const receipt = parsed as Record<string, unknown>;
    const blockNumber = Number(receipt.blockNumber);
    const status = Number(receipt.status);
    const gasUsed = receipt.gasUsed == null ? null : String(receipt.gasUsed);
    const from = typeof receipt.from === "string" && receipt.from.trim() ? receipt.from.trim() : null;
    const to = typeof receipt.to === "string" && receipt.to.trim() ? receipt.to.trim() : null;

    return {
      blockNumber: Number.isFinite(blockNumber) ? Math.floor(blockNumber) : null,
      status: Number.isFinite(status) ? Math.floor(status) : null,
      gasUsed,
      from,
      to,
    };
  } catch {
    return null;
  }
}

export function computeAuditEventHash(input: AuditEventHashInput) {
  return sha256([
    input.id,
    input.traceId,
    input.actorType,
    input.actorUserId || "",
    input.rentalId || "",
    input.eventType,
    String(input.eventVersion),
    input.payload,
    input.previousHash,
    toIso(input.createdAt) || "",
  ].join("\n"));
}

export function buildMerkleRoot(hashes: string[]) {
  if (hashes.length === 0) {
    return null;
  }
  let level = hashes.map((hash) => hash.toLowerCase());
  while (level.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1] || left;
      next.push(sha256(`${left}${right}`));
    }
    level = next;
  }
  return level[0];
}

export async function ensureAuditEventSchema() {
  if (!ensureAuditEventSchemaPromise) {
    ensureAuditEventSchemaPromise = (async () => {
      await db.execute(sql`
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
        )
      `);
      await db.execute(sql`ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS anchor_batch_id TEXT`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_audit_events_trace ON audit_events(trace_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_audit_events_anchor ON audit_events(anchor_batch_id)`);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS audit_anchor_batches (
          id TEXT PRIMARY KEY,
          from_event_id TEXT NOT NULL,
          to_event_id TEXT NOT NULL,
          event_count INTEGER NOT NULL,
          merkle_root TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          chain TEXT,
          tx_hash TEXT,
          receipt TEXT,
          submission_started_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          anchored_at TIMESTAMP WITH TIME ZONE
        )
      `);
      await db.execute(sql`ALTER TABLE audit_anchor_batches ADD COLUMN IF NOT EXISTS submission_started_at TIMESTAMP WITH TIME ZONE`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_audit_anchor_batches_created ON audit_anchor_batches(created_at)`);
    })();
  }

  return ensureAuditEventSchemaPromise;
}

export async function appendAuditEvent(input: AppendAuditEventInput) {
  await ensureAuditEventSchema();
  const latest = await db.select({ eventHash: auditEvents.eventHash })
    .from(auditEvents)
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(1);

  const id = randomUUID();
  const createdAt = input.now || new Date();
  const payload = canonicalJson(input.payload);
  const previousHash = latest[0]?.eventHash || "GENESIS";
  const eventVersion = 1;
  const actorType = input.actorType || "system";
  const actorUserId = input.actorUserId || null;
  const rentalId = input.rentalId || null;
  const eventHash = computeAuditEventHash({
    id,
    traceId: input.traceId,
    actorType,
    actorUserId,
    rentalId,
    eventType: input.eventType,
    eventVersion,
    payload,
    previousHash,
    createdAt,
  });

  const inserted = await db.insert(auditEvents)
    .values({
      id,
      traceId: input.traceId,
      actorType,
      actorUserId,
      rentalId,
      eventType: input.eventType,
      eventVersion,
      payload,
      previousHash,
      eventHash,
      createdAt,
    })
    .returning();
  return inserted[0];
}

export async function listAuditEvents(limit = 50) {
  await ensureAuditEventSchema();
  return db.select()
    .from(auditEvents)
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(Math.max(1, Math.min(200, limit)));
}

export async function createAuditAnchorBatch(input: {
  limit?: number;
  chain?: string | null;
  txHash?: string | null;
  receipt?: unknown;
} = {}) {
  await ensureAuditEventSchema();
  const limit = Math.max(1, Math.min(10000, Number(input.limit || 1000)));
  const events = await db.select()
    .from(auditEvents)
    .where(isNull(auditEvents.anchorBatchId))
    .orderBy(asc(auditEvents.createdAt), asc(auditEvents.id))
    .limit(limit);

  if (events.length === 0) {
    return { ok: false as const, status: 409, error: "No unanchored audit events" };
  }

  const merkleRoot = buildMerkleRoot(events.map((event) => event.eventHash));
  if (!merkleRoot) {
    return { ok: false as const, status: 409, error: "No audit events selected" };
  }

  const id = randomUUID();
  const anchored = Boolean(input.chain && input.txHash);
  const inserted = await db.insert(auditAnchorBatches)
    .values({
      id,
      fromEventId: events[0].id,
      toEventId: events[events.length - 1].id,
      eventCount: events.length,
      merkleRoot,
      status: anchored ? "anchored" : "pending",
      chain: input.chain || null,
      txHash: input.txHash || null,
      receipt: input.receipt ? canonicalJson(input.receipt) : null,
      anchoredAt: anchored ? new Date() : null,
    })
    .returning();

  await db.update(auditEvents)
    .set({ anchorBatchId: id })
    .where(inArray(auditEvents.id, events.map((event) => event.id)));

  return { ok: true as const, batch: inserted[0] };
}

export async function finalizeAuditAnchorBatch(input: {
  batchId: string;
  chain: string;
  txHash: string;
  receipt?: unknown;
}) {
  await ensureAuditEventSchema();
  const updated = await db.update(auditAnchorBatches)
    .set({
      chain: input.chain,
      txHash: input.txHash,
      receipt: input.receipt ? canonicalJson(input.receipt) : null,
      status: "anchored",
      anchoredAt: new Date(),
    })
    .where(eq(auditAnchorBatches.id, input.batchId))
    .returning();

  if (updated.length === 0) {
    return { ok: false as const, status: 404, error: "Audit anchor batch not found" };
  }
  return { ok: true as const, batch: updated[0] };
}

export async function getPendingAuditAnchorBatch() {
  await ensureAuditEventSchema();
  const rows = await db.select()
    .from(auditAnchorBatches)
    .where(eq(auditAnchorBatches.status, "pending"))
    .orderBy(asc(auditAnchorBatches.createdAt), asc(auditAnchorBatches.id))
    .limit(1);

  if (rows.length === 0) {
    return { ok: false as const, status: 404, error: "No pending audit anchor batches" };
  }
  return { ok: true as const, batch: rows[0] };
}

export async function markAuditAnchorBatchSubmitting(batchId: string) {
  await ensureAuditEventSchema();
  const updated = await db.update(auditAnchorBatches)
    .set({
      submissionStartedAt: new Date(),
    })
    .where(and(
      eq(auditAnchorBatches.id, batchId),
      eq(auditAnchorBatches.status, "pending"),
    ))
    .returning();

  if (updated.length === 0) {
    return { ok: false as const, status: 404, error: "Audit anchor batch not found" };
  }
  return { ok: true as const, batch: updated[0] };
}

export async function markAuditAnchorBatchSubmitted(input: {
  batchId: string;
  chain: string;
  txHash: string;
}) {
  await ensureAuditEventSchema();
  const updated = await db.update(auditAnchorBatches)
    .set({
      chain: input.chain,
      txHash: input.txHash,
      submissionStartedAt: new Date(),
    })
    .where(and(
      eq(auditAnchorBatches.id, input.batchId),
      eq(auditAnchorBatches.status, "pending"),
    ))
    .returning();

  if (updated.length === 0) {
    return { ok: false as const, status: 404, error: "Audit anchor batch not found" };
  }
  return { ok: true as const, batch: updated[0] };
}

export async function verifyAuditAnchorBatch(batchId: string) {
  await ensureAuditEventSchema();
  const batchRows = await db.select()
    .from(auditAnchorBatches)
    .where(eq(auditAnchorBatches.id, batchId))
    .limit(1);
  if (batchRows.length === 0) {
    return { ok: false as const, status: 404, error: "Audit anchor batch not found" };
  }

  const events = await db.select()
    .from(auditEvents)
    .where(eq(auditEvents.anchorBatchId, batchId))
    .orderBy(asc(auditEvents.createdAt), asc(auditEvents.id));
  const recomputedRoot = buildMerkleRoot(events.map((event) => event.eventHash));
  const merkleOk = recomputedRoot === batchRows[0].merkleRoot;
  const hashesOk = events.every((event) => computeAuditEventHash({
    id: event.id,
    traceId: event.traceId,
    actorType: event.actorType,
    actorUserId: event.actorUserId || null,
    rentalId: event.rentalId || null,
    eventType: event.eventType,
    eventVersion: event.eventVersion || 1,
    payload: event.payload,
    previousHash: event.previousHash,
    createdAt: event.createdAt || new Date(0),
  }) === event.eventHash);

  return {
    ok: merkleOk && hashesOk && events.length === batchRows[0].eventCount,
    batchId,
    eventCount: events.length,
    expectedEventCount: batchRows[0].eventCount,
    merkleRoot: batchRows[0].merkleRoot,
    recomputedRoot,
    merkleOk,
    hashesOk,
    status: batchRows[0].status,
    chain: batchRows[0].chain || null,
    txHash: batchRows[0].txHash || null,
  };
}

export function formatAuditEvent(event: typeof auditEvents.$inferSelect) {
  return {
    id: event.id,
    traceId: event.traceId,
    actorType: event.actorType,
    actorUserId: event.actorUserId || null,
    rentalId: event.rentalId || null,
    eventType: event.eventType,
    eventVersion: event.eventVersion,
    eventHash: event.eventHash,
    previousHash: event.previousHash,
    anchorBatchId: event.anchorBatchId || null,
    payload: event.payload,
    createdAt: toIso(event.createdAt),
  };
}
