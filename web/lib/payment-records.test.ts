import { describe, expect, it } from "vitest";
import { classifyPaymentMethod, formatPaymentMethodLabel, groupPaymentsByMethod } from "./payment-records";

describe("payment records helpers", () => {
  it("groups payment methods into wallet, redeem-code, and legacy buckets", () => {
    const grouped = groupPaymentsByMethod([
      { method: "wallet", id: "1" },
      { method: "redeem_code", id: "2" },
      { method: "stripe", id: "3" },
      { method: "x402", id: "4" },
      { method: null, id: "5" },
    ]);

    expect(grouped.wallet.map((item) => item.id)).toEqual(["1"]);
    expect(grouped.redeem_code.map((item) => item.id)).toEqual(["2"]);
    expect(grouped.legacy.map((item) => item.id)).toEqual(["3", "4", "5"]);
  });

  it("labels payment methods consistently", () => {
    expect(classifyPaymentMethod("wallet")).toBe("wallet");
    expect(classifyPaymentMethod("redeem_code")).toBe("redeem_code");
    expect(classifyPaymentMethod("stripe")).toBe("legacy");
    expect(formatPaymentMethodLabel("wallet")).toBe("Wallet checkout");
    expect(formatPaymentMethodLabel("x402")).toBe("X402 direct");
    expect(formatPaymentMethodLabel(null)).toBe("Unknown");
  });
});

