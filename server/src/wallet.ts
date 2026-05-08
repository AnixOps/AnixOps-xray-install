export type WalletUser = {
  id: string;
  balance?: number | string | null;
};

export type LegacyWalletPayment = {
  id: string;
  rentalId?: string | null;
  amount: number | string;
  currency?: string | null;
  method: string;
  status?: string | null;
  createdAt?: Date | string | null;
};

export type WalletLedgerRow = {
  id: string;
  type: string;
  amount: number | string;
  currency?: string | null;
  rentalId?: string | null;
  topupId?: string | null;
  balanceAfter: number | string;
  idempotencyKey?: string | null;
  createdAt?: Date | string | null;
};

function toMoney(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function toIso(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function buildWalletSummary(user: WalletUser) {
  return buildWalletSummaryFromBalance({
    userId: user.id,
    balance: user.balance,
    source: "legacy-user-balance",
  });
}

export function buildWalletSummaryFromBalance(input: {
  userId: string;
  balance?: number | string | null;
  source: string;
  currency?: string | null;
}) {
  const balance = toMoney(input.balance);
  const reserved = 0;

  return {
    userId: input.userId,
    balance,
    currency: input.currency || "usd",
    reserved,
    available: Math.max(0, toMoney(balance - reserved)),
    source: input.source,
  };
}

export function buildLegacyWalletLedgerEntry(payment: LegacyWalletPayment) {
  return {
    id: payment.id,
    type: payment.method === "redeem_code" ? "legacy_redeem_rental_grant" : "legacy_payment",
    amount: toMoney(payment.amount),
    currency: payment.currency || "usd",
    status: payment.status || "completed",
    rentalId: payment.rentalId || null,
    source: "payments",
    createdAt: toIso(payment.createdAt),
  };
}

export function buildLegacyWalletLedger(payments: LegacyWalletPayment[]) {
  return {
    entries: payments.map(buildLegacyWalletLedgerEntry),
    source: "legacy-payments",
    nextCursor: null,
  };
}

export function buildWalletLedgerEntry(entry: WalletLedgerRow) {
  return {
    id: entry.id,
    type: entry.type,
    amount: toMoney(entry.amount),
    currency: entry.currency || "usd",
    status: "completed",
    rentalId: entry.rentalId || null,
    topupId: entry.topupId || null,
    balanceAfter: toMoney(entry.balanceAfter),
    idempotencyKey: entry.idempotencyKey || null,
    source: "wallet_ledger",
    createdAt: toIso(entry.createdAt),
  };
}

export function buildWalletLedger(entries: WalletLedgerRow[]) {
  return {
    entries: entries.map(buildWalletLedgerEntry),
    source: "wallet-ledger",
    nextCursor: null,
  };
}

export function normalizeTopupAmount(value: unknown) {
  const amount = toMoney(typeof value === "number" || typeof value === "string" ? value : 0);
  return amount > 0 ? amount : null;
}
