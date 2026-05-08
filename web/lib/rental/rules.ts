export const VALID_RENTAL_DURATIONS = [1, 6, 12, 24] as const;

export type RentalDuration = (typeof VALID_RENTAL_DURATIONS)[number];
export type RentalPaymentMethod = "stripe" | "wallet" | "x402" | "redeem_code";

export interface RentalPriceTier {
  pricePerHour: number;
  totalPrice: number;
}

export const PRICING: Record<RentalDuration, RentalPriceTier> = {
  1: { pricePerHour: 0.5, totalPrice: 0.5 },
  6: { pricePerHour: 0.5, totalPrice: 3.0 },
  12: { pricePerHour: 0.45, totalPrice: 5.4 },
  24: { pricePerHour: 0.4, totalPrice: 9.6 },
};

export function isValidRentalDuration(value: unknown): value is RentalDuration {
  return typeof value === "number" && VALID_RENTAL_DURATIONS.includes(value as RentalDuration);
}

export function getRentalPrice(durationHours: number): RentalPriceTier | null {
  return isValidRentalDuration(durationHours) ? PRICING[durationHours] : null;
}
