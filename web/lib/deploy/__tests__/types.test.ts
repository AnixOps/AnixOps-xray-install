import { describe, it, expect } from "vitest";
import { PROVIDER_INFO, PROTOCOL_INFO, RENTAL_PLANS } from "../types";

describe("PROVIDER_INFO", () => {
  it("covers all three cloud providers", () => {
    expect(Object.keys(PROVIDER_INFO)).toEqual(
      expect.arrayContaining(["vultr", "digitalocean", "aws"])
    );
  });

  it("has i18n keys for all region names", () => {
    for (const [, info] of Object.entries(PROVIDER_INFO)) {
      for (const region of info.regions) {
        expect(region.nameKey).toBeDefined();
        expect(region.nameKey).toMatch(/^provider\.region\./);
      }
    }
  });

  it("has i18n keys for all plan prices", () => {
    for (const [, info] of Object.entries(PROVIDER_INFO)) {
      for (const plan of info.plans) {
        expect(plan.priceKey).toBeDefined();
        expect(plan.priceKey).toMatch(/^provider\.price\./);
        expect(plan.name).toBeDefined();
      }
    }
  });

  it("each provider has at least one region and one plan", () => {
    for (const [, info] of Object.entries(PROVIDER_INFO)) {
      expect(info.regions.length).toBeGreaterThan(0);
      expect(info.plans.length).toBeGreaterThan(0);
    }
  });
});

describe("PROTOCOL_INFO", () => {
  it("covers both protocols", () => {
    expect(Object.keys(PROTOCOL_INFO)).toEqual(
      expect.arrayContaining(["vless-reality", "hysteria2"])
    );
  });

  it("has i18n keys for name, description, and price", () => {
    for (const [, info] of Object.entries(PROTOCOL_INFO)) {
      expect(info.nameKey).toMatch(/^protocol\./);
      expect(info.descKey).toMatch(/^protocol\./);
      expect(info.priceKey).toMatch(/^protocol\./);
      expect(info.icon).toBeDefined();
    }
  });
});

describe("RENTAL_PLANS", () => {
  it("has four plans", () => {
    expect(RENTAL_PLANS.length).toBe(4);
  });

  it("plans have correct durations", () => {
    const durations = RENTAL_PLANS.map((p) => p.durationHours);
    expect(durations).toEqual([1, 6, 12, 24]);
  });

  it("total prices are calculated correctly", () => {
    for (const plan of RENTAL_PLANS) {
      const expected = plan.pricePerHour * plan.durationHours;
      expect(plan.totalPrice).toBeCloseTo(expected, 2);
    }
  });

  it("bulk discounts apply for 12h and 24h plans", () => {
    const p1h = RENTAL_PLANS.find((p) => p.durationHours === 1)!;
    const p12h = RENTAL_PLANS.find((p) => p.durationHours === 12)!;
    const p24h = RENTAL_PLANS.find((p) => p.durationHours === 24)!;

    expect(p12h.pricePerHour).toBeLessThan(p1h.pricePerHour);
    expect(p24h.pricePerHour).toBeLessThan(p12h.pricePerHour);
  });
});
