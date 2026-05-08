export function formatTopupRailLabel(rail: string | null | undefined, isZh: boolean) {
  switch (rail) {
    case "stripe":
      return isZh ? "Stripe" : "Stripe";
    case "wallet":
      return isZh ? "钱包支付" : "Wallet payment";
    case "x402":
      return isZh ? "X402 通道" : "X402 rail";
    default:
      return rail && rail.trim() ? rail : isZh ? "未知来源" : "Unknown source";
  }
}

export function formatTopupRailDescription(rail: string | null | undefined, isZh: boolean) {
  switch (rail) {
    case "stripe":
      return isZh ? "适合卡支付和法币入账。" : "Best for card checkout and fiat-backed balance.";
    case "wallet":
      return isZh
        ? "常规链上充值通道，资金会进入同一钱包余额。"
        : "Standard on-chain deposit rail. Funds land in the same wallet balance.";
    case "x402":
      return isZh
        ? "独立的 X402 充值通道，资金也会进入同一钱包余额，但来源会保留。"
        : "Dedicated X402 deposit rail. It funds the same wallet balance, but the source stays distinct.";
    default:
      return isZh
        ? "未识别的充值来源。"
        : "Unrecognized topup source.";
  }
}
