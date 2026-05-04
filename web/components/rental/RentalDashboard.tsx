"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Badge, useToast } from "@/components/ui";
import { useLocaleStore } from "@/lib/i18n/store";
import { RENTAL_PLANS } from "@/lib/deploy/types";
import { workerFetch } from "@/lib/api/client";
import { generateVlessRealityConfig, generateHysteria2Config } from "@/lib/config/generator";

interface RentalData {
  id: string;
  protocol: string;
  status: string;
  ip: string;
  duration_hours: number;
  started_at: string;
  expires_at: string;
  remainingMinutes: number;
}

interface ClientConfig {
  clashMeta: string;
  singbox: string;
  v2rayN: string;
  shadowrocket: string;
}

export function RentalDashboard({ token, initialRental }: { token: string; initialRental: RentalData }) {
  const [rental, setRental] = useState<RentalData>(initialRental);
  const [config, setConfig] = useState<ClientConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(initialRental.remainingMinutes * 60);
  const [selectedClient, setSelectedClient] = useState<"clashMeta" | "singbox" | "v2rayN" | "shadowrocket">("clashMeta");
  const [loading, setLoading] = useState(false);
  const [showRenew, setShowRenew] = useState(false);
  const [renewPlan, setRenewPlan] = useState<(typeof RENTAL_PLANS)[number] | null>(null);
  const [subscription, setSubscription] = useState<string | null>(null);
  const { t, tPlan } = useLocaleStore();
  const { showToast } = useToast();
  const router = useRouter();

  // Fetch rental config when rental is active
  useEffect(() => {
    if (rental.status === "active" && !config) {
      workerFetch(`/api/rental/${rental.id}/config`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.error) {
            setConfigError(data.error);
            return;
          }
          // Convert API config to client format
          const generated = rental.protocol === "vless-reality"
            ? generateVlessRealityConfig(data)
            : generateHysteria2Config(data);
          setConfig(generated);
        })
        .catch((e) => setConfigError(e instanceof Error ? e.message : "Failed to load config"));
    }
  }, [rental.id, rental.status, rental.protocol, token]);

  // Countdown timer
  useEffect(() => {
    if (timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft]);

  // Poll rental status every 30s
  const pollStatus = useCallback(async () => {
    try {
      const res = await workerFetch(`/api/rental/${rental.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setRental(data);
      setTimeLeft(data.remainingMinutes * 60);
    } catch {}
  }, [rental.id, token]);

  useEffect(() => {
    const interval = setInterval(pollStatus, 30000);
    return () => clearInterval(interval);
  }, [pollStatus]);

  const hours = Math.floor(timeLeft / 3600);
  const minutes = Math.floor((timeLeft % 3600) / 60);
  const seconds = timeLeft % 60;
  const totalSeconds = rental.duration_hours * 3600;
  const progress = ((totalSeconds - timeLeft) / totalSeconds) * 100;

  const handlePause = async () => {
    setLoading(true);
    try {
      const res = await workerFetch(`/api/rental/${rental.id}/pause`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Pause failed");
      showToast(t("status.pause.success"), "success");
      pollStatus();
    } catch {
      showToast(t("common.error.generic"), "error");
    } finally {
      setLoading(false);
    }
  };

  const handleResume = async () => {
    setLoading(true);
    try {
      const res = await workerFetch(`/api/rental/${rental.id}/resume`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Resume failed");
      showToast(t("status.resume.success"), "success");
      pollStatus();
    } catch {
      showToast(t("common.error.generic"), "error");
    } finally {
      setLoading(false);
    }
  };

  const handleDestroy = async () => {
    if (!confirm(t("status.destroy.confirm"))) return;
    setLoading(true);
    try {
      const res = await workerFetch(`/api/rental/${rental.id}/destroy`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Destroy failed");
      setRental((prev) => ({ ...prev, status: "destroyed" }));
      showToast(t("status.destroy.success"), "success");
    } catch {
      showToast(t("common.error.generic"), "error");
    } finally {
      setLoading(false);
    }
  };

  const handleRenew = async () => {
    if (!renewPlan) return;
    setLoading(true);
    try {
      // Create Stripe checkout session for renewal
      const res = await workerFetch(`/api/payment/renew`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          rentalId: rental.id,
          durationHours: renewPlan.durationHours,
        }),
      });
      const data = await res.json();
      if (data.error) {
        showToast(data.error, "error");
      } else if (data.url) {
        window.location.href = data.url;
        return; // Don't reset loading — user is redirected
      }
    } catch {
      showToast(t("rental.deployFailed"), "error");
    }
    setLoading(false);
  };

  const handleLoadSubscription = async () => {
    try {
      const res = await workerFetch(`/api/rental/${rental.id}/subscription`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.error) {
        showToast(data.error, "error");
        return;
      }
      setSubscription(data.subscription || null);
    } catch {
      showToast(t("common.error.generic"), "error");
    }
  };

  const clientLabels = {
    clashMeta: t("client.clashMeta"),
    singbox: t("client.singbox"),
    v2rayN: t("client.v2rayN"),
    shadowrocket: t("client.shadowrocket"),
  };

  if (rental.status === "destroyed") {
    return (
      <div className="space-y-6">
        <Card className="p-6 text-center">
          <div className="text-2xl font-bold text-muted-foreground">{t("status.destroyed")}</div>
          <div className="text-sm text-muted-foreground mt-2">{t("privacy.desc2")}</div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Timer Card */}
      <Card className="p-6 text-center">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm text-muted-foreground">{t("status.remaining")}</div>
          <Badge variant={timeLeft < 300 ? "destructive" : "default"}>
            {rental.status === "paused" ? t("status.paused") : rental.status === "active" ? t("status.active") : rental.status}
          </Badge>
        </div>
        <div className="text-5xl font-mono font-bold tabular-nums">
          {String(hours).padStart(2, "0")}:{String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
        </div>
        <div className="mt-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className={`h-full transition-all duration-300 ${timeLeft < 300 ? "bg-red-500" : "bg-primary"}`}
              style={{ width: `${100 - progress}%` }}
            />
          </div>
        </div>
        {timeLeft < 300 && timeLeft > 0 && (
          <div className="mt-2 text-sm text-red-500 font-medium">{t("rental.expiringSoon")}</div>
        )}
      </Card>

      {/* Config Card */}
      {config && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{t("status.config")}</h2>
            <Badge>{rental.protocol === "vless-reality" ? t("protocol.vless") : t("protocol.hysteria2")}</Badge>
          </div>

          {/* Client tabs */}
          <div className="flex gap-2">
            {(Object.keys(clientLabels) as Array<keyof typeof clientLabels>).map((key) => (
              <button
                key={key}
                className={`px-3 py-1 text-xs rounded-full border transition ${
                  selectedClient === key ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                }`}
                onClick={() => setSelectedClient(key)}
              >
                {clientLabels[key]}
              </button>
            ))}
          </div>

          <div className="rounded-lg bg-muted/50 p-4 font-mono text-xs whitespace-pre-wrap max-h-48 overflow-auto">
            {selectedClient === "clashMeta" && config.clashMeta}
            {selectedClient === "singbox" && config.singbox}
            {selectedClient === "v2rayN" && config.v2rayN}
            {selectedClient === "shadowrocket" && config.shadowrocket}
          </div>

          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              const text = config[selectedClient] || "";
              navigator.clipboard?.writeText(text);
            }}
          >
            {t("common.copy")}
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={handleLoadSubscription}
          >
            Subscription
          </Button>
          {subscription && (
            <div className="rounded-lg bg-muted/50 p-4 font-mono text-xs break-all">
              {subscription}
            </div>
          )}
        </Card>
      )}

      {!config && rental.status === "active" && !configError && (
        <Card className="p-6 text-center">
          <div className="text-sm text-muted-foreground">{t("rental.loadingConfig")}</div>
        </Card>
      )}

      {configError && rental.status === "active" && (
        <Card className="p-6 text-center">
          <div className="text-sm text-red-500">{configError}</div>
          <Button variant="outline" className="mt-3" onClick={() => { setConfigError(null); setConfig(null); }}>
            {t("common.retry")}
          </Button>
        </Card>
      )}

      {/* Control Buttons */}
      <div className="grid grid-cols-3 gap-3">
        {rental.status === "active" ? (
          <Button variant="outline" className="h-20 flex-col space-y-1" onClick={handlePause} disabled={loading}>
            <span className="text-lg">⏸</span>
            <span className="text-xs">{t("status.pause")}</span>
          </Button>
        ) : rental.status === "paused" ? (
          <Button variant="outline" className="h-20 flex-col space-y-1" onClick={handleResume} disabled={loading}>
            <span className="text-lg">▶</span>
            <span className="text-xs">{t("status.resume")}</span>
          </Button>
        ) : (
          <div />
        )}
        <Button variant="outline" className="h-20 flex-col space-y-1" onClick={() => setShowRenew(true)} disabled={loading}>
          <span className="text-lg">🔄</span>
          <span className="text-xs">{t("rental.renew")}</span>
        </Button>
        <Button
          variant="outline"
          className="h-20 flex-col space-y-1 border-red-200 text-red-600 hover:bg-red-50"
          onClick={handleDestroy}
          disabled={loading}
        >
          <span className="text-lg">🔥</span>
          <span className="text-xs">{t("status.destroy")}</span>
        </Button>
      </div>

      {/* Renew Modal */}
      {showRenew && (
        <Card className="p-6 space-y-4">
          <h2 className="text-lg font-semibold">{t("rental.renew")}</h2>
          <div className="grid grid-cols-2 gap-3">
            {RENTAL_PLANS.map((plan) => (
              <button key={plan.id} onClick={() => setRenewPlan(plan)}
                className={`rounded-lg border-2 p-4 text-center transition-all ${renewPlan?.id === plan.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
              >
                <div className="text-lg font-semibold">{tPlan(plan.id)}</div>
                <div className="mt-1 text-sm text-muted-foreground">${plan.totalPrice.toFixed(2)}</div>
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setShowRenew(false); setRenewPlan(null); }}>{t("common.cancel")}</Button>
            <Button disabled={!renewPlan || loading} onClick={handleRenew}>
              {loading ? t("common.processing") : `${t("common.confirm")} · $${renewPlan?.totalPrice.toFixed(2) ?? "0.00"}`}
            </Button>
          </div>
        </Card>
      )}

      {/* Privacy notice */}
      <div className="rounded-lg border border-border/40 bg-muted/30 p-4 text-xs text-muted-foreground space-y-1">
        <div className="font-semibold text-foreground">{t("privacy.title")}</div>
        <div>{t("privacy.desc1")}</div>
        <div>{t("privacy.desc2")}</div>
        <div className="pt-1">
          <button className="text-primary hover:underline" onClick={() => router.push("/payments")}>
            {t("payment.history")} →
          </button>
        </div>
      </div>
    </div>
  );
}
