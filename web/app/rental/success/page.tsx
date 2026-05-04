"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDeployStore } from "@/lib/deploy/store";
import { useAuthStore } from "@/lib/auth/store";
import { useLocaleStore } from "@/lib/i18n/store";
import { Button, Card } from "@/components/ui";
import { workerFetch } from "@/lib/api/client";

export default function RentalSuccessPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t } = useLocaleStore();
  const sessionId = searchParams.get("session_id");
  const [resolvedRentalId, setResolvedRentalId] = useState<string | null>(null);
  const [isRenewal, setIsRenewal] = useState(false);
  const [loading, setLoading] = useState(true);

  const setRentalId = useDeployStore((s) => s.setRentalId);
  const setRemainingMinutes = useDeployStore((s) => s.setRemainingMinutes);
  const setRentalStatus = useDeployStore((s) => s.setRentalStatus);
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    if (!sessionId) {
      router.push("/");
      return;
    }

    // Poll for the session result
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
  }, [sessionId]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="text-3xl animate-pulse">⏳</div>
          <p className="mt-4 text-muted-foreground">{t("rental.loadingConfig")}</p>
        </div>
      </div>
    );
  }

  if (isRenewal) {
    return (
      <div className="mx-auto max-w-lg space-y-6 py-12 text-center">
        <Card className="p-6 space-y-4">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl">✓</div>
          <h2 className="text-2xl font-bold text-green-700">{t("rental.renew.success")}</h2>
          <p className="text-muted-foreground">
            {t("rental.paymentConfirmed")}
          </p>
          <Button onClick={() => router.push("/")}>
            {t("nav.home")}
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 py-12 text-center">
      <Card className="p-6 space-y-4">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl">✓</div>
        <h2 className="text-2xl font-bold text-green-700">{t("rental.paymentConfirmed")}</h2>
        <p className="text-muted-foreground">
          {t("rental.creatingNode")}
        </p>
        <Button onClick={() => router.push("/")}>
          {t("nav.home")}
        </Button>
      </Card>
    </div>
  );
}
