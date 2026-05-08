export type RentalBillingRental = {
  id: string;
  status: string;
  durationHours: number;
  pricePerHour: number;
  totalPrice: number;
  expiresAt?: Date | string | null;
};

export type RentalBillingPayment = {
  id: string;
  amount: number | string;
  currency?: string | null;
  method: string;
  status?: string | null;
  createdAt?: Date | string | null;
};

function toMoney(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function toIso(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function getRemainingMinutes(expiresAt: Date | string | null | undefined, now: number) {
  if (!expiresAt) {
    return 0;
  }
  const time = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  if (!Number.isFinite(time)) {
    return 0;
  }
  return Math.max(0, Math.floor((time - now) / 60000));
}

export function buildRentalBillingSummary(
  rental: RentalBillingRental,
  payments: RentalBillingPayment[],
  now = Date.now(),
) {
  return {
    rentalId: rental.id,
    status: rental.status,
    billingMode: "legacy-payment",
    durationHours: rental.durationHours,
    pricePerHour: toMoney(rental.pricePerHour),
    totalPrice: toMoney(rental.totalPrice),
    currency: payments[0]?.currency || "usd",
    remainingMinutes: getRemainingMinutes(rental.expiresAt, now),
    expiresAt: toIso(rental.expiresAt),
    payments: payments.map((payment) => ({
      id: payment.id,
      amount: toMoney(payment.amount),
      currency: payment.currency || "usd",
      method: payment.method,
      status: payment.status || "completed",
      createdAt: toIso(payment.createdAt),
    })),
    ticks: [],
    source: "legacy-payments",
  };
}
