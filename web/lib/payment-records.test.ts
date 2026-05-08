import { describe, expect, it } from "vitest";
import {
  classifyPaymentMethod,
  formatPaymentMethodLabel,
  formatRedeemCodeTypeLabel,
  formatWalletLedgerTypeLabel,
  groupPaymentsByMethod,
} from "./payment-records";

describe("payment records helpers", () => {
  it("groups payment methods into wallet, redeem-code, x402, and legacy buckets", () => {
    const grouped = groupPaymentsByMethod([
      { method: "wallet", id: "1" },
      { method: "redeem_code", id: "2" },
      { method: "stripe", id: "3" },
      { method: "x402", id: "4" },
      { method: null, id: "5" },
    ]);

    expect(grouped.wallet.map((item) => item.id)).toEqual(["1"]);
    expect(grouped.redeem_code.map((item) => item.id)).toEqual(["2"]);
    expect(grouped.x402.map((item) => item.id)).toEqual(["4"]);
    expect(grouped.legacy.map((item) => item.id)).toEqual(["3", "5"]);
  });

  it("labels payment methods consistently", () => {
    expect(classifyPaymentMethod("wallet")).toBe("wallet");
    expect(classifyPaymentMethod("redeem_code")).toBe("redeem_code");
    expect(classifyPaymentMethod("stripe")).toBe("legacy");
    expect(classifyPaymentMethod("x402")).toBe("x402");
    expect(formatPaymentMethodLabel("wallet")).toBe("Wallet checkout");
    expect(formatPaymentMethodLabel("x402")).toBe("X402 direct payment");
    expect(formatPaymentMethodLabel(null)).toBe("Unknown");
    expect(formatRedeemCodeTypeLabel("duration", true)).toBe("单次兑换码");
    expect(formatWalletLedgerTypeLabel("redeem_code_credit", true)).toBe("余额直充型兑换码");
  });

  it("switches to CDK labels in formal release mode", () => {
    const previous = process.env.NEXT_PUBLIC_RELEASE_PROFILE;
    process.env.NEXT_PUBLIC_RELEASE_PROFILE = "formal";

    try {
      expect(formatPaymentMethodLabel("redeem_code", true)).toBe("CDK 单次型");
      expect(formatRedeemCodeTypeLabel("wallet", true)).toBe("CDK 余额直充型");
      expect(formatWalletLedgerTypeLabel("redeem_code_credit", true)).toBe("CDK 余额直充型");
    } finally {
      if (previous === undefined) {
        delete process.env.NEXT_PUBLIC_RELEASE_PROFILE;
      } else {
        process.env.NEXT_PUBLIC_RELEASE_PROFILE = previous;
      }
    }
  });
});
