import { createHash, randomUUID } from "crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, inviteBindings, inviteCodes, referralRewards, users } from "./db/index.js";
import { createWalletLedgerEntry } from "./wallet-ledger.js";

const REFERRAL_REWARD_RATE = 0.1;
const REFERRAL_REWARD_MAX = 25;

let ensureReferralSchemaPromise: Promise<void> | null = null;

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

export function normalizeInviteCode(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9-]{6,32}$/.test(normalized) ? normalized : null;
}

export function buildInviteCode(userId: string, seed = randomUUID()) {
  const digest = createHash("sha256")
    .update(`${userId}:${seed}`)
    .digest("hex")
    .slice(0, 10)
    .toUpperCase();
  return `ANX-${digest}`;
}

export function calculateReferralRewardAmount(triggerAmount: number | string | null | undefined) {
  const amount = toMoney(triggerAmount);
  if (amount <= 0) {
    return 0;
  }
  return Math.min(REFERRAL_REWARD_MAX, toMoney(amount * REFERRAL_REWARD_RATE));
}

export function buildReferralRewardIdempotencyKey(input: {
  inviterId: string;
  triggerType: string;
  triggerId: string;
}) {
  return `referral:${input.inviterId}:${input.triggerType}:${input.triggerId}`;
}

export async function ensureReferralSchema() {
  if (!ensureReferralSchemaPromise) {
    ensureReferralSchemaPromise = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS invite_codes (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          code TEXT UNIQUE NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_invite_codes_user ON invite_codes(user_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code)`);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS invite_bindings (
          id TEXT PRIMARY KEY,
          inviter_id TEXT NOT NULL,
          invitee_id TEXT NOT NULL,
          invite_code_id TEXT NOT NULL,
          bound_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_invite_bindings_invitee ON invite_bindings(invitee_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_invite_bindings_inviter ON invite_bindings(inviter_id)`);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS referral_rewards (
          id TEXT PRIMARY KEY,
          inviter_id TEXT NOT NULL,
          invitee_id TEXT NOT NULL,
          trigger_type TEXT NOT NULL,
          trigger_id TEXT NOT NULL,
          amount REAL NOT NULL,
          currency TEXT DEFAULT 'usd',
          status TEXT NOT NULL DEFAULT 'credited',
          ledger_id TEXT,
          idempotency_key TEXT NOT NULL UNIQUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          credited_at TIMESTAMP WITH TIME ZONE
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_referral_rewards_inviter ON referral_rewards(inviter_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_referral_rewards_invitee ON referral_rewards(invitee_id)`);
    })();
  }

  return ensureReferralSchemaPromise;
}

export async function getOrCreateInviteCode(userId: string) {
  await ensureReferralSchema();
  const existing = await db.select()
    .from(inviteCodes)
    .where(and(eq(inviteCodes.userId, userId), eq(inviteCodes.status, "active")))
    .orderBy(desc(inviteCodes.createdAt))
    .limit(1);
  if (existing.length > 0) {
    return existing[0];
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = buildInviteCode(userId);
    try {
      const inserted = await db.insert(inviteCodes)
        .values({ id: randomUUID(), userId, code, status: "active" })
        .returning();
      return inserted[0];
    } catch (error) {
      if (attempt === 4) {
        throw error;
      }
    }
  }

  throw new Error("Failed to create invite code");
}

export async function bindInviteCode(input: { inviteeId: string; code: string }) {
  await ensureReferralSchema();
  const code = normalizeInviteCode(input.code);
  if (!code) {
    return { ok: false as const, status: 400, error: "Invalid invite code format" };
  }

  const invite = await db.select()
    .from(inviteCodes)
    .where(and(eq(inviteCodes.code, code), eq(inviteCodes.status, "active")))
    .limit(1);
  if (invite.length === 0) {
    return { ok: false as const, status: 404, error: "Invite code not found" };
  }
  if (invite[0].userId === input.inviteeId) {
    return { ok: false as const, status: 409, error: "Cannot bind your own invite code" };
  }

  const existing = await db.select()
    .from(inviteBindings)
    .where(eq(inviteBindings.inviteeId, input.inviteeId))
    .limit(1);
  if (existing.length > 0) {
    return { ok: true as const, alreadyBound: true, binding: existing[0] };
  }

  const inserted = await db.insert(inviteBindings)
    .values({
      id: randomUUID(),
      inviterId: invite[0].userId,
      inviteeId: input.inviteeId,
      inviteCodeId: invite[0].id,
    })
    .returning();

  return { ok: true as const, alreadyBound: false, binding: inserted[0] };
}

export async function rewardReferralForTrigger(input: {
  inviteeId: string;
  triggerType: "wallet_topup" | "crypto_topup" | "wallet_rental";
  triggerId: string;
  triggerAmount: number;
  currency?: string | null;
}) {
  await ensureReferralSchema();
  const rewardAmount = calculateReferralRewardAmount(input.triggerAmount);
  if (rewardAmount <= 0) {
    return { rewarded: false, reason: "zero_reward" };
  }

  const binding = await db.select()
    .from(inviteBindings)
    .where(eq(inviteBindings.inviteeId, input.inviteeId))
    .limit(1);
  if (binding.length === 0) {
    return { rewarded: false, reason: "no_binding" };
  }

  const idempotencyKey = buildReferralRewardIdempotencyKey({
    inviterId: binding[0].inviterId,
    triggerType: input.triggerType,
    triggerId: input.triggerId,
  });
  const existing = await db.select()
    .from(referralRewards)
    .where(eq(referralRewards.idempotencyKey, idempotencyKey))
    .limit(1);
  if (existing.length > 0) {
    return { rewarded: true, alreadyProcessed: true, reward: existing[0] };
  }

  const inviter = await db.select({ isFrozen: users.isFrozen })
    .from(users)
    .where(eq(users.id, binding[0].inviterId))
    .limit(1);
  const currency = (input.currency || "usd").toLowerCase();

  if (inviter[0]?.isFrozen) {
    const held = await db.insert(referralRewards)
      .values({
        id: randomUUID(),
        inviterId: binding[0].inviterId,
        inviteeId: input.inviteeId,
        triggerType: input.triggerType,
        triggerId: input.triggerId,
        amount: rewardAmount,
        currency,
        status: "held",
        idempotencyKey,
      })
      .returning();
    return { rewarded: true, held: true, reward: held[0] };
  }

  const ledger = await createWalletLedgerEntry({
    userId: binding[0].inviterId,
    type: "referral_reward",
    amount: rewardAmount,
    currency,
    idempotencyKey,
  });
  const credited = await db.insert(referralRewards)
    .values({
      id: randomUUID(),
      inviterId: binding[0].inviterId,
      inviteeId: input.inviteeId,
      triggerType: input.triggerType,
      triggerId: input.triggerId,
      amount: rewardAmount,
      currency,
      status: "credited",
      ledgerId: ledger.ledger?.id || null,
      idempotencyKey,
      creditedAt: new Date(),
    })
    .returning();

  return { rewarded: true, alreadyProcessed: ledger.alreadyProcessed, reward: credited[0] };
}

export async function releaseHeldReferralRewards(inviterId: string) {
  await ensureReferralSchema();
  const heldRewards = await db.select()
    .from(referralRewards)
    .where(and(eq(referralRewards.inviterId, inviterId), eq(referralRewards.status, "held")))
    .orderBy(desc(referralRewards.createdAt))
    .limit(100);

  const released = [];
  for (const reward of heldRewards) {
    const ledger = await createWalletLedgerEntry({
      userId: inviterId,
      type: "referral_reward",
      amount: toMoney(reward.amount),
      currency: reward.currency || "usd",
      idempotencyKey: reward.idempotencyKey,
    });
    const updated = await db.update(referralRewards)
      .set({
        status: "credited",
        ledgerId: ledger.ledger?.id || reward.ledgerId || null,
        creditedAt: new Date(),
      })
      .where(eq(referralRewards.id, reward.id))
      .returning();
    released.push(updated[0]);
  }

  return released;
}

export async function getReferralConsoleData(userId: string) {
  const invite = await getOrCreateInviteCode(userId);
  const [bindingRows, rewardRows, inviteSummaryRows, rewardSummaryRows] = await Promise.all([
    db.select().from(inviteBindings).where(eq(inviteBindings.inviteeId, userId)).limit(1),
    db.select().from(referralRewards)
      .where(eq(referralRewards.inviterId, userId))
      .orderBy(desc(referralRewards.createdAt))
      .limit(25),
    db.select({
      invitedUsers: sql<number>`count(distinct ${inviteBindings.inviteeId})::int`,
    })
      .from(inviteBindings)
      .where(eq(inviteBindings.inviterId, userId)),
    db.select({
      rewardedAmount: sql<number>`coalesce(sum(case when ${referralRewards.status} = 'credited' then ${referralRewards.amount} else 0 end), 0)`,
      pendingAmount: sql<number>`coalesce(sum(case when ${referralRewards.status} = 'held' then ${referralRewards.amount} else 0 end), 0)`,
    })
      .from(referralRewards)
      .where(eq(referralRewards.inviterId, userId)),
  ]);

  return {
    inviteCode: invite.code,
    binding: bindingRows[0] ? {
      inviterId: bindingRows[0].inviterId,
      inviteCodeId: bindingRows[0].inviteCodeId,
      boundAt: toIso(bindingRows[0].boundAt),
    } : null,
    summary: {
      invitedUsers: Number(inviteSummaryRows[0]?.invitedUsers || 0),
      rewardedAmount: toMoney(rewardSummaryRows[0]?.rewardedAmount),
      pendingAmount: toMoney(rewardSummaryRows[0]?.pendingAmount),
      currency: "usd",
    },
    rewards: rewardRows.map((reward) => ({
      id: reward.id,
      type: reward.triggerType,
      amount: toMoney(reward.amount),
      currency: reward.currency || "usd",
      status: reward.status,
      createdAt: toIso(reward.createdAt),
      ledgerId: reward.ledgerId || null,
      inviteeId: reward.inviteeId,
    })),
    status: "active",
    message: "Referral rewards are credited to wallet ledger after invited topups.",
  };
}
