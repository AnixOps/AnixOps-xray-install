import { createHash, randomUUID } from "crypto";
import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { cryptoTopups, db } from "./db/index.js";
import { createWalletLedgerEntry } from "./wallet-ledger.js";

const DEFAULT_CRYPTO_ASSET = "USDT";
const DEFAULT_CRYPTO_NETWORK = "TRC20";
const DEFAULT_CRYPTO_RAIL = "wallet";
const TOPUP_TTL_MINUTES = 60;

let ensureCryptoTopupSchemaPromise: Promise<void> | null = null;

function toMoney(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function toCryptoAmount(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 1_000_000) / 1_000_000 : 0;
}

function buildUniqueExpectedAmountMicros(value: string) {
  const digest = createHash("sha256")
    .update(String(value || ""))
    .digest("hex")
    .slice(0, 8);
  const parsed = Number.parseInt(digest, 16);
  return Number.isFinite(parsed) ? (parsed % 999) + 1 : 1;
}

export function buildExpectedCryptoAmount(baseAmount: number, uniqueMicros = 0) {
  return toCryptoAmount(baseAmount + (uniqueMicros / 1_000_000));
}

function toIso(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function normalizeCryptoAsset(value: unknown) {
  const asset = typeof value === "string" && value.trim() ? value.trim().toUpperCase() : DEFAULT_CRYPTO_ASSET;
  return ["USDT", "USDC"].includes(asset) ? asset : null;
}

export function normalizeCryptoNetwork(value: unknown) {
  const network = typeof value === "string" && value.trim() ? value.trim().toUpperCase() : DEFAULT_CRYPTO_NETWORK;
  return ["TRC20", "ERC20", "POLYGON"].includes(network) ? network : null;
}

export function normalizeCryptoRail(value: unknown) {
  const rail = typeof value === "string" && value.trim() ? value.trim().toLowerCase() : DEFAULT_CRYPTO_RAIL;
  return ["wallet", "x402"].includes(rail) ? rail : null;
}

export function normalizeCryptoFiatAmount(value: unknown) {
  const amount = toMoney(typeof value === "number" || typeof value === "string" ? value : 0);
  return amount >= 1 && amount <= 10000 ? amount : null;
}

export function allocateCryptoDepositAddress(input: {
  userId: string;
  asset: string;
  network: string;
}) {
  const digest = createHash("sha256")
    .update(`${input.userId}:${input.asset}:${input.network}`)
    .digest("hex")
    .slice(0, 32);
  return `anixops_${input.network.toLowerCase()}_${digest}`;
}

export function buildCryptoTopupIdempotencyKey(input: { network: string; txHash: string }) {
  return `crypto:${input.network.toLowerCase()}:${input.txHash.trim().toLowerCase()}`;
}

export async function ensureCryptoTopupSchema() {
  if (!ensureCryptoTopupSchemaPromise) {
    ensureCryptoTopupSchemaPromise = (async () => {
      await db.execute(sql`
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
          status TEXT NOT NULL DEFAULT 'pending',
          tx_hash TEXT,
          confirmations INTEGER DEFAULT 0,
          ledger_id TEXT,
          idempotency_key TEXT NOT NULL UNIQUE,
          expires_at TIMESTAMP WITH TIME ZONE,
          completed_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.execute(sql`ALTER TABLE crypto_topups ADD COLUMN IF NOT EXISTS rail TEXT NOT NULL DEFAULT 'wallet'`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_crypto_topups_user ON crypto_topups(user_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_crypto_topups_status ON crypto_topups(status)`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_crypto_topups_tx_hash ON crypto_topups(network, tx_hash) WHERE tx_hash IS NOT NULL`);
    })();
  }

  return ensureCryptoTopupSchemaPromise;
}

export async function createCryptoTopup(input: {
  userId: string;
  fiatAmount: unknown;
  asset?: unknown;
  network?: unknown;
  rail?: unknown;
  receiverAddress?: string | null;
  uniqueExpectedAmount?: boolean;
  now?: Date;
}) {
  await ensureCryptoTopupSchema();
  const fiatAmount = normalizeCryptoFiatAmount(input.fiatAmount);
  if (!fiatAmount) {
    return { ok: false as const, status: 400, error: "Invalid topup amount" };
  }
  const asset = normalizeCryptoAsset(input.asset);
  const network = normalizeCryptoNetwork(input.network);
  const rail = normalizeCryptoRail(input.rail);
  if (!asset || !network || !rail) {
    return { ok: false as const, status: 400, error: "Unsupported crypto asset, network, or rail" };
  }

  const now = input.now || new Date();
  const expiresAt = new Date(now.getTime() + TOPUP_TTL_MINUTES * 60_000);
  const id = randomUUID();
  const expectedAmount = input.uniqueExpectedAmount
    ? buildExpectedCryptoAmount(fiatAmount, buildUniqueExpectedAmountMicros(id))
    : toCryptoAmount(fiatAmount);
  const inserted = await db.insert(cryptoTopups)
    .values({
      id,
      userId: input.userId,
      asset,
      network,
      rail,
      address: input.receiverAddress || allocateCryptoDepositAddress({ userId: input.userId, asset, network }),
      expectedAmount,
      fiatAmount,
      currency: "usd",
      status: "pending",
      idempotencyKey: `crypto-topup:${id}`,
      expiresAt,
    })
    .returning();

  return { ok: true as const, topup: formatCryptoTopup(inserted[0]) };
}

export async function listPendingCryptoTopups(input: {
  asset: string;
  network: string;
  address: string;
  limit?: number;
  now?: Date;
}) {
  await ensureCryptoTopupSchema();
  const now = input.now || new Date();
  const rows = await db.select()
    .from(cryptoTopups)
    .where(and(
      eq(cryptoTopups.status, "pending"),
      eq(cryptoTopups.asset, input.asset),
      eq(cryptoTopups.network, input.network),
      eq(cryptoTopups.address, input.address),
      or(isNull(cryptoTopups.expiresAt), gt(cryptoTopups.expiresAt, now)),
    ))
    .orderBy(asc(cryptoTopups.createdAt))
    .limit(Math.max(1, Math.min(1000, Number(input.limit || 100))));
  return rows.map((row) => formatCryptoTopup(row));
}

export async function listKnownCryptoTopupTxHashes(input: {
  network: string;
  txHashes: string[];
}) {
  await ensureCryptoTopupSchema();
  const txHashes = input.txHashes
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (txHashes.length === 0) {
    return [];
  }
  const rows = await db.select({ txHash: cryptoTopups.txHash })
    .from(cryptoTopups)
    .where(and(
      eq(cryptoTopups.network, input.network),
      inArray(cryptoTopups.txHash, txHashes),
    ));
  return rows
    .map((row) => String(row.txHash || "").trim())
    .filter(Boolean);
}

export async function getCryptoTopupForUser(userId: string, topupId: string) {
  await ensureCryptoTopupSchema();
  const rows = await db.select()
    .from(cryptoTopups)
    .where(and(eq(cryptoTopups.id, topupId), eq(cryptoTopups.userId, userId)))
    .limit(1);
  return rows[0] ? formatCryptoTopup(rows[0]) : null;
}

export async function completeCryptoTopup(input: {
  topupId: string;
  txHash: string;
  receivedAmount?: unknown;
  confirmations?: unknown;
}) {
  await ensureCryptoTopupSchema();
  const txHash = typeof input.txHash === "string" ? input.txHash.trim() : "";
  if (txHash.length < 8 || txHash.length > 160) {
    return { ok: false as const, status: 400, error: "Invalid transaction hash" };
  }

  const rows = await db.select()
    .from(cryptoTopups)
    .where(eq(cryptoTopups.id, input.topupId))
    .limit(1);
  if (rows.length === 0) {
    return { ok: false as const, status: 404, error: "Crypto topup not found" };
  }

  const topup = rows[0];
  if (topup.status === "completed") {
    return { ok: true as const, alreadyProcessed: true, topup: formatCryptoTopup(topup) };
  }
  if (topup.status !== "pending") {
    return { ok: false as const, status: 409, error: `Crypto topup is ${topup.status}` };
  }

  const receivedAmount = toCryptoAmount(
    typeof input.receivedAmount === "number" || typeof input.receivedAmount === "string"
      ? input.receivedAmount
      : topup.expectedAmount,
  );
  if (receivedAmount < toCryptoAmount(topup.expectedAmount)) {
    await db.update(cryptoTopups)
      .set({
        status: "short_paid",
        txHash,
        receivedAmount,
        confirmations: Number(input.confirmations || 0),
        updatedAt: new Date(),
      })
      .where(eq(cryptoTopups.id, topup.id));
    return { ok: false as const, status: 409, error: "Received amount is below expected amount" };
  }

  const idempotencyKey = buildCryptoTopupIdempotencyKey({ network: topup.network, txHash });
  const ledger = await createWalletLedgerEntry({
    userId: topup.userId,
    type: "crypto_topup",
    amount: toMoney(topup.fiatAmount),
    currency: topup.currency || "usd",
    topupId: topup.id,
    idempotencyKey,
  });

  const updated = await db.update(cryptoTopups)
    .set({
      status: "completed",
      txHash,
      receivedAmount,
      confirmations: Number(input.confirmations || 0),
      ledgerId: ledger.ledger?.id || null,
      idempotencyKey,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(cryptoTopups.id, topup.id))
    .returning();

  return {
    ok: true as const,
    alreadyProcessed: ledger.alreadyProcessed,
    topup: formatCryptoTopup(updated[0]),
  };
}

export function formatCryptoTopup(topup: typeof cryptoTopups.$inferSelect) {
  return {
    id: topup.id,
    userId: topup.userId,
    asset: topup.asset,
    network: topup.network,
    rail: topup.rail || DEFAULT_CRYPTO_RAIL,
    address: topup.address,
    expectedAmount: toCryptoAmount(topup.expectedAmount),
    receivedAmount: topup.receivedAmount == null ? null : toCryptoAmount(topup.receivedAmount),
    fiatAmount: toMoney(topup.fiatAmount),
    amount: toMoney(topup.fiatAmount),
    currency: topup.currency || "usd",
    status: topup.status,
    txHash: topup.txHash || null,
    confirmations: Number(topup.confirmations || 0),
    ledgerId: topup.ledgerId || null,
    createdAt: toIso(topup.createdAt),
    expiresAt: toIso(topup.expiresAt),
    completedAt: toIso(topup.completedAt),
  };
}
