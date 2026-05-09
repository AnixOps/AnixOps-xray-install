"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { useAuthStore } from "@/lib/auth/store";
import { useLocaleStore } from "@/lib/i18n/store";
import { isFormalRelease } from "@/lib/release-profile";
import { formatRedeemCodeTypeLabel } from "@/lib/payment-records";
import { WorkspaceShell } from "@/components/layout/WorkspaceShell";
import { CenteredStatus } from "@/components/layout/CenteredStatus";
import { Button, Card, Badge, Tabs, TabsContent, TabsList, TabsTrigger, useToast } from "@/components/ui";
import { groupPaymentsByMethod } from "@/lib/payment-records";
import { workerFetch } from "@/lib/api/client";

interface PaymentRecord {
  id: string;
  rental_id: string | null;
  amount: number;
  currency: string;
  method: string;
  status: string;
  created_at: string;
  rental?: {
    id: string;
    protocol: string;
    status: string;
    ip: string | null;
    vps_id: string | null;
    duration_hours: number;
    started_at: string | null;
    expires_at: string | null;
    updated_at: string | null;
  } | null;
}

export default function PaymentsPage() {
  const router = useRouter();
  const { t, locale } = useLocaleStore();
  const { showToast } = useToast();
  const token = useAuthStore((s) => s.token);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isZh = locale === "zh";
  const formalRelease = isFormalRelease();

  useEffect(() => {
    if (!token) {
      router.push("/");
      return;
    }

    workerFetch("/api/payments", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          showToast(data.error, "error");
        } else {
          setPayments(data.payments || []);
        }
        setLoading(false);
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : t("common.error.generic");
        setError(message);
        showToast(message, "error");
        setLoading(false);
      });
  }, [router, showToast, t, token]);

  const methodLabels: Record<string, string> = {
    stripe: formalRelease ? (isZh ? "历史 Stripe" : "Legacy Stripe") : t("payment.stripe"),
    wallet: t("payment.wallet"),
    x402: formalRelease ? (isZh ? "历史 X402" : "Legacy X402") : (isZh ? "X402 直付" : "X402 direct payment"),
    redeem_code: formatRedeemCodeTypeLabel("duration", isZh),
    crypto: "Crypto",
  };

  const statusLabels: Record<string, string> = {
    completed: t("payment.status.completed"),
    pending: t("payment.status.pending"),
    failed: t("payment.status.failed"),
    refunded: t("payment.status.refunded"),
  };

  const badgeVariants: Record<string, "default" | "secondary" | "destructive"> = {
    completed: "default",
    pending: "secondary",
    failed: "destructive",
    refunded: "secondary",
  };

  const rentalStatusLabels: Record<string, string> = {
    provisioning: t("status.provisioning"),
    active: t("status.active"),
    paused: t("status.paused"),
    expired: t("status.expired"),
    destroyed: t("status.destroyed"),
  };

  const totals = useMemo(() => {
    const count = payments.length;
    const revenue = payments
      .filter((item) => item.status === "completed")
      .reduce((sum, item) => sum + item.amount, 0);
    const pending = payments.filter((item) => item.status === "pending").length;
    return {
      count,
      revenue,
      pending,
      buckets: groupPaymentsByMethod(payments),
    };
  }, [payments]);

  const paymentSections = [
    {
      key: "wallet",
      title: isZh ? "钱包直付" : "Wallet checkouts",
      description: isZh ? "从余额直接扣费的租用记录。" : "Rentals paid directly from wallet balance.",
      empty: isZh ? "这里还没有钱包直付记录。" : "No wallet checkout records yet.",
      records: totals.buckets.wallet,
    },
    {
      key: "redeem_code",
      title: formatRedeemCodeTypeLabel("duration", isZh),
      description: formalRelease
        ? (isZh ? "通过 CDK 单次型创建的租用记录。" : "Rentals created through CDK single-use codes.")
        : (isZh ? "通过兑换码创建的租用记录。" : "Rentals created through redeem-code redemption."),
      empty: formalRelease
        ? (isZh ? "这里还没有 CDK 单次型租用记录。" : "No CDK single-use rentals yet.")
        : (isZh ? "这里还没有兑换码租用记录。" : "No redeem-code rentals yet."),
      records: totals.buckets.redeem_code,
    },
    {
      key: "x402",
      title: formalRelease
        ? (isZh ? "历史 X402" : "Historical X402")
        : (isZh ? "X402 直付" : "X402 direct payments"),
      description: isZh ? "历史 X402 直接支付记录。" : "Historical X402 direct payment records.",
      empty: isZh ? "这里还没有 X402 直付记录。" : "No X402 direct payment records yet.",
      records: totals.buckets.x402,
    },
    {
      key: "legacy",
      title: formalRelease
        ? (isZh ? "历史直付" : "Historical direct payments")
        : (isZh ? "历史直付" : "Legacy direct payments"),
      description: isZh ? "Stripe 和更早的直接支付记录。" : "Stripe and older direct payment records.",
      empty: isZh ? "这里还没有历史直付记录。" : "No legacy direct payments yet.",
      records: totals.buckets.legacy,
    },
  ] as const;
  const defaultPaymentSection = paymentSections.find((section) => section.records.length > 0)?.key || paymentSections[0].key;
  const summaryCards = [
    { label: isZh ? "记录数" : "Records", value: String(totals.count) },
    { label: isZh ? "已完成" : "Completed volume", value: `$${totals.revenue.toFixed(2)}` },
    { label: isZh ? "待处理" : "Pending", value: String(totals.pending) },
    { label: isZh ? "钱包直付" : "Wallet", value: String(totals.buckets.wallet.length) },
    { label: formalRelease ? (isZh ? "CDK 单次型" : "CDK single-use") : (isZh ? "兑换码" : "Redeem code"), value: String(totals.buckets.redeem_code.length) },
    { label: formalRelease ? (isZh ? "历史直付" : "Historical direct") : (isZh ? "历史直付" : "Legacy"), value: String(totals.buckets.legacy.length) },
    { label: formalRelease ? (isZh ? "历史 X402" : "Historical X402") : (isZh ? "X402 直付" : "X402"), value: String(totals.buckets.x402.length) },
  ] as const;

  if (loading) {
    return (
      <WorkspaceShell
        header={(
          <PageHeader title={t("payment.history")} onBack={() => router.push("/")} />
        )}
      >
        <CenteredStatus
          eyebrow="Payments"
          title={isZh ? "正在载入支付记录。" : "Loading payment history."}
          body={t("rental.loadingConfig")}
          tone="neutral"
          pulse
        />
      </WorkspaceShell>
    );
  }

  if (error) {
    return (
      <WorkspaceShell
        header={(
          <PageHeader title={t("payment.history")} onBack={() => router.push("/")} />
        )}
      >
        <div className="space-y-6">
          <CenteredStatus
            eyebrow="Payments"
            title={isZh ? "支付记录暂时不可用。" : "Payment history is temporarily unavailable."}
            body={error}
            tone="danger"
            action={(
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  onClick={() => {
                    setError(null);
                    setLoading(true);
                  }}
                >
                  {t("common.retry")}
                </Button>
              </div>
            )}
          />
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell
      header={(
        <PageHeader title={t("payment.history")} onBack={() => router.push("/")} />
      )}
    >
      <div className="animate-rise space-y-6">

        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-7">
          {summaryCards.map((card) => (
            <SummaryCard key={card.label} label={card.label} value={card.value} />
          ))}
        </div>

        {payments.length === 0 ? (
          <CenteredStatus
            eyebrow="Payments"
            title={isZh ? "这里还没有支付记录。" : "No payment records yet."}
            body={t("payment.empty")}
            tone="neutral"
          />
        ) : (
          <Tabs defaultValue={defaultPaymentSection} className="space-y-4">
            <TabsList className="flex h-auto w-full flex-wrap gap-2 rounded-[1.5rem] border border-black/5 bg-white/70 p-2">
              {paymentSections.map((section) => (
                <TabsTrigger key={section.key} value={section.key} className="rounded-xl px-4 py-2 text-xs font-semibold">
                  {section.title}
                  <span className="ml-2 rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {section.records.length}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>

            {paymentSections.map((section) => (
              <TabsContent key={section.key} value={section.key}>
                <PaymentGroupSection
                  title={section.title}
                  description={section.description}
                  empty={section.empty}
                  records={section.records}
                  isZh={isZh}
                  methodLabels={methodLabels}
                  statusLabels={statusLabels}
                  badgeVariants={badgeVariants}
                  rentalStatusLabels={rentalStatusLabels}
                />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    </WorkspaceShell>
  );
}

function PageHeader({
  title,
  onBack,
}: {
  title: string;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-black/5 pb-5 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="section-eyebrow">Payments</div>
        <h1 className="mt-2 text-4xl font-semibold">{title}</h1>
      </div>
      <Button variant="outline" onClick={onBack}>
        Back
      </Button>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-5">
      <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">{label}</div>
      <div className="mt-3 text-3xl font-semibold">{value}</div>
    </Card>
  );
}

function PaymentGroupSection({
  title,
  description,
  empty,
  records,
  isZh,
  methodLabels,
  statusLabels,
  badgeVariants,
  rentalStatusLabels,
}: {
  title: string;
  description: string;
  empty: string;
  records: PaymentRecord[];
  isZh: boolean;
  methodLabels: Record<string, string>;
  statusLabels: Record<string, string>;
  badgeVariants: Record<string, "default" | "secondary" | "destructive">;
  rentalStatusLabels: Record<string, string>;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-medium">{title}</div>
            <div className="mt-1 text-sm text-muted-foreground">{description}</div>
          </div>
          <Badge variant="outline">{records.length}</Badge>
        </div>
      </div>
      {records.length === 0 ? (
        <div className="p-5 text-sm text-muted-foreground">{empty}</div>
      ) : (
        <div className="space-y-3 p-5">
          {records.map((payment) => (
            <PaymentRecordCard
              key={payment.id}
              payment={payment}
              isZh={isZh}
              methodLabels={methodLabels}
              statusLabels={statusLabels}
              badgeVariants={badgeVariants}
              rentalStatusLabels={rentalStatusLabels}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function PaymentRecordCard({
  payment,
  isZh,
  methodLabels,
  statusLabels,
  badgeVariants,
  rentalStatusLabels,
}: {
  payment: PaymentRecord;
  isZh: boolean;
  methodLabels: Record<string, string>;
  statusLabels: Record<string, string>;
  badgeVariants: Record<string, "default" | "secondary" | "destructive">;
  rentalStatusLabels: Record<string, string>;
}) {
  return (
    <div className="lift-transition rounded-[1.35rem] border border-black/5 bg-white/95 p-5 shadow-sm md:p-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.85fr)] lg:items-start">
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-3xl font-semibold">
              ${payment.amount.toFixed(2)}
            </span>
            <span className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
              {payment.currency}
            </span>
          </div>
          <div className="text-sm leading-6 text-muted-foreground">
            {isZh ? "租用单号" : "Rental"}:{" "}
            {payment.rental_id ? (
              <Link
                href={`/payments/${payment.rental_id}`}
                className="font-mono text-xs font-medium text-foreground underline decoration-foreground/20 underline-offset-4 transition hover:decoration-foreground"
              >
                {payment.rental_id}
              </Link>
            ) : (
              <span className="font-mono text-xs">{payment.rental_id || "—"}</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {new Date(payment.created_at).toLocaleDateString()}{" "}
            {new Date(payment.created_at).toLocaleTimeString()}
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={badgeVariants[payment.status] || "secondary"}>
              {statusLabels[payment.status] || payment.status}
            </Badge>
            <Badge variant="outline">{methodLabels[payment.method] || payment.method}</Badge>
          </div>
        </div>

        <NodeSnapshot
          payment={payment}
          isZh={isZh}
          rentalStatusLabels={rentalStatusLabels}
        />
      </div>
    </div>
  );
}

function NodeSnapshot({
  payment,
  isZh,
  rentalStatusLabels,
}: {
  payment: PaymentRecord;
  isZh: boolean;
  rentalStatusLabels: Record<string, string>;
}) {
  const rental = payment.rental;

  if (!rental) {
    return (
      <div className="rounded-[1.35rem] border border-dashed border-black/10 bg-white/60 p-4 text-sm text-muted-foreground">
        {isZh ? "未找到关联租用记录，可能已被清理。" : "No linked rental record was found. It may have been cleaned up."}
      </div>
    );
  }

  const rows = [
    { label: isZh ? "节点状态" : "Node status", value: rentalStatusLabels[rental.status] || rental.status },
    { label: isZh ? "协议" : "Protocol", value: rental.protocol },
    { label: isZh ? "机器 IP" : "Machine IP", value: rental.ip || (isZh ? "尚未分配" : "Not assigned") },
    { label: isZh ? "云主机 ID" : "VPS ID", value: rental.vps_id || (isZh ? "尚未创建" : "Not created") },
    { label: isZh ? "时长" : "Duration", value: `${rental.duration_hours}h` },
    {
      label: isZh ? "到期时间" : "Expires",
      value: rental.expires_at ? new Date(rental.expires_at).toLocaleString() : "-",
    },
  ];

  return (
    <div className="rounded-[1.35rem] border border-black/5 bg-slate-950 p-4 text-white shadow-inner shadow-white/5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.22em] text-white/45">
          {isZh ? "机器与节点" : "Machine and node"}
        </div>
        <Badge variant={rental.status === "active" ? "default" : "secondary"}>
          {rentalStatusLabels[rental.status] || rental.status}
        </Badge>
      </div>
      <div className="grid gap-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start justify-between gap-4 rounded-2xl bg-white/7 px-3 py-2">
            <span className="text-xs text-white/45">{row.label}</span>
            <span className="max-w-[190px] break-all text-right text-xs font-medium text-white/84">{row.value}</span>
          </div>
        ))}
      </div>
      {payment.rental_id ? (
        <Link
          href={`/payments/${payment.rental_id}`}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/16"
        >
          {isZh ? "打开节点详情" : "Open node details"}
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      ) : null}
    </div>
  );
}
