import { describe, expect, it } from "vitest";
import { buildCatalogPlans, buildCatalogRegions, getCatalogRuntimeConfig } from "../src/catalog.js";
import { buildRentalQuote, normalizeQuoteDuration } from "../src/pricing.js";

describe("catalog and rental quote helpers", () => {
  it("reads the configured provider, region, and plan", () => {
    expect(getCatalogRuntimeConfig({
      CLOUD_PROVIDER: "vultr",
      VPS_REGION: "nrt",
      VPS_PLAN: "vhf-1c-1gb",
    } as NodeJS.ProcessEnv)).toEqual({
      provider: "vultr",
      region: "nrt",
      plan: "vhf-1c-1gb",
    });
  });

  it("builds a current-region catalog from runtime config", () => {
    const regions = buildCatalogRegions({ provider: "vultr", region: "nrt", plan: "vhf-1c-1gb" });

    expect(regions).toEqual([expect.objectContaining({
      id: "nrt",
      provider: "vultr",
      label: "Tokyo",
      protocols: ["vless-reality", "hysteria2"],
      defaultPlan: "vhf-1c-1gb",
      status: "available",
      current: true,
    })]);
  });

  it("builds plan pricing durations from the canonical rental table", () => {
    const plans = buildCatalogPlans({ provider: "vultr", region: "nrt", plan: "vhf-1c-1gb" });

    expect(plans[0]?.durations).toEqual([
      { durationHours: 1, durationMinutes: 60, pricePerHour: 0.5, totalPrice: 0.5, currency: "usd" },
      { durationHours: 6, durationMinutes: 360, pricePerHour: 0.5, totalPrice: 3, currency: "usd" },
      { durationHours: 12, durationMinutes: 720, pricePerHour: 0.45, totalPrice: 5.4, currency: "usd" },
      { durationHours: 24, durationMinutes: 1440, pricePerHour: 0.4, totalPrice: 9.6, currency: "usd" },
    ]);
  });

  it("normalizes hour-based and minute-based quote durations", () => {
    expect(normalizeQuoteDuration({ durationHours: 6 })).toBe(6);
    expect(normalizeQuoteDuration({ durationMinutes: 360 })).toBe(6);
    expect(normalizeQuoteDuration({ durationMinutes: 90 })).toBeNull();
  });

  it("builds a stateless quote for a valid protocol and duration", () => {
    const quote = buildRentalQuote({
      protocol: "vless-reality",
      region: "nrt",
      durationMinutes: 360,
    }, {
      quoteId: "quote-1",
      provider: "vultr",
      defaultRegion: "nrt",
      defaultPlan: "vhf-1c-1gb",
      now: Date.parse("2026-05-06T11:00:00.000Z"),
    });

    expect(quote).toEqual({
      ok: true,
      quote: {
        quoteId: "quote-1",
        protocol: "vless-reality",
        provider: "vultr",
        region: "nrt",
        plan: "vhf-1c-1gb",
        durationHours: 6,
        durationMinutes: 360,
        pricePerHour: 0.5,
        totalPrice: 3,
        currency: "usd",
        balanceRequired: 3,
        expiresAt: "2026-05-06T11:15:00.000Z",
        mode: "legacy-stateless",
      },
    });
  });

  it("rejects invalid quote inputs", () => {
    const options = {
      quoteId: "quote-1",
      provider: "vultr",
      defaultRegion: "nrt",
      defaultPlan: "vhf-1c-1gb",
    };

    expect(buildRentalQuote({ protocol: "trojan", durationHours: 1 }, options)).toEqual({
      ok: false,
      status: 400,
      error: "Invalid protocol",
    });
    expect(buildRentalQuote({ protocol: "hysteria2", durationHours: 2 }, options)).toEqual({
      ok: false,
      status: 400,
      error: "Invalid duration",
    });
  });
});
