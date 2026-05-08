"use client";

import { useEffect, useMemo, useState } from "react";
import { useDeployStore } from "@/lib/deploy/store";
import { useAuthStore } from "@/lib/auth/store";
import { useLocaleStore } from "@/lib/i18n/store";
import { PROTOCOL_INFO, RENTAL_PLANS } from "@/lib/deploy/types";
import { Button, Card, Badge, Input, Label } from "@/components/ui";
import { workerFetch } from "@/lib/api/client";

const SESSION_KEY = "rental-wizard-state";

interface ComplianceProfile {
  id: string;
  name: string;
  mode: "standard" | "restricted";
  version: string;
  blockedProtocols: string[];
}

type CheckoutPaymentMethod = "stripe" | "wallet" | "x402" | "redeem";

export function RentalWizard() {
  const step = useDeployStore((s) => s.step);
  const protocol = useDeployStore((s) => s.protocol);
  const rentalPlan = useDeployStore((s) => s.rentalPlan);
  const status = useDeployStore((s) => s.status);
  const error = useDeployStore((s) => s.error);

  const setStep = useDeployStore((s) => s.setStep);
  const setProtocol = useDeployStore((s) => s.setProtocol);
  const setRentalPlan = useDeployStore((s) => s.setRentalPlan);
  const setStatus = useDeployStore((s) => s.setStatus);
  const setRentalId = useDeployStore((s) => s.setRentalId);
  const setRentalStatus = useDeployStore((s) => s.setRentalStatus);
  const setRemainingMinutes = useDeployStore((s) => s.setRemainingMinutes);
  const setError = useDeployStore((s) => s.setError);

  const setAuth = useAuthStore((s) => s.setAuth);
  const { t, tPlan, locale } = useLocaleStore();
  const isZh = locale === "zh";

  const [email, setEmail] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<CheckoutPaymentMethod | null>(null);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemCodeValidating, setRedeemCodeValidating] = useState(false);
  const [redeemCodeValid, setRedeemCodeValid] = useState(false);
  const [redeemCodeError, setRedeemCodeError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [restored, setRestored] = useState(false);
  const [complianceProfiles, setComplianceProfiles] = useState<ComplianceProfile[]>([]);
  const [complianceProfileId, setComplianceProfileId] = useState("standard");

  useEffect(() => {
    if (restored) return;
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (saved) {
        const state = JSON.parse(saved);
        if (state.protocol) setProtocol(state.protocol);
        if (state.rentalPlanId) {
          const plan = RENTAL_PLANS.find((item) => item.id === state.rentalPlanId);
          if (plan) setRentalPlan(plan);
        }
        if (state.email) setEmail(state.email);
        if (state.complianceProfileId) setComplianceProfileId(state.complianceProfileId);
        if (["stripe", "wallet", "x402", "redeem"].includes(state.paymentMethod)) {
          setPaymentMethod(state.paymentMethod);
        }
        if (state.step) setStep(state.step);
        sessionStorage.removeItem(SESSION_KEY);
      }
    } catch {
      // Ignore parse errors from stale sessions.
    }
    setRestored(true);
  }, [restored, setProtocol, setRentalPlan, setStep]);

  useEffect(() => {
    let cancelled = false;
    workerFetch("/api/compliance/profiles", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !Array.isArray(data.profiles)) return;
        setComplianceProfiles(data.profiles);
        if (!data.profiles.some((profile: ComplianceProfile) => profile.id === complianceProfileId)) {
          const defaultProfile = data.profiles.find((profile: ComplianceProfile) => profile.id === "standard") || data.profiles[0];
          if (defaultProfile) setComplianceProfileId(defaultProfile.id);
        }
      })
      .catch(() => {
        if (!cancelled) setComplianceProfiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [complianceProfileId]);

  const saveStateForRedirect = () => {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        protocol,
        rentalPlanId: rentalPlan?.id,
        email,
        complianceProfileId,
        paymentMethod,
        step,
      }),
    );
  };

  const validateRedeemCode = async () => {
    if (!redeemCode || redeemCode.length < 6) {
      setRedeemCodeError(t("payment.redeemCode.invalid"));
      setRedeemCodeValid(false);
      return;
    }

    setRedeemCodeValidating(true);
    setRedeemCodeError(null);

    try {
      const res = await workerFetch("/api/redeem/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: redeemCode }),
      });
      const data = await res.json();
      if (data.valid) {
        setRedeemCodeValid(true);
        const matchingPlan = RENTAL_PLANS.find((item) => item.durationHours === data.durationHours);
        if (matchingPlan) {
          setRentalPlan(matchingPlan);
        }
      } else {
        setRedeemCodeError(data.error || t("payment.redeemCode.invalid"));
        setRedeemCodeValid(false);
      }
    } catch {
      setRedeemCodeError(t("common.error.generic"));
      setRedeemCodeValid(false);
    }

    setRedeemCodeValidating(false);
  };

  const selectedProtocolLabel = protocol ? t(PROTOCOL_INFO[protocol].nameKey) : isZh ? "尚未选择" : "Not selected";
  const selectedPlanLabel = rentalPlan ? tPlan(rentalPlan.id) : isZh ? "尚未选择" : "Not selected";
  const selectedTotal = rentalPlan ? `$${rentalPlan.totalPrice.toFixed(2)}` : "—";
  const selectedComplianceProfile = complianceProfiles.find((profile) => profile.id === complianceProfileId) || null;
  const selectedComplianceLabel = selectedComplianceProfile?.name || "Standard";
  const paymentMethodLabels: Record<CheckoutPaymentMethod, string> = {
    stripe: t("payment.stripe"),
    wallet: t("payment.wallet"),
    x402: t("payment.x402"),
    redeem: t("payment.redeemCode"),
  };
  const selectedPaymentLabel = paymentMethod ? paymentMethodLabels[paymentMethod] : "—";
  const complianceBlocksProtocol = Boolean(
    protocol && selectedComplianceProfile?.blockedProtocols?.includes(protocol),
  );
  const clearRedeemState = () => {
    setRedeemCode("");
    setRedeemCodeValid(false);
    setRedeemCodeError(null);
  };

  const protocolCards = useMemo(
    () => [
      {
        key: "vless-reality" as const,
        code: "VR",
        notes: isZh
          ? ["无需域名", "更强抗探测", "适合通用客户端"]
          : ["No domain needed", "Stronger anti-detection profile", "Great all-purpose client support"],
      },
      {
        key: "hysteria2" as const,
        code: "H2",
        notes: isZh
          ? ["UDP 优先", "游戏与视频更友好", "更高吞吐弹性"]
          : ["UDP first", "Better for gaming and video", "Higher throughput elasticity"],
      },
    ],
    [isZh],
  );

  const flowSteps = isZh
    ? [
        { title: "协议选择", body: "先确定适合的线路行为。" },
        { title: "支付与校验", body: "一次完成付款、兑换码或身份建立。" },
        { title: "节点交付", body: "拿到配置后可直接运行、续费或销毁。" },
      ]
    : [
        { title: "Protocol choice", body: "Pick the route profile that matches the job." },
        { title: "Payment and identity", body: "Complete payment, redeem, and access in one step." },
        { title: "Delivery", body: "Receive config and move directly into run, renew, or destroy." },
      ];

  if (step === 1) {
    return (
      <WizardFrame
        eyebrow="Rental setup"
        title={t("rental.selectProtocol")}
        description={t("rental.protocolSubtitle")}
        stepLabel="1 / 2"
        aside={(
          <WizardAside
            title={isZh ? "你将在这里得到什么" : "What this path gives you"}
            rows={[
              { label: isZh ? "当前模式" : "Mode", value: t("mode.rental") },
              { label: isZh ? "协议" : "Protocol", value: selectedProtocolLabel },
              { label: isZh ? "时长" : "Duration", value: selectedPlanLabel },
              { label: isZh ? "总价" : "Total", value: selectedTotal },
            ]}
            footer={(
              <div className="space-y-2">
                {flowSteps.map((item, index) => (
                  <div key={item.title} className="rounded-[1.35rem] border border-black/5 bg-white/75 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                      {index + 1}
                    </div>
                    <div className="mt-2 text-sm font-semibold tracking-[-0.02em]">{item.title}</div>
                    <div className="mt-1 text-sm leading-6 text-muted-foreground">{item.body}</div>
                  </div>
                ))}
              </div>
            )}
          />
        )}
      >
        <div className="grid gap-3 md:grid-cols-2">
          {protocolCards.map((item) => {
            const active = protocol === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setProtocol(item.key)}
                className={`choice-card min-h-[290px] ${active ? "choice-card-active" : ""}`}
              >
                <div className="flex h-full flex-col justify-between gap-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-4 text-left">
                      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-950 text-sm font-semibold text-white shadow-lg">
                        {item.code}
                      </div>
                      <div>
                        <div className="text-xl font-semibold tracking-[-0.035em]">
                          {t(PROTOCOL_INFO[item.key].nameKey)}
                        </div>
                        <div className="mt-2 text-sm leading-6 text-muted-foreground">
                          {t(PROTOCOL_INFO[item.key].descKey)}
                        </div>
                      </div>
                    </div>
                    <Badge variant={active ? "default" : "outline"} className="px-3 py-1">
                      {t(PROTOCOL_INFO[item.key].priceKey)}
                    </Badge>
                  </div>

                  <div className="space-y-2.5">
                    {item.notes.map((note) => (
                      <div
                        key={note}
                        className="rounded-[1.2rem] border border-black/5 bg-white/65 px-4 py-3 text-sm leading-6 text-muted-foreground"
                      >
                        {note}
                      </div>
                    ))}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex justify-end border-t border-black/5 pt-6">
          <Button disabled={!protocol} onClick={() => setStep(2)} className="h-12 px-6">
            {t("common.next")}
          </Button>
        </div>
      </WizardFrame>
    );
  }

  if (step === 2) {
    const orderReady = Boolean(rentalPlan && email && paymentMethod && protocol && !complianceBlocksProtocol);

    return (
      <WizardFrame
        eyebrow="Checkout"
        title={t("rental.selectDurationAndPay")}
        description={protocol ? t(PROTOCOL_INFO[protocol].descKey) : t("rental.protocolSubtitle")}
        stepLabel="2 / 2"
        aside={(
          <WizardAside
            title={isZh ? "订单摘要" : "Order summary"}
            rows={[
              { label: isZh ? "协议" : "Protocol", value: selectedProtocolLabel },
              { label: isZh ? "时长" : "Duration", value: selectedPlanLabel },
              { label: isZh ? "邮箱" : "Email", value: email || "—" },
              {
                label: isZh ? "支付方式" : "Payment",
                value: selectedPaymentLabel,
              },
              { label: isZh ? "合规策略" : "Compliance", value: selectedComplianceLabel },
              { label: isZh ? "总价" : "Total", value: selectedTotal },
            ]}
            footer={(
              <div className="space-y-2">
                {[
                  isZh ? "你将先完成身份建立，再进入支付或兑换。" : "Identity is established before payment or redemption runs.",
                  isZh ? "付款成功后，租用状态会立即切到可交付路径。" : "After success, the rental moves directly into its live delivery state.",
                  isZh ? "拿到配置后即可导出、续费或主动销毁。" : "Once delivered, you can export, renew, or destroy without leaving the flow.",
                ].map((note) => (
                  <div
                    key={note}
                    className="rounded-[1.25rem] border border-black/5 bg-white/75 px-4 py-3 text-sm leading-6 text-muted-foreground"
                  >
                    {note}
                  </div>
                ))}
              </div>
            )}
          />
        )}
      >
        <div className="space-y-7">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>{t("rental.duration")}</Label>
              <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                {isZh ? "Select a plan" : "Select a plan"}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {RENTAL_PLANS.map((plan) => {
                const active = rentalPlan?.id === plan.id;
                return (
                  <button
                    key={plan.id}
                    onClick={() => setRentalPlan(plan)}
                    className={`choice-card min-h-[150px] p-4 text-center ${active ? "choice-card-active" : ""}`}
                  >
                    <div className="text-lg font-semibold tracking-[-0.03em]">{tPlan(plan.id)}</div>
                    <div className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-primary">
                      ${plan.totalPrice.toFixed(2)}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      ${plan.pricePerHour}/{t("time.hour")}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-3">
              <Label>{t("rental.email")}</Label>
              <Input
                type="email"
                placeholder={t("rental.emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 rounded-[1.1rem]"
              />
              <p className="text-xs leading-6 text-muted-foreground">
                {isZh
                  ? "我们会把租用身份和后续节点状态与你的邮箱绑定。"
                  : "Your email anchors the rental identity and future node state."}
              </p>
            </div>

            <div className="space-y-3">
              <Label>{t("rental.paymentMethod")}</Label>
              <div className="grid gap-3 sm:grid-cols-2">
                <PaymentMethodCard
                  active={paymentMethod === "wallet"}
                  title={t("payment.wallet")}
                  body={isZh ? "从测试链钱包余额直接结算，适合常规虚拟货币支付。" : "Settle directly from wallet balance on the test chain."}
                  onClick={() => {
                    setPaymentMethod("wallet");
                    clearRedeemState();
                  }}
                />
                <PaymentMethodCard
                  active={paymentMethod === "x402"}
                  title={t("payment.x402")}
                  body={isZh ? "按 X402 路径记录支付，当前测试服复用测试链结算。" : "Record the payment through the X402-labeled test-chain path."}
                  onClick={() => {
                    setPaymentMethod("x402");
                    clearRedeemState();
                  }}
                />
                <PaymentMethodCard
                  active={paymentMethod === "stripe"}
                  title={t("payment.stripe")}
                  body={isZh ? "适合标准付款与后续续费。" : "Best for standard checkout and later renewals."}
                  onClick={() => {
                    setPaymentMethod("stripe");
                    clearRedeemState();
                  }}
                />
                <PaymentMethodCard
                  active={paymentMethod === "redeem"}
                  title={t("payment.redeemCode")}
                  body={isZh ? "直接匹配兑换码时长并跳过付款。" : "Match a code to duration and skip checkout entirely."}
                  onClick={() => {
                    setPaymentMethod("redeem");
                  }}
                />
              </div>
            </div>
          </section>

          {complianceProfiles.length > 0 && (
            <section className="space-y-3">
              <Label>{isZh ? "合规策略" : "Compliance profile"}</Label>
              <div className="grid gap-3 sm:grid-cols-2">
                {complianceProfiles.map((profile) => {
                  const blocked = Boolean(protocol && profile.blockedProtocols?.includes(protocol));
                  return (
                    <button
                      key={profile.id}
                      onClick={() => setComplianceProfileId(profile.id)}
                      disabled={blocked}
                      className={`choice-card min-h-[112px] text-left disabled:cursor-not-allowed disabled:opacity-50 ${
                        complianceProfileId === profile.id ? "choice-card-active" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-base font-semibold tracking-[-0.02em]">{profile.name}</div>
                          <div className="mt-2 text-sm leading-6 text-muted-foreground">
                            {profile.mode} · {profile.version}
                          </div>
                        </div>
                        <Badge variant={blocked ? "destructive" : "outline"}>
                          {blocked ? (isZh ? "不可用" : "Blocked") : profile.mode}
                        </Badge>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {paymentMethod === "redeem" && (
            <section className="rounded-[1.75rem] border border-black/5 bg-white/70 p-4 md:p-5">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  type="text"
                  placeholder={t("payment.redeemCode.placeholder")}
                  value={redeemCode}
                  onChange={(e) => {
                    setRedeemCode(e.target.value.toUpperCase());
                    setRedeemCodeValid(false);
                    setRedeemCodeError(null);
                  }}
                  disabled={redeemCodeValid}
                  className="h-12 rounded-[1.1rem] uppercase"
                />
                <Button
                  variant="outline"
                  onClick={validateRedeemCode}
                  disabled={redeemCodeValidating || redeemCodeValid || redeemCode.length < 6}
                  className="h-12 px-5"
                >
                  {redeemCodeValidating
                    ? t("common.processing")
                    : redeemCodeValid
                      ? t("payment.redeemCode.valid")
                      : t("payment.redeemCode.validate")}
                </Button>
              </div>

              {redeemCodeError && (
                <p className="mt-3 text-sm text-red-600">{redeemCodeError}</p>
              )}
              {redeemCodeValid && (
                <p className="mt-3 text-sm text-green-600">{t("payment.redeemCode.valid")}</p>
              )}
            </section>
          )}

          <section className="rounded-[1.75rem] border border-black/5 bg-white/72 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm font-semibold tracking-[-0.02em]">
                {isZh ? "最终确认" : "Final confirmation"}
              </div>
              <Badge variant="outline" className="px-3 py-1">
                {selectedPaymentLabel}
              </Badge>
            </div>
            <div className="space-y-3 text-sm">
              <SummaryRow label={t("rental.protocol")} value={selectedProtocolLabel} />
              <SummaryRow label={t("rental.duration")} value={selectedPlanLabel} />
              <SummaryRow label={t("rental.email")} value={email || "—"} />
              <SummaryRow label={isZh ? "合规策略" : "Compliance"} value={selectedComplianceLabel} />
              <SummaryRow label={t("rental.total")} value={selectedTotal} emphasize />
            </div>
          </section>
        </div>

        {error && (
          <div className="rounded-[1.45rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-black/5 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <Button
            variant="outline"
            onClick={() => {
              setStep(1);
              setError(null);
            }}
            className="h-12 px-6"
          >
            {t("common.back")}
          </Button>
          <Button
            disabled={!orderReady || processing || (paymentMethod === "redeem" && !redeemCodeValid)}
            onClick={async () => {
              if (!protocol || !rentalPlan || !paymentMethod) {
                return;
              }

              setProcessing(true);
              setError(null);

              try {
                const authRes = await workerFetch("/api/auth/register", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ email }),
                });
                const authData = await authRes.json();
                if (authData.error) {
                  setError(authData.error);
                  setStatus("failed");
                  setProcessing(false);
                  return;
                }

                setAuth(authData.userId, authData.token, email, Boolean(authData.isAdmin));

                if (paymentMethod === "stripe") {
                  saveStateForRedirect();
                  const res = await workerFetch("/api/payment/checkout", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      protocol,
                      durationHours: rentalPlan.durationHours,
                      email,
                      complianceProfileId,
                    }),
                  });
                  const data = await res.json();
                  if (data.error) {
                    setError(data.error);
                    setStatus("failed");
                  } else if (data.url) {
                    window.location.href = data.url;
                    return;
                  }
                } else if (paymentMethod === "wallet" || paymentMethod === "x402") {
                  const authState = useAuthStore.getState();
                  const res = await workerFetch("/api/rental", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${authState.token}`,
                    },
                    body: JSON.stringify({
                      protocol,
                      durationHours: rentalPlan.durationHours,
                      paymentMethod,
                      complianceProfileId,
                    }),
                  });
                  const data = await res.json();
                  if (data.error) {
                    setError(data.error);
                    setStatus("failed");
                  } else {
                    setRentalId(data.rentalId);
                    setRemainingMinutes(rentalPlan.durationHours * 60);
                    setRentalStatus("active");
                    setStatus("success");
                  }
                } else {
                  const authState = useAuthStore.getState();
                  const res = await workerFetch("/api/redeem", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${authState.token}`,
                    },
                    body: JSON.stringify({
                      protocol,
                      code: redeemCode,
                      complianceProfileId,
                    }),
                  });
                  const data = await res.json();
                  if (data.error) {
                    setError(data.error);
                    setStatus("failed");
                  } else {
                    setRentalId(data.rentalId);
                    setRemainingMinutes(data.durationHours * 60);
                    setRentalStatus("active");
                    setStatus("success");
                  }
                }
              } catch (e: unknown) {
                const message = e instanceof Error ? e.message : t("common.error.generic");
                setError(message);
                setStatus("failed");
              }

              setProcessing(false);
            }}
            className="h-12 px-6"
          >
            {processing ? t("common.processing") : t("rental.payAndDeploy")}
          </Button>
        </div>
      </WizardFrame>
    );
  }

  if (status === "running") {
    return (
      <Card className="animate-rise mx-auto max-w-3xl space-y-6 p-6 md:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="section-eyebrow">{isZh ? "Provisioning" : "Provisioning"}</div>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.045em] md:text-4xl">
              {t("rental.creatingNode")}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
              {isZh
                ? "支付已经确认，系统正在创建独享节点并准备客户端配置。"
                : "Payment is confirmed. The system is now creating the exclusive node and preparing client-ready output."}
            </p>
          </div>
          <div className="metric-pill self-start">Live</div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <StatusLine state="done" label={t("rental.paymentConfirmed")} />
          <StatusLine state="running" label={t("rental.creatingVPS")} />
          <StatusLine state="pending" label={t("rental.generatingConfig")} />
        </div>

        <div className="rounded-[1.7rem] border border-black/5 bg-white/75 p-5 text-sm leading-7 text-muted-foreground">
          {t("rental.estimatedTime")}
        </div>
      </Card>
    );
  }

  if (status === "failed" && error) {
    return (
      <Card className="animate-rise mx-auto max-w-xl space-y-5 p-8 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-red-50 text-xl font-semibold text-red-600">
          !
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-[-0.035em]">{t("rental.deployFailed")}</h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">{error}</p>
        </div>
        <Button
          onClick={() => {
            setStatus("pending");
            setError(null);
            setStep(1);
          }}
        >
          {t("common.retry")}
        </Button>
      </Card>
    );
  }

  return null;
}

function WizardFrame({
  eyebrow,
  title,
  description,
  stepLabel,
  children,
  aside,
}: {
  eyebrow: string;
  title: string;
  description: string;
  stepLabel: string;
  children: React.ReactNode;
  aside: React.ReactNode;
}) {
  return (
    <div className="animate-rise grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="space-y-7 p-6 md:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="section-eyebrow">{eyebrow}</div>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.045em] md:text-4xl">{title}</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{description}</p>
          </div>
          <div className="metric-pill self-start">{stepLabel}</div>
        </div>
        {children}
      </Card>
      <div className="space-y-4">{aside}</div>
    </div>
  );
}

function WizardAside({
  title,
  rows,
  footer,
}: {
  title: string;
  rows: Array<{ label: string; value: string }>;
  footer?: React.ReactNode;
}) {
  return (
    <Card className="space-y-5 p-5">
      <div>
        <div className="section-eyebrow">Snapshot</div>
        <h3 className="mt-2 text-xl font-semibold tracking-[-0.03em]">{title}</h3>
      </div>
      <div className="space-y-3">
        {rows.map((row) => (
          <SummaryRow key={row.label} label={row.label} value={row.value} />
        ))}
      </div>
      {footer}
    </Card>
  );
}

function PaymentMethodCard({
  active,
  title,
  body,
  onClick,
}: {
  active: boolean;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className={`choice-card min-h-[138px] text-left ${active ? "choice-card-active" : ""}`}>
      <div className="space-y-3">
        <div className="text-base font-semibold tracking-[-0.02em]">{title}</div>
        <div className="text-sm leading-6 text-muted-foreground">{body}</div>
      </div>
    </button>
  );
}

function SummaryRow({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[1.2rem] border border-black/5 bg-white/70 px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-right text-sm ${emphasize ? "font-semibold text-primary" : "font-medium text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}

function StatusLine({
  state,
  label,
}: {
  state: "done" | "running" | "pending";
  label: string;
}) {
  const marker =
    state === "done" ? "bg-green-500" : state === "running" ? "bg-primary" : "bg-black/10";

  return (
    <div className="flex items-center gap-3 rounded-[1.5rem] border border-black/5 bg-white/70 px-4 py-4">
      <span className={`h-2.5 w-2.5 rounded-full ${marker}`} />
      <span className={`text-sm ${state === "running" ? "font-medium text-foreground" : "text-muted-foreground"}`}>
        {label}
      </span>
    </div>
  );
}
