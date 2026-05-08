"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDeployStore } from "@/lib/deploy/store";
import { useLocaleStore } from "@/lib/i18n/store";
import { Button, Badge } from "@/components/ui";
import { CenteredStatus } from "@/components/layout/CenteredStatus";
import { workerFetch } from "@/lib/api/client";

export default function RentalSuccessPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t, locale } = useLocaleStore();
  const sessionId = searchParams.get("session_id");
  const [resolvedRentalId, setResolvedRentalId] = useState<string | null>(null);
  const [isRenewal, setIsRenewal] = useState(false);
  const [loading, setLoading] = useState(true);
  const isZh = locale === "zh";

  const setRentalId = useDeployStore((s) => s.setRentalId);
  const setRemainingMinutes = useDeployStore((s) => s.setRemainingMinutes);
  const setRentalStatus = useDeployStore((s) => s.setRentalStatus);

  useEffect(() => {
    if (!sessionId) {
      router.push("/");
      return;
    }

    const check = async () => {
      try {
        const res = await workerFetch(`/api/rental/session/${sessionId}`);
        const data = await res.json();
        if (data.rentalId) {
          setResolvedRentalId(data.rentalId);
          setIsRenewal(data.isRenewal);
          if (!data.isRenewal) {
            setRentalId(data.rentalId);
            setRemainingMinutes(data.remainingMinutes || 60);
            setRentalStatus("active");
          }
          setLoading(false);
        } else if (data.status === "pending") {
          setTimeout(check, 1000);
        } else {
          setLoading(false);
        }
      } catch {
        setLoading(false);
      }
    };

    check();
  }, [router, sessionId, setRemainingMinutes, setRentalId, setRentalStatus]);

  if (loading) {
    return (
      <CenteredStatus
        eyebrow="Payments"
        title={isZh ? "支付已确认，正在同步节点状态。" : "Payment confirmed. Syncing rental state now."}
        body={t("rental.loadingConfig")}
        tone="neutral"
        pulse
      />
    );
  }

  if (isRenewal) {
    return (
      <CenteredStatus
        eyebrow="Renewal complete"
        title={t("rental.renew.success")}
        body={t("rental.paymentConfirmed")}
        tone="success"
        meta={resolvedRentalId ? <Badge variant="outline" className="px-3 py-1">#{resolvedRentalId.slice(0, 8)}</Badge> : null}
        action={(
          <Button onClick={() => router.push("/")}>
            {t("nav.home")}
          </Button>
        )}
      />
    );
  }

  return (
    <CenteredStatus
      eyebrow="Payment complete"
      title={t("rental.paymentConfirmed")}
      body={resolvedRentalId ? `${t("rental.creatingNode")} #${resolvedRentalId.slice(0, 8)}` : t("rental.creatingNode")}
      tone="success"
      action={(
        <div className="flex flex-col justify-center gap-3 sm:flex-row">
          <Button onClick={() => router.push("/")}>{t("nav.home")}</Button>
          <Button variant="outline" onClick={() => router.push("/payments")}>
            {t("payment.history")}
          </Button>
        </div>
      )}
    />
  );
}
