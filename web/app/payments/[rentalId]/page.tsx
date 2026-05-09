"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Copy } from "lucide-react";
import { useAuthStore } from "@/lib/auth/store";
import { useLocaleStore } from "@/lib/i18n/store";
import { formatPaymentMethodLabel } from "@/lib/payment-records";
import { workerFetch } from "@/lib/api/client";
import { normalizeSubscriptionValue } from "@/lib/config/generator";
import { WorkspaceShell } from "@/components/layout/WorkspaceShell";
import { CenteredStatus } from "@/components/layout/CenteredStatus";
import { Badge, Button, Card, useToast } from "@/components/ui";

interface RentalDetail {
  id: string;
  protocol: string;
  status: string;
  ip: string | null;
  vps_id: string | null;
  duration_hours: number;
  started_at: string | null;
  expires_at: string | null;
  remainingMinutes: number;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
}

export default function PaymentRentalDetailPage() {
  const params = useParams<{ rentalId?: string }>();
  const router = useRouter();
  const { t, locale } = useLocaleStore();
  const { showToast } = useToast();
  const token = useAuthStore((s) => s.token);
  const rentalId = typeof params?.rentalId === "string" ? params.rentalId : "";
  const isZh = locale === "zh";

  const [rental, setRental] = useState<RentalDetail | null>(null);
  const [subscription, setSubscription] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const visibleSubscription = useMemo(() => normalizeSubscriptionValue(subscription, "universal"), [subscription]);

  useEffect(() => {
    if (!token) {
      router.push("/");
      return;
    }

    if (!rentalId) {
      setError(isZh ? "缺少租用单号，无法查看节点详情。" : "Missing rental id, cannot open node details.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    const headers = { Authorization: `Bearer ${token}` };

    const load = async () => {
      setLoading(true);
      setError(null);
      setSubscriptionError(null);
      setRental(null);
      setSubscription(null);

      const [rentalResult, subscriptionResult] = await Promise.allSettled([
        workerFetch(`/api/rental/${rentalId}`, { headers }),
        workerFetch(`/api/rental/${rentalId}/subscription?format=universal`, { headers }),
      ]);

      if (cancelled) {
        return;
      }

      if (rentalResult.status !== "fulfilled") {
        const message = rentalResult.reason instanceof Error ? rentalResult.reason.message : t("common.error.generic");
        setError(message);
        setLoading(false);
        return;
      }

      const rentalResponse = rentalResult.value;
      const rentalPayload = await rentalResponse.json().catch(() => null);
      if (!rentalResponse.ok || rentalPayload?.error) {
        const message = rentalPayload?.error || t("common.error.generic");
        setError(message);
        setLoading(false);
        return;
      }
      setRental(rentalPayload as RentalDetail);

      if (subscriptionResult.status === "fulfilled") {
        const subscriptionResponse = subscriptionResult.value;
        const subscriptionPayload = await subscriptionResponse.json().catch(() => null);
        const normalizedSubscription = normalizeSubscriptionValue(subscriptionPayload?.subscription, "universal");
        const notReadyMessage = isZh
          ? "节点还没部署成功，暂不提供可复制的订阅链接。"
          : "The node is not fully deployed yet, so the copyable subscription link is unavailable.";

        if (subscriptionResponse.ok && !subscriptionPayload?.error && normalizedSubscription) {
          setSubscription(normalizedSubscription);
        } else {
          setSubscription(null);
          setSubscriptionError(
            (subscriptionResponse.status === 202 || subscriptionResponse.status === 409 || !normalizedSubscription)
              ? notReadyMessage
              : (subscriptionPayload?.error || (isZh ? "节点链接暂时不可用。" : "The node link is temporarily unavailable."))
          );
        }
      } else {
        setSubscriptionError(
          subscriptionResult.reason instanceof Error
            ? subscriptionResult.reason.message
            : (isZh ? "节点链接暂时不可用。" : "The node link is temporarily unavailable."),
        );
      }

      setLoading(false);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [isZh, rentalId, reloadToken, router, t, token]);

  const statusLabels: Record<string, string> = {
    provisioning: t("status.provisioning"),
    active: t("status.active"),
    paused: t("status.paused"),
    expired: t("status.expired"),
    destroyed: t("status.destroyed"),
  };

  const statusVariants: Record<string, "default" | "secondary" | "destructive"> = {
    active: "default",
    provisioning: "secondary",
    paused: "secondary",
    expired: "secondary",
    destroyed: "destructive",
  };

  const rentalRows = useMemo(() => {
    if (!rental) {
      return [];
    }

    return [
      { label: isZh ? "租用单号" : "Rental ID", value: rental.id, mono: true },
      { label: isZh ? "节点状态" : "Node status", value: statusLabels[rental.status] || rental.status },
      { label: isZh ? "协议" : "Protocol", value: rental.protocol },
      { label: isZh ? "机器 IP" : "Machine IP", value: rental.ip || (isZh ? "尚未分配" : "Not assigned") , mono: true },
      { label: isZh ? "云主机 ID" : "VPS ID", value: rental.vps_id || (isZh ? "尚未创建" : "Not created"), mono: true },
      { label: isZh ? "时长" : "Duration", value: `${rental.duration_hours}h` },
      { label: isZh ? "剩余时间" : "Remaining", value: formatMinutes(rental.remainingMinutes) },
      {
        label: isZh ? "支付方式" : "Payment method",
        value: rental.paymentMethod ? formatPaymentMethodLabel(rental.paymentMethod, isZh) : (isZh ? "未记录" : "Not recorded"),
      },
      {
        label: isZh ? "支付状态" : "Payment status",
        value: rental.paymentStatus || (isZh ? "未记录" : "Not recorded"),
      },
      {
        label: isZh ? "开始时间" : "Started",
        value: formatDateTime(rental.started_at),
      },
      {
        label: isZh ? "到期时间" : "Expires",
        value: formatDateTime(rental.expires_at),
      },
    ];
  }, [isZh, rental, statusLabels]);

  const handleCopySubscription = async () => {
    if (!visibleSubscription) {
      return;
    }
    await navigator.clipboard?.writeText(visibleSubscription);
    showToast(isZh ? "已复制节点链接。" : "Node link copied.", "success");
  };

  const headerTitle = isZh ? "节点详情" : "Node details";
  const headerBody = rental
    ? (isZh
        ? `从支付记录打开的节点 ${shortId(rental.id)}。`
        : `Node ${shortId(rental.id)} opened from payment history.`)
    : (isZh
        ? "查看当前租用单号对应的节点信息和订阅链接。"
        : "Inspect the node snapshot and subscription link for this rental.");

  if (loading) {
    return (
      <WorkspaceShell
        header={(
          <PageHeader
            title={headerTitle}
            subtitle={headerBody}
            backLabel={isZh ? "返回支付记录" : "Back to payments"}
            onBack={() => router.push("/payments")}
          />
        )}
      >
        <CenteredStatus
          eyebrow="Payments"
          title={isZh ? "正在加载节点详情。" : "Loading node details."}
          body={isZh ? "正在同步节点状态与订阅链接。" : "Syncing node state and subscription link."}
          tone="neutral"
          pulse
        />
      </WorkspaceShell>
    );
  }

  if (error || !rental) {
    return (
      <WorkspaceShell
        header={(
          <PageHeader
            title={headerTitle}
            subtitle={headerBody}
            backLabel={isZh ? "返回支付记录" : "Back to payments"}
            onBack={() => router.push("/payments")}
          />
        )}
      >
        <CenteredStatus
          eyebrow="Payments"
          title={isZh ? "节点详情暂时不可用。" : "Node details are temporarily unavailable."}
          body={error || (isZh ? "没有找到这条节点记录。" : "No rental record was found for this payment.")}
          tone="danger"
          action={(
            <div className="flex flex-col justify-center gap-3 sm:flex-row">
              <Button variant="outline" onClick={() => router.push("/payments")}>
                {isZh ? "返回支付记录" : "Back to payments"}
              </Button>
              <Button onClick={() => setReloadToken((value) => value + 1)}>
                {t("common.retry")}
              </Button>
            </div>
          )}
        />
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell
      header={(
      <PageHeader
        title={headerTitle}
        subtitle={headerBody}
        backLabel={isZh ? "返回支付记录" : "Back to payments"}
        onBack={() => router.push("/payments")}
      />
    )}
    >
      <div className="animate-rise space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          <SummaryCard
            label={isZh ? "节点状态" : "Node status"}
            value={statusLabels[rental.status] || rental.status}
            tag={isZh ? "节点" : "Node"}
            badge={statusVariants[rental.status]}
          />
          <SummaryCard
            label={isZh ? "协议" : "Protocol"}
            value={rental.protocol}
            tag={isZh ? "协议" : "Route"}
            badge="outline"
          />
          <SummaryCard
            label={isZh ? "剩余时间" : "Remaining"}
            value={formatMinutes(rental.remainingMinutes)}
            tag={isZh ? "计时" : "Timer"}
            badge={rental.remainingMinutes <= 0 ? "destructive" : "default"}
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.94fr)]">
          <Card className="overflow-hidden">
            <div className="border-b p-5">
              <div className="section-eyebrow">Node snapshot</div>
              <div className="mt-2 text-2xl font-semibold">
                {isZh ? "节点与支付信息" : "Node and payment info"}
              </div>
              <div className="mt-2 text-sm leading-6 text-muted-foreground">
                {isZh
                  ? "这里保留了这条支付对应的节点状态、地址、时长和付款状态。"
                  : "This keeps the node state, address, duration, and payment status tied to the payment record."}
              </div>
            </div>
            <div className="grid gap-3 p-5 md:grid-cols-2">
              {rentalRows.map((row) => (
                <DetailItem key={row.label} label={row.label} value={row.value} mono={row.mono} />
              ))}
            </div>
          </Card>

          <Card className="space-y-5 p-5">
            <div>
              <div className="section-eyebrow">{isZh ? "节点链接" : "Node link"}</div>
              <h3 className="mt-2 text-2xl font-semibold">
                {isZh ? "可复制的订阅链接" : "Copyable subscription link"}
              </h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {isZh
                  ? "把下面的订阅串复制到客户端即可导入当前节点。"
                  : "Copy the subscription string below into a supported client to import this node."}
              </p>
            </div>

            {visibleSubscription ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopySubscription}
                    className="rounded-full"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {isZh ? "复制节点链接" : "Copy node link"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => router.push("/payments")}
                    className="rounded-full"
                  >
                    {isZh ? "返回支付记录" : "Back to payments"}
                  </Button>
                </div>
                <div className="code-block break-all">{visibleSubscription}</div>
              </>
            ) : (
              <div className="rounded-[1.5rem] border border-dashed border-black/10 bg-muted/30 p-4 text-sm leading-7 text-muted-foreground">
                {subscriptionError || (isZh
                  ? "节点链接还没准备好，可能是节点尚在部署中，或者历史记录已经没有可用订阅缓存。"
                  : "The node link is not ready yet. The node may still be provisioning, or the historical subscription cache may no longer be available.")}
              </div>
            )}
          </Card>
        </div>
      </div>
    </WorkspaceShell>
  );
}

function PageHeader({
  title,
  subtitle,
  backLabel,
  onBack,
}: {
  title: string;
  subtitle: string;
  backLabel: string;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-black/5 pb-5 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="section-eyebrow">Payments</div>
        <h1 className="mt-2 text-4xl font-semibold">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-muted-foreground">{subtitle}</p>
      </div>
      <Button variant="outline" onClick={onBack} className="self-start">
        <ArrowLeft className="h-4 w-4" />
        {backLabel}
      </Button>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tag,
  badge = "outline",
}: {
  label: string;
  value: string;
  tag: string;
  badge?: "default" | "secondary" | "destructive" | "outline";
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">{label}</div>
          <div className="mt-3 text-2xl font-semibold">{value}</div>
        </div>
        <Badge variant={badge}>{tag}</Badge>
      </div>
    </Card>
  );
}

function DetailItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-[1.2rem] border border-black/5 bg-white/70 px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className={`mt-2 text-sm font-medium ${mono ? "break-all font-mono" : "break-words"}`}>{value}</div>
    </div>
  );
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function formatMinutes(value: number) {
  const rounded = Math.trunc(value);
  const sign = rounded < 0 ? "-" : "";
  const absolute = Math.abs(rounded);
  if (absolute >= 1440) {
    const days = Math.floor(absolute / 1440);
    const hours = Math.floor((absolute % 1440) / 60);
    return `${sign}${days}d ${hours}h`;
  }
  if (absolute >= 60) {
    const hours = Math.floor(absolute / 60);
    const minutes = absolute % 60;
    return `${sign}${hours}h ${minutes}m`;
  }
  return `${sign}${absolute}m`;
}

function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}...` : value;
}
