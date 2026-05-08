import { describe, expect, it } from "vitest";
import {
  buildAdminCreditIdempotencyKey,
  buildAdminFreezeUpdate,
  buildAdminRefundIdempotencyKey,
  normalizeAdminCreditAmount,
  normalizeAdminReason,
} from "../src/lib/admin-users.js";

describe("admin user helpers", () => {
  it("normalizes bounded manual credit amounts", () => {
    expect(normalizeAdminCreditAmount("12.345")).toBe(12.35);
    expect(normalizeAdminCreditAmount(0)).toBeNull();
    expect(normalizeAdminCreditAmount(-1)).toBeNull();
    expect(normalizeAdminCreditAmount(10000.01)).toBeNull();
  });

  it("builds scoped idempotency keys for admin credits", () => {
    expect(buildAdminCreditIdempotencyKey("user-1", " key-1 ")).toBe("admin-credit:user-1:key-1");
    expect(buildAdminRefundIdempotencyKey("rental-1", " key-2 ")).toBe("admin-refund:rental-1:key-2");
  });

  it("normalizes reasons with a fallback", () => {
    expect(normalizeAdminReason("  support comp  ")).toBe("support comp");
    expect(normalizeAdminReason("", "fallback")).toBe("fallback");
  });

  it("builds freeze and unfreeze updates", () => {
    const now = new Date("2026-05-06T12:00:00.000Z");

    expect(buildAdminFreezeUpdate({ reason: "risk", now })).toEqual({
      isFrozen: true,
      frozenAt: now,
      freezeReason: "risk",
      updatedAt: now,
      auditDetail: { frozen: true, reason: "risk" },
    });
    expect(buildAdminFreezeUpdate({ frozen: false, reason: "reviewed", now })).toEqual({
      isFrozen: false,
      frozenAt: null,
      freezeReason: null,
      updatedAt: now,
      auditDetail: { frozen: false, reason: "reviewed" },
    });
  });
});
