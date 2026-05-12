"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useDeployStore } from "@/lib/deploy/store";
import { useAuthStore } from "@/lib/auth/store";
import { useLocaleStore } from "@/lib/i18n/store";
import { RENTAL_PLANS } from "@/lib/deploy/types";
import { WizardAside, WizardFrame, WizardSummaryRow as SummaryRow } from "@/components/layout/WizardLayout";
import { Button, Card, Input, Label } from "@/components/ui";
import { workerFetch } from "@/lib/api/client";

type QuickConnectStatus = "idle" | "authenticating" | "starting" | "preparing" | "optimizing" | "configuring" | "ready" | "failed";

const POLL_INTERVAL_MS = 4000;

export function RentalWizard() {
  const setProtocol = useDeployStore((s) => s.setProtocol);
  const setRentalId = useDeployStore((s) => s.setRentalId);
  const setRentalStatus = useDeployStore((s) => s.setRentalStatus);
  const setRemainingMinutes = useDeployStore((s) => s.setRemainingMinutes);
  const token = useAuthStore((s) => s.token);
  const storedEmail = useAuthStore((s) => s.email);
  const setAuth = useAuthStore((s) => s.setAuth);
  const { locale, tPlan } = useLocaleStore();
  const isZh = locale === "zh";

  const [email, setEmail] = useState(storedEmail || "");
  const [durationHours, setDurationHours] = useState(1);
  const [status, setStatus] = useState<QuickConnectStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [rentalId, setLocalRentalId] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [balanceNotice, setBalanceNotice] = useState<{ balance: number; required: number } | null>(null);

  const selectedPlan = useMemo(
    () => RENTAL_PLANS.find((plan) => plan.durationHours === durationHours) || RENTAL_PLANS[0],
    [durationHours],
  );
  const busy = ["authenticating", "starting", "preparing", "optimizing", "configuring"].includes(status);
  const ready = status === "ready";
  const statusText = {
    idle: isZh ? "点击后自动创建 VLESS 专属线路。" : "Click once to create a private VLESS route.",
    authenticating: isZh ? "正在建立身份..." : "Signing you in...",
    starting: isZh ? "正在提交一键连接..." : "Starting one-click connection...",
    preparing: isZh ? "正在准备专属线路..." : "Preparing your private route...",
    optimizing: isZh ? "正在自动优化线路..." : "Optimizing route automatically...",
    configuring: isZh ? "正在生成连接配置..." : "Preparing connection profile...",
    ready: isZh ? "节点已就绪，即将进入连接面板。" : "Node is ready. Opening the connection panel.",
    failed: isZh ? "当前线路暂不可用，请稍后重试。" : "The route is temporarily unavailable. Please retry later.",
  } satisfies Record<QuickConnectStatus, string>;

  useEffect(() => {
    if (!rentalId || ready || status === "failed") {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await workerFetch(`/api/rental/${rentalId}/progress`, {
          headers: { Authorization: `Bearer ${useAuthStore.getState().token}` },
          cache: "no-store",
        });
        const data = await res.json();
        if (cancelled) return;
        const nextStatus = typeof data.userStatus === "string" ? data.userStatus : data.status;
        if (nextStatus === "ready" || data.status === "active") {
          setStatus("ready");
          setProtocol("vless-reality");
          setRentalId(rentalId);
          setRemainingMinutes(durationHours * 60);
          setRentalStatus("active");
          return;
        }
        if (nextStatus === "failed" || data.status === "failed" || data.status === "released") {
          setStatus("failed");
          setMessage(data.userMessage || statusText.failed);
          return;
        }
        if (nextStatus === "optimizing" || nextStatus === "configuring" || nextStatus === "preparing") {
          setStatus(nextStatus);
        } else {
          setStatus("preparing");
        }
        setMessage(data.userMessage || null);
      } catch {
        if (!cancelled) {
          setStatus("optimizing");
        }
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [durationHours, ready, rentalId, setProtocol, setRemainingMinutes, setRentalId, setRentalStatus, status, statusText.failed]);

  const ensureAuth = async () => {
    if (token) {
      return token;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(isZh ? "请输入有效邮箱。" : "Enter a valid email.");
    }

    setStatus("authenticating");
    const res = await workerFetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || (isZh ? "登录失败。" : "Sign-in failed."));
    }
    setAuth(data.userId, data.token, email, Boolean(data.isAdmin));
    return String(data.token);
  };

  const startQuickConnect = async () => {
    setMessage(null);
    setBalanceNotice(null);
    setStatus(token ? "starting" : "authenticating");

    try {
      const authToken = await ensureAuth();
      setStatus("starting");
      const res = await workerFetch("/api/rental/quick-connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ durationHours }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        if (data.code === "WALLET_BALANCE_LOW") {
          setBalanceNotice({
            balance: Number(data.balance || 0),
            required: Number(data.required || 0),
          });
        }
        throw new Error(data.error || statusText.failed);
      }

      setLocalRentalId(data.rentalId);
      setRegion(data.region || null);
      setStatus(data.userStatus === "optimizing" ? "optimizing" : "preparing");
      setMessage(data.userMessage || null);
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : statusText.failed);
    }
  };

  return (
    <WizardFrame
      eyebrow={isZh ? "一键快连" : "One-click connect"}
      title={isZh ? "一个按钮创建并交付专属 VLESS 线路" : "Create a private VLESS route with one button"}
      description={isZh
        ? "地区、协议、合规审计和探测恢复都由系统自动处理；你只需要确认邮箱并点击一次。"
        : "Region, protocol, strict audit, and route recovery are handled automatically. Confirm your email and click once."}
      stepLabel={isZh ? "自动" : "Auto"}
      aside={(
        <WizardAside
          title={isZh ? "黑箱策略" : "Black-box defaults"}
          rows={[
            { label: isZh ? "协议" : "Protocol", value: "VLESS Reality" },
            { label: isZh ? "地区" : "Region", value: region || (isZh ? "自动选择" : "Auto-selected") },
            { label: isZh ? "审计" : "Audit", value: isZh ? "最严格" : "Strictest" },
            { label: isZh ? "时长" : "Duration", value: tPlan(selectedPlan.id) },
            { label: isZh ? "费用" : "Price", value: `$${selectedPlan.totalPrice.toFixed(2)}` },
          ]}
          footer={(
            <div className="space-y-2 text-sm leading-6 text-muted-foreground">
              <div className="rounded-lg border border-border bg-card px-4 py-3">
                {isZh ? "探测失败会自动清理并换区重试。" : "Probe failures trigger cleanup and automatic region rotation."}
              </div>
              <div className="rounded-lg border border-border bg-card px-4 py-3">
                {isZh ? "未来 APP 会用同一接口启动本地 xray 内核。" : "The future app will use this same API to start the local xray core."}
              </div>
            </div>
          )}
        />
      )}
    >
      <Card className="space-y-6 p-6 md:p-8">
        <div className="space-y-3">
          <Label>{isZh ? "邮箱" : "Email"}</Label>
          <Input
            type="email"
            value={email}
            disabled={Boolean(token) || busy}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={isZh ? "you@example.com" : "you@example.com"}
            className="h-12 rounded-lg"
          />
        </div>

        <details className="rounded-lg border border-border bg-card px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold">
            {isZh ? "高级设置" : "Advanced settings"}
          </summary>
          <div className="mt-4 space-y-3">
            <Label>{isZh ? "租用时长" : "Rental duration"}</Label>
            <select
              value={durationHours}
              disabled={busy}
              onChange={(event) => setDurationHours(Number(event.target.value))}
              className="h-12 w-full rounded-lg border border-border bg-background px-3 text-sm"
            >
              {RENTAL_PLANS.map((plan) => (
                <option key={plan.id} value={plan.durationHours}>
                  {tPlan(plan.id)} - ${plan.totalPrice.toFixed(2)}
                </option>
              ))}
            </select>
          </div>
        </details>

        <div className="rounded-lg border border-border bg-muted/40 p-5">
          <div className="text-sm font-semibold">{statusText[status]}</div>
          {message && <div className="mt-2 text-sm leading-6 text-muted-foreground">{message}</div>}
          {rentalId && (
            <div className="mt-3">
              <SummaryRow label="ID" value={rentalId} mono />
            </div>
          )}
        </div>

        {balanceNotice && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <div className="font-medium">
              {isZh ? "钱包余额不足。" : "Wallet balance is too low."}
            </div>
            <div className="mt-2 leading-6">
              {isZh
                ? `当前余额 $${balanceNotice.balance.toFixed(2)}，最低需要 $${balanceNotice.required.toFixed(2)}。`
                : `Current balance is $${balanceNotice.balance.toFixed(2)} and the minimum needed is $${balanceNotice.required.toFixed(2)}.`}
            </div>
            <Link href="/console/wallet" className="mt-3 inline-block font-semibold underline underline-offset-4">
              {isZh ? "去钱包充值" : "Open wallet"}
            </Link>
          </div>
        )}

        <Button
          onClick={startQuickConnect}
          disabled={busy || ready}
          className="h-14 w-full text-base"
        >
          {busy
            ? (isZh ? "自动处理中..." : "Working automatically...")
            : ready
              ? (isZh ? "已就绪" : "Ready")
              : (isZh ? "一键连接" : "One-click connect")}
        </Button>
      </Card>
    </WizardFrame>
  );
}
