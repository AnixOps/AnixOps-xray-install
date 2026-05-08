export type AdminFreezeInput = {
  frozen?: unknown;
  reason?: unknown;
  now?: Date;
};

export function normalizeAdminCreditAmount(value: unknown) {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  if (amount > 10_000) {
    return null;
  }
  return Math.round(amount * 100) / 100;
}

export function normalizeAdminReason(value: unknown, fallback = "admin adjustment") {
  if (typeof value !== "string") {
    return fallback;
  }
  const reason = value.trim();
  return reason ? reason.slice(0, 240) : fallback;
}

export function buildAdminCreditIdempotencyKey(userId: string, key: string) {
  return `admin-credit:${userId}:${key.trim()}`;
}

export function buildAdminRefundIdempotencyKey(rentalId: string, key: string) {
  return `admin-refund:${rentalId}:${key.trim()}`;
}

export function buildAdminFreezeUpdate(input: AdminFreezeInput) {
  const isFrozen = input.frozen !== false;
  const reason = normalizeAdminReason(input.reason, isFrozen ? "admin freeze" : "admin unfreeze");
  const now = input.now || new Date();

  return {
    isFrozen,
    frozenAt: isFrozen ? now : null,
    freezeReason: isFrozen ? reason : null,
    updatedAt: now,
    auditDetail: {
      frozen: isFrozen,
      reason,
    },
  };
}
