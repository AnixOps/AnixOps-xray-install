"use client";

import { useMemo, type ReactNode, type RefObject } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { ConsoleAuditTable, type ConsoleAuditRow } from "@/components/console/ConsoleAuditTable";
import {
  RecentAnchorBatchesTable,
  type RecentAnchorBatchRow,
} from "@/components/admin/RecentAnchorBatchesTable";
import {
  RecentCryptoTopupsTable,
  type RecentCryptoTopupRow,
} from "@/components/admin/RecentCryptoTopupsTable";
import {
  RecentFiatTopupsTable,
  type RecentFiatTopupRow,
} from "@/components/admin/RecentFiatTopupsTable";
import {
  RecentPaymentsTable,
  type RecentPaymentRow,
} from "@/components/admin/RecentPaymentsTable";
import {
  RecentWalletLedgerTable,
  type RecentWalletLedgerRow,
} from "@/components/admin/RecentWalletLedgerTable";
import {
  type AdminTopupDetailResponse,
} from "@/components/admin/topup-detail-types";
import { classifyAdminPaymentBucket, type PaymentBucket } from "@/components/admin/payment-utils";
import { formatTopupRailDescription, formatTopupRailLabel } from "@/lib/topup-rails";

type ActivityBuckets = Record<PaymentBucket, RecentPaymentRow[]>;

export function AdminActivitySection({
  isZh,
  recentTopups,
  recentCryptoTopups,
  recentWalletLedgerEntries,
  recentPayments,
  recentAnchorBatches,
  recentAuditEntries,
  selectedTopup,
  selectedTopupId,
  loadingTopupId,
  onOpenRental,
  onOpenTopup,
  onClearTopup,
  onVerifyAnchorBatch,
  verifyingAnchorBatchId,
  topupDetailRef,
}: {
  isZh: boolean;
  recentTopups: RecentFiatTopupRow[];
  recentCryptoTopups: RecentCryptoTopupRow[];
  recentWalletLedgerEntries: RecentWalletLedgerRow[];
  recentPayments: RecentPaymentRow[];
  recentAnchorBatches: RecentAnchorBatchRow[];
  recentAuditEntries: ConsoleAuditRow[];
  selectedTopup: AdminTopupDetailResponse | null;
  selectedTopupId?: string | null;
  loadingTopupId?: string | null;
  onOpenRental?: (rentalId: string) => void;
  onOpenTopup?: (topupId: string) => void;
  onClearTopup?: () => void;
  onVerifyAnchorBatch: (batchId: string) => void;
  verifyingAnchorBatchId?: string | null;
  topupDetailRef?: RefObject<HTMLDivElement | null>;
}) {
  const paymentBuckets = useMemo<ActivityBuckets>(() => {
    const buckets: ActivityBuckets = {
      wallet: [],
      redeem_code: [],
      x402: [],
      legacy: [],
    };

    for (const payment of recentPayments) {
      buckets[classifyAdminPaymentBucket(payment.method)].push(payment);
    }

    return buckets;
  }, [recentPayments]);

  const selectedTopupRecord = selectedTopup?.topup ?? null;
  const selectedWalletLedger = selectedTopup?.walletLedger ?? null;
  const fiatTopup = selectedTopupRecord && selectedTopupRecord.kind === "fiat" ? selectedTopupRecord : null;
  const cryptoTopup = selectedTopupRecord && selectedTopupRecord.kind === "crypto" ? selectedTopupRecord : null;

  return (
    <Card className="space-y-5 rounded-[28px] border border-black/5 bg-white/90 p-6 shadow-[0_10px_40px_rgba(15,23,42,0.06)] backdrop-blur">
      <div className="flex flex-col gap-3 border-b border-black/5 pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Activity</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {isZh
              ? "充值、余额流转、支付、锚定和审计事件分表展示，wallet、X402 和兑换码来源彼此区分。"
              : "Topups, balance movement, payments, anchors, and audit events are split into dedicated tables so wallet, X402, and redeem-code sources stay distinct."}
          </p>
        </div>
        <Badge variant="outline" className="rounded-full px-3">
          {isZh ? "来源已分离" : "Sources separated"}
        </Badge>
      </div>

      <div className="space-y-6">
        <RecentFiatTopupsTable rows={recentTopups} onOpenTopup={onOpenTopup} isZh={isZh} />
        <RecentCryptoTopupsTable rows={recentCryptoTopups} onOpenTopup={onOpenTopup} isZh={isZh} />
        <RecentWalletLedgerTable
          rows={recentWalletLedgerEntries}
          onOpenRental={onOpenRental}
          onOpenTopup={onOpenTopup}
          isZh={isZh}
        />

        {selectedTopup ? (
          <div ref={topupDetailRef} className="scroll-mt-6">
            <Card className="rounded-[28px] border border-slate-200/80 bg-slate-50/85 p-6 shadow-[0_10px_40px_rgba(15,23,42,0.06)] backdrop-blur">
              <div className="flex flex-col gap-3 border-b border-black/5 pb-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-lg font-semibold tracking-tight">{isZh ? "充值详情" : "Topup Detail"}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {fiatTopup
                      ? (isZh
                        ? "法币充值现在会显示关联的钱包流水，便于追踪入账。"
                        : "Fiat topup records now expose the linked wallet ledger row for traceability.")
                      : (isZh
                        ? "链上充值会显示 rail、预期金额和关联的钱包流水。"
                        : "Crypto topup records now show the on-chain rail, expected amount, and linked wallet ledger row.")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={fiatTopup ? "secondary" : "default"}
                    className="rounded-full px-3"
                  >
                    {fiatTopup
                      ? (isZh ? "法币充值" : "Fiat topup")
                      : (isZh ? "链上充值" : "Crypto topup")}
                  </Badge>
                  <Badge
                    variant={loadingTopupId && loadingTopupId === selectedTopupId ? "secondary" : "outline"}
                    className="rounded-full px-3"
                  >
                    {loadingTopupId && loadingTopupId === selectedTopupId
                      ? (isZh ? "详情加载中" : "Loading detail")
                      : (isZh ? "详情已加载" : "Detail loaded")}
                  </Badge>
                  {onClearTopup ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={onClearTopup}
                      className="rounded-full border-black/10 bg-white/90 shadow-sm"
                    >
                      {isZh ? "清除选择" : "Clear"}
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="mt-5 space-y-6">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <TopupField label="Topup ID" value={selectedTopup.topup.id} mono />
                  <TopupField label="User" value={selectedTopup.topup.email || "-"} />
                  {fiatTopup ? (
                    <>
                      <TopupField label="Provider" value={fiatTopup.provider} />
                      <TopupField label="Amount" value={`${fiatTopup.amount.toFixed(2)} ${fiatTopup.currency.toUpperCase()}`} />
                      <TopupField
                        label="Status"
                        value={<Badge variant={getTopupStatusVariant(fiatTopup.status)} className="rounded-full">{fiatTopup.status}</Badge>}
                      />
                      <TopupField label="Stripe Session" value={fiatTopup.stripeSessionId || "-"} mono />
                      <TopupField label="Created" value={formatDateTime(fiatTopup.createdAt)} />
                      <TopupField label="Completed" value={formatDateTime(fiatTopup.completedAt)} />
                      <TopupField label="Updated" value={formatDateTime(fiatTopup.updatedAt)} />
                    </>
                  ) : (
                    <>
                      <TopupField label="Asset" value={`${cryptoTopup?.asset ?? "-"} · ${cryptoTopup?.network ?? "-"}`} />
                      <TopupField
                        label="Rail"
                        value={(
                          <div className="space-y-1">
                            <div>{formatTopupRailLabel(cryptoTopup?.rail, isZh)}</div>
                            <div className="text-xs text-muted-foreground">
                              {formatTopupRailDescription(cryptoTopup?.rail, isZh)}
                            </div>
                          </div>
                        )}
                      />
                      <TopupField label="Fiat Amount" value={`${cryptoTopup ? `${cryptoTopup.fiatAmount.toFixed(2)} ${cryptoTopup.currency.toUpperCase()}` : "-"}`} />
                      <TopupField label="Expected" value={cryptoTopup ? cryptoTopup.expectedAmount.toFixed(6) : "-"} mono />
                      <TopupField
                        label="Received"
                        value={cryptoTopup ? (cryptoTopup.receivedAmount == null ? "-" : cryptoTopup.receivedAmount.toFixed(6)) : "-"}
                        mono
                      />
                      <TopupField label="Address" value={cryptoTopup?.address || "-"} mono />
                      <TopupField label="Tx Hash" value={cryptoTopup?.txHash || "-"} mono />
                      <TopupField label="Confirmations" value={String(cryptoTopup?.confirmations ?? 0)} />
                      <TopupField label="Expires" value={formatDateTime(cryptoTopup?.expiresAt)} />
                      <TopupField label="Created" value={formatDateTime(cryptoTopup?.createdAt)} />
                      <TopupField label="Completed" value={formatDateTime(cryptoTopup?.completedAt)} />
                      <TopupField label="Updated" value={formatDateTime(cryptoTopup?.updatedAt)} />
                    </>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="text-sm font-medium tracking-tight">
                    {isZh ? "关联钱包流水" : "Linked Wallet Ledger"}
                  </div>
                  {selectedWalletLedger ? (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <TopupField label="Entry ID" value={selectedWalletLedger.id} mono />
                      <TopupField label="Ledger User" value={selectedWalletLedger.email || "-"} />
                      <TopupField label="Type" value={selectedWalletLedger.type} />
                      <TopupField
                        label="Amount"
                        value={`${formatSignedAmount(selectedWalletLedger.amount)} ${selectedWalletLedger.currency.toUpperCase()}`}
                        mono
                      />
                      <TopupField
                        label="Balance After"
                        value={`${selectedWalletLedger.balanceAfter.toFixed(2)} ${selectedWalletLedger.currency.toUpperCase()}`}
                      />
                      <TopupField label="Rental" value={selectedWalletLedger.rentalId || "-"} mono />
                      <TopupField label="Topup" value={selectedWalletLedger.topupId || "-"} mono />
                      <TopupField label="Created" value={formatDateTime(selectedWalletLedger.createdAt)} />
                      <TopupField label="Idempotency" value={selectedWalletLedger.idempotencyKey} mono />
                      {selectedWalletLedger.rentalId && onOpenRental ? (
                        <div className="xl:col-span-4">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenRental(selectedWalletLedger.rentalId as string)}
                            className="rounded-full border-black/10 bg-white/90 shadow-sm"
                          >
                            {isZh ? "打开租用详情" : "Open rental detail"}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <EmptyMessage>
                      {isZh ? "当前充值还没有生成对应的 wallet ledger 记录。" : "No wallet ledger row is linked to this topup yet."}
                    </EmptyMessage>
                  )}
                </div>
              </div>
            </Card>
          </div>
        ) : null}

        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <SourceMetric
              label={isZh ? "钱包支付" : "Wallet checkouts"}
              value={String(paymentBuckets.wallet.length)}
            />
            <SourceMetric
              label={isZh ? "兑换码租用" : "Redeem-code rentals"}
              value={String(paymentBuckets.redeem_code.length)}
            />
            <SourceMetric
              label={isZh ? "X402 通道" : "X402 rails"}
              value={String(paymentBuckets.x402.length)}
            />
            <SourceMetric
              label={isZh ? "历史直付" : "Legacy direct payments"}
              value={String(paymentBuckets.legacy.length)}
            />
          </div>
          <RecentPaymentsTable rows={recentPayments} onOpenRental={onOpenRental} />
        </div>

        <RecentAnchorBatchesTable
          rows={recentAnchorBatches}
          onVerify={onVerifyAnchorBatch}
          verifyingBatchId={verifyingAnchorBatchId}
        />
        <ConsoleAuditTable
          title="Recent Audit"
          entries={recentAuditEntries}
          empty={isZh ? "暂无审计条目。" : "No audit entries yet."}
        />
      </div>
    </Card>
  );
}

function SourceMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-sm font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function TopupField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="rounded-2xl border border-black/5 bg-white/95 p-4 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className={`mt-2 text-sm ${mono ? "break-all font-mono text-xs" : "font-medium tracking-tight"}`}>
        {empty ? "-" : value}
      </div>
    </div>
  );
}

function EmptyMessage({ children }: { children: ReactNode }) {
  return <div className="text-sm text-muted-foreground">{children}</div>;
}

function getTopupStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default";
  if (status === "pending") return "secondary";
  if (status === "short_paid" || status === "expired" || status === "cancelled" || status === "failed") {
    return "destructive";
  }
  return "outline";
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function formatSignedAmount(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}
