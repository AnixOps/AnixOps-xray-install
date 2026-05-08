import { describe, expect, it } from "vitest";
import { buildBillingTickIdempotencyKey, calculateBillingChargeAmount } from "../src/lib/billing-ticks.js";

describe("billing tick helpers", () => {
  it("calculates prorated hourly charges", () => {
    expect(calculateBillingChargeAmount(
      0.6,
      new Date("2026-05-06T10:00:00.000Z"),
      new Date("2026-05-06T10:30:00.000Z"),
    )).toBe(0.3);
  });

  it("returns zero for empty or invalid charge windows", () => {
    expect(calculateBillingChargeAmount(
      0.6,
      new Date("2026-05-06T10:00:00.000Z"),
      new Date("2026-05-06T10:00:00.000Z"),
    )).toBe(0);
    expect(calculateBillingChargeAmount(
      0,
      new Date("2026-05-06T10:00:00.000Z"),
      new Date("2026-05-06T10:30:00.000Z"),
    )).toBe(0);
  });

  it("builds stable idempotency keys from exact billing periods", () => {
    expect(buildBillingTickIdempotencyKey(
      "rental-1",
      new Date("2026-05-06T10:00:00.000Z"),
      new Date("2026-05-06T10:05:00.000Z"),
    )).toBe("billing:rental-1:2026-05-06T10:00:00.000Z:2026-05-06T10:05:00.000Z");
  });
});
