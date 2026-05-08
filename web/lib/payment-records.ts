export type PaymentMethodGroup = "wallet" | "redeem_code" | "legacy";

export interface PaymentMethodRecord {
  method?: string | null | undefined;
}

export function classifyPaymentMethod(method: string | null | undefined): PaymentMethodGroup {
  if (method === "wallet") {
    return "wallet";
  }

  if (method === "redeem_code") {
    return "redeem_code";
  }

  return "legacy";
}

export function groupPaymentsByMethod<T extends PaymentMethodRecord>(payments: T[]) {
  return payments.reduce<Record<PaymentMethodGroup, T[]>>(
    (groups, payment) => {
      groups[classifyPaymentMethod(payment.method)].push(payment);
      return groups;
    },
    { wallet: [], redeem_code: [], legacy: [] },
  );
}

export function formatPaymentMethodLabel(method: string | null | undefined) {
  switch (method) {
    case "wallet":
      return "Wallet checkout";
    case "redeem_code":
      return "Redeem-code rental";
    case "stripe":
      return "Stripe direct";
    case "x402":
      return "X402 direct";
    case "free_trial":
      return "Free trial";
    case null:
    case undefined:
    case "":
      return "Unknown";
    default:
      return method;
  }
}
