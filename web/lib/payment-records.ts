import { isFormalRelease } from "./release-profile";

export type PaymentMethodGroup = "wallet" | "redeem_code" | "x402" | "legacy";

export type RedeemCodeType = "wallet" | "duration";

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

  if (method === "x402") {
    return "x402";
  }

  return "legacy";
}

export function groupPaymentsByMethod<T extends PaymentMethodRecord>(payments: T[]) {
  return payments.reduce<Record<PaymentMethodGroup, T[]>>(
    (groups, payment) => {
      groups[classifyPaymentMethod(payment.method)].push(payment);
      return groups;
    },
    { wallet: [], redeem_code: [], x402: [], legacy: [] },
  );
}

export function formatRedeemCodeTypeLabel(codeType: RedeemCodeType | null | undefined, isZh: boolean) {
  const formalRelease = isFormalRelease();

  switch (codeType) {
    case "wallet":
      return formalRelease
        ? (isZh ? "CDK 余额直充型" : "CDK balance topup")
        : (isZh ? "余额直充型兑换码" : "Balance topup code");
    case "duration":
      return formalRelease
        ? (isZh ? "CDK 单次型" : "CDK single-use")
        : (isZh ? "单次兑换码" : "Single-use code");
    default:
      return isZh ? "兑换码" : "Redeem code";
  }
}

export function formatWalletLedgerTypeLabel(type: string | null | undefined, isZh: boolean) {
  const formalRelease = isFormalRelease();

  switch (type) {
    case "billing_charge":
      return isZh ? "余额扣费" : "Wallet charge";
    case "admin_credit":
      return isZh ? "后台充值" : "Admin credit";
    case "admin_refund":
      return isZh ? "后台退款" : "Admin refund";
    case "referral_reward":
      return isZh ? "推荐奖励" : "Referral reward";
    case "crypto_topup":
      return formalRelease
        ? (isZh ? "历史链上充值" : "Historical crypto topup")
        : (isZh ? "链上充值" : "Crypto topup");
    case "redeem_code_credit":
      return formatRedeemCodeTypeLabel("wallet", isZh);
    case "legacy_payment":
      return formalRelease
        ? (isZh ? "历史直付" : "Legacy payment")
        : (isZh ? "历史直付" : "Legacy payment");
    case "legacy_redeem_rental_grant":
      return formatRedeemCodeTypeLabel("duration", isZh);
    case "topup":
      return formalRelease
        ? (isZh ? "历史充值" : "Legacy topup")
        : (isZh ? "充值" : "Topup");
    default:
      return type && type.trim() ? type : (isZh ? "未知来源" : "Unknown source");
  }
}

export function formatPaymentMethodLabel(method: string | null | undefined, isZh = false) {
  const formalRelease = isFormalRelease();

  switch (method) {
    case "wallet":
      return isZh ? "钱包支付" : "Wallet checkout";
    case "redeem_code":
      return formalRelease
        ? (isZh ? "CDK 单次型" : "CDK single-use")
        : (isZh ? "兑换码租用" : "Redeem-code rental");
    case "stripe":
      return formalRelease
        ? (isZh ? "历史 Stripe" : "Legacy Stripe")
        : (isZh ? "Stripe 直付" : "Stripe direct");
    case "x402":
      return formalRelease
        ? (isZh ? "历史 X402" : "Legacy X402")
        : (isZh ? "X402 直付" : "X402 direct payment");
    case "free_trial":
      return isZh ? "免费试用" : "Free trial";
    case "redeem_code_credit":
      return formatRedeemCodeTypeLabel("wallet", isZh);
    case "topup":
      return formalRelease
        ? (isZh ? "历史充值" : "Legacy topup")
        : (isZh ? "充值" : "Topup");
    case null:
    case undefined:
    case "":
      return isZh ? "未知" : "Unknown";
    default:
      return method;
  }
}
