import { describe, expect, it } from "vitest";
import { getRentalPrice, isValidRentalDuration, PRICING, VALID_RENTAL_DURATIONS } from "../rules";

describe("rental rules", () => {
  it("accepts supported rental durations", () => {
    expect(VALID_RENTAL_DURATIONS).toEqual([1, 6, 12, 24]);
    for (const duration of VALID_RENTAL_DURATIONS) {
      expect(isValidRentalDuration(duration)).toBe(true);
    }
  });

  it("rejects unsupported durations", () => {
    expect(isValidRentalDuration(0)).toBe(false);
    expect(isValidRentalDuration(8)).toBe(false);
    expect(isValidRentalDuration("1")).toBe(false);
  });

  it("returns price tiers for valid durations", () => {
    expect(getRentalPrice(1)).toEqual(PRICING[1]);
    expect(getRentalPrice(24)).toEqual(PRICING[24]);
    expect(getRentalPrice(8)).toBeNull();
  });
});
