export interface AdminTopupWalletLedgerDetail {
  id: string;
  userId: string;
  email: string | null;
  type: string;
  amount: number;
  currency: string;
  rentalId: string | null;
  topupId: string | null;
  balanceAfter: number;
  idempotencyKey: string;
  createdAt: string;
}

export interface AdminFiatTopupDetail {
  kind: "fiat";
  id: string;
  userId: string;
  email: string | null;
  provider: string;
  amount: number;
  currency: string;
  status: string;
  stripeSessionId: string | null;
  createdAt: string;
  completedAt: string | null;
  updatedAt: string;
}

export interface AdminCryptoTopupDetail {
  kind: "crypto";
  id: string;
  userId: string;
  email: string | null;
  asset: string;
  network: string;
  rail: string;
  address: string;
  expectedAmount: number;
  receivedAmount: number | null;
  fiatAmount: number;
  currency: string;
  status: string;
  txHash: string | null;
  confirmations: number;
  ledgerId: string | null;
  createdAt: string;
  expiresAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export type AdminTopupDetailRecord = AdminFiatTopupDetail | AdminCryptoTopupDetail;

export interface AdminTopupDetailResponse {
  kind: "fiat" | "crypto";
  topup: AdminTopupDetailRecord;
  walletLedger: AdminTopupWalletLedgerDetail | null;
}
