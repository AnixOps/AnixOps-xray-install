export function calculateBillingChargeAmount(pricePerHour: number | string | null | undefined, periodStart: Date, periodEnd: Date) {
  const hourly = Number(pricePerHour || 0);
  const durationMs = periodEnd.getTime() - periodStart.getTime();
  if (!Number.isFinite(hourly) || hourly <= 0 || durationMs <= 0) {
    return 0;
  }
  return Math.round((hourly * durationMs / 3_600_000) * 100) / 100;
}

export function buildBillingTickIdempotencyKey(rentalId: string, periodStart: Date, periodEnd: Date) {
  return `billing:${rentalId}:${periodStart.toISOString()}:${periodEnd.toISOString()}`;
}
