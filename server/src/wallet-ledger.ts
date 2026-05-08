import { randomUUID } from "crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, topups, users, walletLedger } from "./db/index.js";

let ensureWalletSchemaPromise: Promise<void> | null = null;

export type CreateWalletTopupInput = {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  provider: "stripe";
};

export type CompleteWalletTopupInput = {
  topupId: string;
  userId: string;
  stripeSessionId: string;
  amount: number;
  currency: string;
};

export type CreateWalletLedgerEntryInput = {
  userId: string;
  type: string;
  amount: number;
  currency: string;
  rentalId?: string | null;
  topupId?: string | null;
  idempotencyKey: string;
};

export async function ensureWalletSchema() {
  if (!ensureWalletSchemaPromise) {
    ensureWalletSchemaPromise = (async () => {
      await db.execute(sql`
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
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_topups_user ON topups(user_id)`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_topups_stripe_session ON topups(stripe_session_id) WHERE stripe_session_id IS NOT NULL`);
      await db.execute(sql`
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
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_wallet_ledger_user_created ON wallet_ledger(user_id, created_at DESC)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_wallet_ledger_topup ON wallet_ledger(topup_id)`);
    })();
  }

  return ensureWalletSchemaPromise;
}

export async function getLatestLedgerBalance(userId: string) {
  await ensureWalletSchema();
  const latest = await db.select({
    balanceAfter: walletLedger.balanceAfter,
    currency: walletLedger.currency,
  })
    .from(walletLedger)
    .where(eq(walletLedger.userId, userId))
    .orderBy(desc(walletLedger.createdAt))
    .limit(1);

  if (latest.length === 0) {
    return null;
  }

  return {
    balance: toMoney(latest[0].balanceAfter),
    currency: latest[0].currency || "usd",
  };
}

export async function listWalletLedgerEntries(userId: string, limit: number) {
  await ensureWalletSchema();
  return db.select({
    id: walletLedger.id,
    type: walletLedger.type,
    amount: walletLedger.amount,
    currency: walletLedger.currency,
    rentalId: walletLedger.rentalId,
    topupId: walletLedger.topupId,
    balanceAfter: walletLedger.balanceAfter,
    idempotencyKey: walletLedger.idempotencyKey,
    createdAt: walletLedger.createdAt,
  })
    .from(walletLedger)
    .where(eq(walletLedger.userId, userId))
    .orderBy(desc(walletLedger.createdAt))
    .limit(limit);
}

export async function createWalletTopup(input: CreateWalletTopupInput) {
  await ensureWalletSchema();
  await db.insert(topups).values({
    id: input.id,
    userId: input.userId,
    provider: input.provider,
    amount: input.amount,
    currency: input.currency,
    status: "pending",
  });
}

export async function attachStripeSessionToTopup(topupId: string, userId: string, stripeSessionId: string) {
  await ensureWalletSchema();
  await db.update(topups)
    .set({ stripeSessionId, updatedAt: new Date() })
    .where(and(eq(topups.id, topupId), eq(topups.userId, userId)));
}

export async function getWalletTopup(userId: string, topupId: string) {
  await ensureWalletSchema();
  const result = await db.select()
    .from(topups)
    .where(and(eq(topups.id, topupId), eq(topups.userId, userId)))
    .limit(1);
  return result[0] || null;
}

export async function completeWalletTopup(input: CompleteWalletTopupInput) {
  await ensureWalletSchema();
  const idempotencyKey = `stripe:${input.stripeSessionId}:topup`;
  const existingLedger = await db.select()
    .from(walletLedger)
    .where(eq(walletLedger.idempotencyKey, idempotencyKey))
    .limit(1);

  if (existingLedger.length > 0) {
    return { ledger: existingLedger[0], alreadyProcessed: true };
  }

  const topup = await db.select()
    .from(topups)
    .where(and(eq(topups.id, input.topupId), eq(topups.userId, input.userId)))
    .limit(1);
  if (topup.length === 0) {
    throw new Error("Topup not found");
  }

  const amount = toMoney(topup[0].amount || input.amount);
  const currency = (topup[0].currency || input.currency || "usd").toLowerCase();
  const baseBalance = await getBalanceSeed(input.userId);
  const balanceAfter = toMoney(baseBalance + amount);
  const ledgerId = randomUUID();

  await db.insert(walletLedger).values({
    id: ledgerId,
    userId: input.userId,
    type: "topup",
    amount,
    currency,
    topupId: input.topupId,
    balanceAfter,
    idempotencyKey,
  });

  await db.update(topups)
    .set({
      status: "completed",
      stripeSessionId: input.stripeSessionId,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(topups.id, input.topupId), eq(topups.userId, input.userId)));

  await db.update(users)
    .set({ balance: balanceAfter, updatedAt: new Date() })
    .where(eq(users.id, input.userId));

  const ledger = await db.select()
    .from(walletLedger)
    .where(eq(walletLedger.id, ledgerId))
    .limit(1);

  return { ledger: ledger[0], alreadyProcessed: false };
}

export async function createWalletLedgerEntry(input: CreateWalletLedgerEntryInput) {
  await ensureWalletSchema();
  const existingLedger = await db.select()
    .from(walletLedger)
    .where(eq(walletLedger.idempotencyKey, input.idempotencyKey))
    .limit(1);

  if (existingLedger.length > 0) {
    return { ledger: existingLedger[0], alreadyProcessed: true };
  }

  const amount = toMoney(input.amount);
  const baseBalance = await getBalanceSeed(input.userId);
  const balanceAfter = toMoney(baseBalance + amount);
  const ledgerId = randomUUID();
  await db.insert(walletLedger).values({
    id: ledgerId,
    userId: input.userId,
    type: input.type,
    amount,
    currency: input.currency,
    rentalId: input.rentalId || null,
    topupId: input.topupId || null,
    balanceAfter,
    idempotencyKey: input.idempotencyKey,
  });

  await db.update(users)
    .set({ balance: balanceAfter, updatedAt: new Date() })
    .where(eq(users.id, input.userId));

  const ledger = await db.select()
    .from(walletLedger)
    .where(eq(walletLedger.id, ledgerId))
    .limit(1);

  return { ledger: ledger[0], alreadyProcessed: false };
}

async function getBalanceSeed(userId: string) {
  const latest = await db.select({ balanceAfter: walletLedger.balanceAfter })
    .from(walletLedger)
    .where(eq(walletLedger.userId, userId))
    .orderBy(desc(walletLedger.createdAt))
    .limit(1);
  if (latest.length > 0) {
    return toMoney(latest[0].balanceAfter);
  }

  const user = await db.select({ balance: users.balance })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return toMoney(user[0]?.balance);
}

function toMoney(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}
