import { formatPaymentMethodLabel, formatRedeemCodeTypeLabel } from "@/lib/payment-records";
import { isFormalRelease } from "@/lib/release-profile";

export type PaymentBucket = "wallet" | "redeem_code" | "x402" | "legacy";

export function classifyAdminPaymentBucket(method: string | null | undefined): PaymentBucket {
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

export function formatAdminPaymentMethod(method: string | null | undefined, isZh = false) {
  return formatPaymentMethodLabel(method, isZh);
}

export function getPaymentStatusVariant(status: string): "default" | "secondary" | "destructive" {
  if (["completed", "paid"].includes(status)) {
    return "default";
  }
  if (["failed", "refunded"].includes(status)) {
    return "destructive";
  }
  return "secondary";
}

export function formatPaymentBucketLabel(bucket: PaymentBucket, isZh = false): string {
  switch (bucket) {
    case "wallet":
      return isZh ? "钱包支付" : "Wallet checkout";
    case "redeem_code":
      return formatRedeemCodeTypeLabel("duration", isZh);
    case "x402":
      return isFormalRelease()
        ? (isZh ? "历史 X402" : "Historical X402")
        : (isZh ? "X402 通道" : "X402 rail");
    case "legacy":
      return isFormalRelease()
        ? (isZh ? "历史直付" : "Historical direct")
        : (isZh ? "历史直付" : "Legacy direct");
  }
}

export function getPaymentBucketVariant(bucket: PaymentBucket): "default" | "secondary" | "outline" {
  switch (bucket) {
    case "wallet":
      return "default";
    case "redeem_code":
      return "secondary";
    case "x402":
      return "outline";
    case "legacy":
      return "outline";
  }
}
