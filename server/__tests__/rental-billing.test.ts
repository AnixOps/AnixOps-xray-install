import { describe, expect, it } from "vitest";
import { buildRentalBillingSummary } from "../src/rental-billing.js";

describe("rental billing compatibility helpers", () => {
  it("builds a legacy payment billing summary", () => {
    const summary = buildRentalBillingSummary({
      id: "rental-1",
      status: "active",
      durationHours: 6,
      pricePerHour: 0.5,
      totalPrice: 3,
      expiresAt: "2026-05-06T13:00:00.000Z",
    }, [
      {
        id: "payment-1",
        amount: 3,
        currency: "usd",
        method: "stripe",
        status: "completed",
        createdAt: "2026-05-06T11:00:00.000Z",
      },
    ], Date.parse("2026-05-06T12:30:00.000Z"));

    expect(summary).toEqual({
      rentalId: "rental-1",
      status: "active",
      billingMode: "legacy-payment",
      durationHours: 6,
      pricePerHour: 0.5,
      totalPrice: 3,
      currency: "usd",
      remainingMinutes: 30,
      expiresAt: "2026-05-06T13:00:00.000Z",
      payments: [{
        id: "payment-1",
        amount: 3,
        currency: "usd",
        method: "stripe",
        status: "completed",
        createdAt: "2026-05-06T11:00:00.000Z",
      }],
      ticks: [],
      source: "legacy-payments",
    });
  });

  it("uses USD and no ticks when a rental has no payment rows yet", () => {
    expect(buildRentalBillingSummary({
      id: "rental-2",
      status: "provisioning",
      durationHours: 1,
      pricePerHour: 0.5,
      totalPrice: 0.5,
    }, [])).toMatchObject({
      currency: "usd",
      payments: [],
      ticks: [],
      source: "legacy-payments",
    });
  });
});
