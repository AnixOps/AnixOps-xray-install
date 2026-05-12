"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Badge, useToast } from "@/components/ui";
import { WizardSummaryRow as SummaryRow } from "@/components/layout/WizardLayout";
import { useLocaleStore } from "@/lib/i18n/store";
import { RENTAL_PLANS } from "@/lib/deploy/types";
import { workerFetch } from "@/lib/api/client";
import {
  generateHysteria2Config,
  generateVlessRealityConfig,
  normalizeRentalConfig,
  normalizeSubscriptionValue,
} from "@/lib/config/generator";

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

export function RentalDashboard({
  token,
  initialRental,
}: {
  token: string;
  initialRental: RentalData;
}) {
  const [rental, setRental] = useState<RentalData>(initialRental);
  const [config, setConfig] = useState<ClientConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(initialRental.remainingMinutes * 60);
  const [selectedClient, setSelectedClient] = useState<"clashMeta" | "singbox" | "v2rayN" | "shadowrocket">("clashMeta");
  const [loading, setLoading] = useState(false);
  const [showRenew, setShowRenew] = useState(false);
  const [renewPlan, setRenewPlan] = useState<(typeof RENTAL_PLANS)[number] | null>(null);
  const [subscription, setSubscription] = useState<string | null>(null);
  const [subscriptionFormat, setSubscriptionFormat] = useState<"universal" | "raw">("universal");
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const { t, tPlan, locale } = useLocaleStore();
  const { showToast } = useToast();
  const router = useRouter();
  const isZh = locale === "zh";

  useEffect(() => {
    if (rental.status === "active" && !config) {
      workerFetch(`/api/rental/${rental.id}/config`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(async (res) => {
          const data = await res.json().catch(() => null);
          const notReadyMessage = isZh
            ? "节点还没部署成功，暂不提供客户端配置。"
            : "The node is not fully deployed yet, so client exports are unavailable.";

          if (!res.ok || data?.error) {
            setConfig(null);
            setConfigError(
              res.status === 202 || res.status === 409
                ? notReadyMessage
                : (data?.error || t("common.error.generic"))
            );
            return;
          }

          const validation = normalizeRentalConfig(data);
          if (!validation.ok) {
            setConfig(null);
            setConfigError(notReadyMessage);
            return;
          }

          const generated = validation.config.protocol === "vless-reality"
            ? generateVlessRealityConfig(validation.config)
            : generateHysteria2Config(validation.config);
          setConfig(generated);
          setConfigError(null);
        })
        .catch((e) => {
          setConfig(null);
          setConfigError(e instanceof Error ? e.message : "Failed to load config");
        });
    }
  }, [config, isZh, rental.id, rental.protocol, rental.status, t, token]);

  useEffect(() => {
    if (timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft]);

  const pollStatus = useCallback(async () => {
    try {
      const res = await workerFetch(`/api/rental/${rental.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setRental(data);
      setTimeLeft(data.remainingMinutes * 60);
    } catch {
      // Best-effort polling only.
    }
  }, [rental.id, token]);

  useEffect(() => {
    const interval = setInterval(pollStatus, 30000);
    return () => clearInterval(interval);
  }, [pollStatus]);

  const hours = Math.floor(timeLeft / 3600);
  const minutes = Math.floor((timeLeft % 3600) / 60);
  const seconds = timeLeft % 60;
  const totalSeconds = Math.max(1, rental.duration_hours * 3600);
  const progress = ((totalSeconds - timeLeft) / totalSeconds) * 100;

  const currentClientConfig = useMemo(() => {
    if (!config) return "";
    return config[selectedClient] || "";
  }, [config, selectedClient]);

  const visibleSubscription = useMemo(() => {
    return normalizeSubscriptionValue(subscription, subscriptionFormat);
  }, [subscription, subscriptionFormat]);

  const clientLabels = {
    clashMeta: t("client.clashMeta"),
    singbox: t("client.singbox"),
    v2rayN: t("client.v2rayN"),
    shadowrocket: t("client.shadowrocket"),
  };

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
        return;
      }
    } catch {
      showToast(t("rental.deployFailed"), "error");
    }
    setLoading(false);
  };

  const handleLoadSubscription = async (format: "universal" | "raw" = "universal") => {
    try {
      const res = await workerFetch(`/api/rental/${rental.id}/subscription?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const notReadyMessage = isZh
        ? "节点还没部署成功，暂不提供可复制的订阅链接。"
        : "The node is not fully deployed yet, so the copyable subscription link is unavailable.";

      if (format === "raw") {
        const text = await res.text();
        const normalizedSubscription = normalizeSubscriptionValue(text, format);
        if (!res.ok || !normalizedSubscription) {
          setSubscription(null);
          setSubscriptionError(res.status === 202 || res.status === 409 || !normalizedSubscription ? notReadyMessage : (text || t("common.error.generic")));
          showToast(res.status === 202 || res.status === 409 || !normalizedSubscription ? notReadyMessage : (text || t("common.error.generic")), "error");
          return;
        }
        setSubscriptionFormat(format);
        setSubscription(normalizedSubscription);
        setSubscriptionError(null);
      } else {
        const data = await res.json().catch(() => null);
        const normalizedSubscription = normalizeSubscriptionValue(data?.subscription, format);
        if (!res.ok || data?.error || !normalizedSubscription) {
          setSubscription(null);
          const message = res.status === 202 || res.status === 409 || !normalizedSubscription
            ? notReadyMessage
            : (data?.error || t("common.error.generic"));
          setSubscriptionError(message);
          showToast(message, "error");
          return;
        }
        setSubscriptionFormat(format);
        setSubscription(normalizedSubscription);
        setSubscriptionError(null);
      }
    } catch {
      setSubscription(null);
      setSubscriptionError(t("common.error.generic"));
      showToast(t("common.error.generic"), "error");
    }
  };

  if (rental.status === "destroyed") {
    return (
      <div className="animate-rise mx-auto max-w-3xl space-y-6">
        <Card className="p-8 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-xl font-semibold text-muted-foreground">
            AX
          </div>
          <div className="text-2xl font-semibold text-muted-foreground">
            {t("status.destroyed")}
          </div>
          <div className="mt-2 text-sm text-muted-foreground">{t("privacy.desc2")}</div>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-rise mx-auto max-w-6xl space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <Card className="relative overflow-hidden bg-slate-950 p-6 text-white shadow-sm md:p-8">
            <div className="relative space-y-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="section-eyebrow text-white/50">{isZh ? "Active rental" : "Active rental"}</div>
                  <h2 className="mt-3 text-3xl font-semibold md:text-4xl">
                    {rental.protocol === "vless-reality" ? t("protocol.vless") : t("protocol.hysteria2")}
                  </h2>
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-white/72">
                    {isZh
                      ? "计时、导出、续费与销毁都在同一处完成，不需要跳出当前工作流。"
                      : "Timing, export, renew, and destroy stay in one place so you never have to leave the active workflow."}
                  </p>
                </div>
                <Badge
                  variant={timeLeft < 300 ? "destructive" : "outline"}
                  className="self-start border-white/20 bg-white/10 px-3 py-1 text-white md:self-auto"
                >
                  {rental.status === "paused"
                    ? t("status.paused")
                    : rental.status === "active"
                      ? t("status.active")
                      : rental.status}
                </Badge>
              </div>

              <div className="rounded-lg border border-white/12 bg-white/10 p-5 ">
                <div className="text-xs uppercase tracking-[0.24em] text-white/45">{t("status.remaining")}</div>
                <div className="mt-3 font-mono text-6xl font-semibold tabular-nums md:text-7xl">
                  {String(hours).padStart(2, "0")}:{String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
                </div>
                <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${timeLeft < 300 ? "bg-red-500" : "bg-white"}`}
                    style={{ width: `${100 - progress}%` }}
                  />
                </div>
                {timeLeft < 300 && timeLeft > 0 && (
                  <div className="mt-3 text-sm font-medium text-red-200">{t("rental.expiringSoon")}</div>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <PreviewMetric label={t("rental.protocol")} value={rental.protocol} />
                <PreviewMetric label="IP" value={rental.ip || "Private endpoint"} />
                <PreviewMetric label={t("rental.duration")} value={`${rental.duration_hours}h`} />
              </div>
            </div>
          </Card>

          {config && (
            <Card className="space-y-5 p-6 md:p-8">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="section-eyebrow">{t("status.config")}</div>
                  <h2 className="mt-2 text-2xl font-semibold">
                    {isZh ? "连接配置" : "Connection profile"}
                  </h2>
                </div>
                <Badge className="self-start px-3 py-1 md:self-auto">
                  {rental.ip || "Private endpoint"}
                </Badge>
              </div>

              <div className="code-block max-h-72 overflow-auto whitespace-pre-wrap">
                {currentClientConfig}
              </div>

              <Button
                onClick={() => {
                  navigator.clipboard?.writeText(currentClientConfig);
                  showToast(t("common.copied"), "success");
                }}
                className="h-12 w-full"
              >
                {isZh ? "复制连接配置" : "Copy connection profile"}
              </Button>

              <details className="rounded-lg border border-border bg-card px-4 py-3">
                <summary className="cursor-pointer text-sm font-semibold">
                  {isZh ? "高级导出" : "Advanced exports"}
                </summary>
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="text-sm font-medium">
                      {isZh ? "客户端格式" : "Client format"}
                    </label>
                    <select
                      value={selectedClient}
                      onChange={(event) => setSelectedClient(event.target.value as typeof selectedClient)}
                      className="mt-2 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"
                    >
                      {(Object.keys(clientLabels) as Array<keyof typeof clientLabels>).map((key) => (
                        <option key={key} value={key}>
                          {clientLabels[key]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleLoadSubscription("universal")}
                    >
                      {t("subscription.format.universal")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleLoadSubscription("raw")}
                    >
                      {t("subscription.format.raw")}
                    </Button>
                    {visibleSubscription && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          navigator.clipboard?.writeText(visibleSubscription);
                          showToast(t("common.copied"), "success");
                        }}
                      >
                        {t("subscription.copy")}
                      </Button>
                    )}
                  </div>
                  {subscriptionError ? (
                    <div className="rounded-lg border border-dashed border-border bg-card px-4 py-3 text-sm leading-6 text-muted-foreground">
                      {subscriptionError}
                    </div>
                  ) : null}
                  {visibleSubscription ? (
                    <div className="code-block break-all">{visibleSubscription}</div>
                  ) : null}
                </div>
              </details>
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
              <Button
                variant="outline"
                className="mt-3"
                onClick={() => {
                  setConfigError(null);
                  setConfig(null);
                }}
              >
                {t("common.retry")}
              </Button>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card className="space-y-5 p-5">
            <div>
              <div className="section-eyebrow">{isZh ? "Session snapshot" : "Session snapshot"}</div>
              <h3 className="mt-2 text-xl font-semibold">
                {isZh ? "运行状态一览" : "Everything important at a glance"}
              </h3>
            </div>
            <div className="space-y-3">
              <SummaryRow label="ID" value={rental.id} mono />
              <SummaryRow label={t("status.remaining")} value={`${Math.ceil(timeLeft / 60)}m`} />
              <SummaryRow label={t("rental.duration")} value={`${rental.duration_hours}h`} />
              <SummaryRow label={t("status.active")} value={rental.status} />
            </div>
          </Card>

          <details className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <summary className="cursor-pointer text-sm font-semibold">
              {isZh ? "高级节点操作" : "Advanced node controls"}
            </summary>
            <div className="mt-4 space-y-3">
              {rental.status === "active" ? (
                <ActionButton
                  title={t("status.pause")}
                  body={isZh ? "临时停止节点运行，但保留当前会话。" : "Temporarily stop the node while keeping the current session."}
                  onClick={handlePause}
                  disabled={loading}
                />
              ) : rental.status === "paused" ? (
                <ActionButton
                  title={t("status.resume")}
                  body={isZh ? "恢复节点并继续使用剩余时长。" : "Resume the node and continue from the remaining time."}
                  onClick={handleResume}
                  disabled={loading}
                />
              ) : null}

              <ActionButton
                title={t("rental.renew")}
                body={isZh ? "追加时长并延续当前专属节点。" : "Extend runtime and keep working on the current exclusive node."}
                onClick={() => setShowRenew(true)}
                disabled={loading}
              />

              <ActionButton
                title={t("status.destroy")}
                body={isZh ? "立即结束并清理当前租用状态。" : "End the session immediately and clean up the current rental."}
                onClick={handleDestroy}
                disabled={loading}
                destructive
              />
            </div>
          </details>

          <Card className="space-y-3 p-5 text-sm leading-6 text-muted-foreground">
            <div className="font-semibold text-foreground">{t("privacy.title")}</div>
            <div>{t("privacy.desc1")}</div>
            <div>{t("privacy.desc2")}</div>
            <button className="text-primary hover:underline" onClick={() => router.push("/payments")}>
              {t("payment.history")} -&gt;
            </button>
          </Card>
        </div>
      </div>

      {showRenew && (
        <Card className="space-y-5 p-6 md:p-8">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="section-eyebrow">{t("rental.renew")}</div>
              <h2 className="mt-2 text-2xl font-semibold">
                {t("rental.renew.selectDuration")}
              </h2>
            </div>
            <Badge variant="outline" className="self-start px-3 py-1 md:self-auto">
              {rental.protocol}
            </Badge>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            {RENTAL_PLANS.map((plan) => (
              <button
                key={plan.id}
                onClick={() => setRenewPlan(plan)}
                className={`choice-card min-h-[150px] text-center ${renewPlan?.id === plan.id ? "choice-card-active" : ""}`}
              >
                <div className="text-lg font-semibold">{tPlan(plan.id)}</div>
                <div className="mt-3 text-2xl font-semibold text-primary">${plan.totalPrice.toFixed(2)}</div>
                <div className="mt-2 text-xs text-muted-foreground">${plan.pricePerHour}/{t("time.hour")}</div>
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
            <Button
              variant="outline"
              onClick={() => {
                setShowRenew(false);
                setRenewPlan(null);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button disabled={!renewPlan || loading} onClick={handleRenew}>
              {loading
                ? t("common.processing")
                : `${t("common.confirm")} $${renewPlan?.totalPrice.toFixed(2) ?? "0.00"}`}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/10 p-4 ">
      <div className="text-[11px] uppercase tracking-[0.22em] text-white/44">{label}</div>
      <div className="mt-2 text-sm font-semibold">{value}</div>
    </div>
  );
}

function ActionButton({
  title,
  body,
  onClick,
  disabled,
  destructive = false,
}: {
  title: string;
  body: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`choice-card w-full text-left disabled:pointer-events-none disabled:opacity-50 ${
        destructive ? "border-red-200 bg-red-50/70 hover:border-red-300 hover:bg-red-50" : ""
      }`}
    >
      <div className="space-y-2">
        <div className={`text-base font-semibold ${destructive ? "text-red-600" : ""}`}>
          {title}
        </div>
        <div className={`text-sm leading-6 ${destructive ? "text-red-500/90" : "text-muted-foreground"}`}>
          {body}
        </div>
      </div>
    </button>
  );
}
