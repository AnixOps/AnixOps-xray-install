import { beforeAll, describe, expect, it } from "vitest";

let buildInviteCode: typeof import("../src/referrals.js").buildInviteCode;
let buildReferralRewardIdempotencyKey: typeof import("../src/referrals.js").buildReferralRewardIdempotencyKey;
let calculateReferralRewardAmount: typeof import("../src/referrals.js").calculateReferralRewardAmount;
let normalizeInviteCode: typeof import("../src/referrals.js").normalizeInviteCode;

beforeAll(async () => {
  process.env.DATABASE_URL ||= "postgresql://anixops:test@localhost:5432/anixops";
  process.env.REDIS_URL ||= "redis://localhost:6379";
  ({
    buildInviteCode,
    buildReferralRewardIdempotencyKey,
    calculateReferralRewardAmount,
    normalizeInviteCode,
  } = await import("../src/referrals.js"));
});

describe("referral helpers", () => {
  it("normalizes invite codes safely", () => {
    expect(normalizeInviteCode(" anx-abc123 ")).toBe("ANX-ABC123");
    expect(normalizeInviteCode("bad/code")).toBeNull();
  });

  it("builds stable invite-code and reward idempotency formats", () => {
    expect(buildInviteCode("user-1", "seed-1")).toMatch(/^ANX-[A-F0-9]{10}$/);
    expect(buildReferralRewardIdempotencyKey({
      inviterId: "u1",
      triggerType: "wallet_topup",
      triggerId: "t1",
    })).toBe("referral:u1:wallet_topup:t1");
  });

  it("calculates bounded ten-percent referral rewards", () => {
    expect(calculateReferralRewardAmount(12.345)).toBe(1.24);
    expect(calculateReferralRewardAmount(1000)).toBe(25);
    expect(calculateReferralRewardAmount(0)).toBe(0);
  });
});
