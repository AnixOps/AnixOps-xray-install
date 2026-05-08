export const VALID_RENTAL_DURATIONS = [1, 6, 12, 24] as const;

export type RentalDurationHours = (typeof VALID_RENTAL_DURATIONS)[number];
export type RentalProtocol = "vless-reality" | "hysteria2";

export const PRICING: Record<RentalDurationHours, { pricePerHour: number; totalPrice: number }> = {
  1: { pricePerHour: 0.5, totalPrice: 0.5 },
  6: { pricePerHour: 0.5, totalPrice: 3.0 },
  12: { pricePerHour: 0.45, totalPrice: 5.4 },
  24: { pricePerHour: 0.4, totalPrice: 9.6 },
};

const VALID_PROTOCOLS = ["vless-reality", "hysteria2"] as const;

export function isValidRentalDuration(value: unknown): value is RentalDurationHours {
  return typeof value === "number" && VALID_RENTAL_DURATIONS.includes(value as RentalDurationHours);
}

export function isValidRentalProtocol(value: unknown): value is RentalProtocol {
  return typeof value === "string" && VALID_PROTOCOLS.includes(value as RentalProtocol);
}

export function getRentalPrice(durationHours: number) {
  return isValidRentalDuration(durationHours) ? PRICING[durationHours] : null;
}

export function normalizeQuoteDuration(body: { durationHours?: unknown; durationMinutes?: unknown }) {
  if (typeof body.durationHours === "number") {
    return body.durationHours;
  }

  if (typeof body.durationMinutes !== "number") {
    return null;
  }

  if (!Number.isInteger(body.durationMinutes) || body.durationMinutes % 60 !== 0) {
    return null;
  }

  return body.durationMinutes / 60;
}

export function buildRentalQuote(
  body: {
    protocol?: unknown;
    region?: unknown;
    durationHours?: unknown;
    durationMinutes?: unknown;
  },
  options: {
    quoteId: string;
    provider: string;
    defaultRegion: string;
    defaultPlan: string;
    now?: number;
  },
) {
  if (!isValidRentalProtocol(body.protocol)) {
    return { ok: false as const, status: 400, error: "Invalid protocol" };
  }

  const durationHours = normalizeQuoteDuration(body);
  if (!isValidRentalDuration(durationHours)) {
    return { ok: false as const, status: 400, error: "Invalid duration" };
  }

  const tier = getRentalPrice(durationHours);
  if (!tier) {
    return { ok: false as const, status: 400, error: "Invalid duration" };
  }

  const now = options.now ?? Date.now();
  const expiresAt = new Date(now + 15 * 60_000).toISOString();
  const region = typeof body.region === "string" && body.region.trim()
    ? body.region.trim()
    : options.defaultRegion;

  return {
    ok: true as const,
    quote: {
      quoteId: options.quoteId,
      protocol: body.protocol,
      provider: options.provider,
      region,
      plan: options.defaultPlan,
      durationHours,
      durationMinutes: durationHours * 60,
      pricePerHour: tier.pricePerHour,
      totalPrice: tier.totalPrice,
      currency: "usd",
      balanceRequired: tier.totalPrice,
      expiresAt,
      mode: "legacy-stateless",
    },
  };
}
