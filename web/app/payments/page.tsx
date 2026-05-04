"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth/store";
import { useLocaleStore } from "@/lib/i18n/store";
import { Button, Card, Badge, useToast } from "@/components/ui";
import { workerFetch } from "@/lib/api/client";

interface PaymentRecord {
  id: string;
  rental_id: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  created_at: string;
}

export default function PaymentsPage() {
  const router = useRouter();
  const { t } = useLocaleStore();
  const { showToast } = useToast();
  const token = useAuthStore((s) => s.token);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  }, [token, t, showToast]);

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center">
        <div className="text-2xl animate-pulse">⏳</div>
        <p className="mt-4 text-muted-foreground">{t("rental.loadingConfig")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{t("payment.history")}</h1>
          <Button variant="outline" onClick={() => router.push("/")}>
            {t("common.back")}
          </Button>
        </div>
        <Card className="p-6 text-center">
          <div className="text-3xl mb-2">❌</div>
          <p className="text-red-600">{error}</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => { setError(null); setLoading(true); }}
          >
            {t("common.retry")}
          </Button>
        </Card>
      </div>
    );
  }

  const methodLabels: Record<string, string> = {
    stripe: t("payment.stripe"),
    redeem_code: t("payment.redeemCode"),
    crypto: "Crypto", // No i18n needed — brand name
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

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("payment.history")}</h1>
        <Button variant="outline" onClick={() => router.push("/")}>
          {t("common.back")}
        </Button>
      </div>

      {payments.length === 0 ? (
        <Card className="p-6 text-center text-muted-foreground">
          {t("payment.empty")}
        </Card>
      ) : (
        <div className="space-y-3">
          {payments.map((p) => (
            <Card key={p.id} className="p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="font-semibold">
                    ${p.amount.toFixed(2)}{" "}
                    <span className="text-xs text-muted-foreground uppercase">
                      {p.currency}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Rental: {p.rental_id.slice(0, 8)}...
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(p.created_at).toLocaleDateString()}{" "}
                    {new Date(p.created_at).toLocaleTimeString()}
                  </div>
                </div>
                <div className="space-x-2">
                  <Badge variant={badgeVariants[p.status] || "secondary"}>
                    {statusLabels[p.status] || p.status}
                  </Badge>
                  <Badge variant="outline">
                    {methodLabels[p.method] || p.method}
                  </Badge>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
