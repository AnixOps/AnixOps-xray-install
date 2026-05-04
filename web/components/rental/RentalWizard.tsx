"use client";

import { useDeployStore } from "@/lib/deploy/store";
import { useAuthStore } from "@/lib/auth/store";
import { useLocaleStore } from "@/lib/i18n/store";
import { PROTOCOL_INFO, RENTAL_PLANS } from "@/lib/deploy/types";
import { Button, Card, Badge } from "@/components/ui";
import { workerFetch } from "@/lib/api/client";
import { useState, useEffect } from "react";

const SESSION_KEY = "rental-wizard-state";

export function RentalWizard() {
  const step = useDeployStore((s) => s.step);
  const protocol = useDeployStore((s) => s.protocol);
  const rentalPlan = useDeployStore((s) => s.rentalPlan);
  const status = useDeployStore((s) => s.status);
  const error = useDeployStore((s) => s.error);
  const rentalId = useDeployStore((s) => s.rentalId);

  const setStep = useDeployStore((s) => s.setStep);
  const setProtocol = useDeployStore((s) => s.setProtocol);
  const setRentalPlan = useDeployStore((s) => s.setRentalPlan);
  const setStatus = useDeployStore((s) => s.setStatus);
  const setRentalId = useDeployStore((s) => s.setRentalId);
  const setRemainingMinutes = useDeployStore((s) => s.setRemainingMinutes);
  const setError = useDeployStore((s) => s.setError);
  const reset = useDeployStore((s) => s.reset);

  const setAuth = useAuthStore((s) => s.setAuth);
  const { t, tPlan } = useLocaleStore();

  const [email, setEmail] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"stripe" | "redeem" | null>(null);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemCodeValidating, setRedeemCodeValidating] = useState(false);
  const [redeemCodeValid, setRedeemCodeValid] = useState(false);
  const [redeemCodeError, setRedeemCodeError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [restored, setRestored] = useState(false);

  // Restore state from sessionStorage on mount (for returning from Stripe redirect)
  useEffect(() => {
    if (restored) return;
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (saved) {
        const state = JSON.parse(saved);
        if (state.protocol) setProtocol(state.protocol);
        if (state.rentalPlanId) {
          const plan = RENTAL_PLANS.find(p => p.id === state.rentalPlanId);
          if (plan) setRentalPlan(plan);
        }
        if (state.email) setEmail(state.email);
        if (state.step) setStep(state.step);
        sessionStorage.removeItem(SESSION_KEY);
        setRestored(true);
      }
    } catch {
      // Ignore parse errors
    }
    setRestored(true);
  }, [setProtocol, setRentalPlan, setStep, restored]);

  // Save state before Stripe redirect
  const saveStateForRedirect = () => {
    const state = {
      protocol,
      rentalPlanId: rentalPlan?.id,
      email,
      step,
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  };

  // Validate redeem code
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
        // Auto-select matching duration based on code
        const matchingPlan = RENTAL_PLANS.find(p => p.durationHours === data.durationHours);
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

  // Step 1: Protocol selection
  if (step === 1) {
    return (
      <Card className="p-6 space-y-6">
        <h2 className="text-lg font-semibold">{t("rental.selectProtocol")}</h2>
        <p className="text-sm text-muted-foreground">{t("rental.protocolSubtitle")}</p>

        <div className="space-y-3">
          {(["vless-reality", "hysteria2"] as const).map((key) => (
            <button key={key} onClick={() => setProtocol(key)}
              className={`w-full rounded-lg border-2 p-4 text-left transition-all ${protocol === key ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{PROTOCOL_INFO[key].icon}</span>
                  <div>
                    <div className="font-semibold">{t(PROTOCOL_INFO[key].nameKey)}</div>
                    <div className="text-sm text-muted-foreground">{t(PROTOCOL_INFO[key].descKey)}</div>
                  </div>
                </div>
                <div className="text-right">
                  <Badge variant={protocol === key ? "default" : "outline"}>{t(PROTOCOL_INFO[key].priceKey)}</Badge>
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="flex justify-end">
          <Button disabled={!protocol} onClick={() => setStep(2)}>{t("common.next")}</Button>
        </div>
      </Card>
    );
  }

  // Step 2: Duration & Payment
  if (step === 2) {
    return (
      <Card className="p-6 space-y-6">
        <h2 className="text-lg font-semibold">{t("rental.selectDurationAndPay")}</h2>

        <div className="grid grid-cols-2 gap-3">
          {RENTAL_PLANS.map((plan) => (
            <button key={plan.id} onClick={() => setRentalPlan(plan)}
              className={`rounded-lg border-2 p-4 text-center transition-all ${rentalPlan?.id === plan.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
            >
              <div className="text-lg font-semibold">{tPlan(plan.id)}</div>
              <div className="mt-1 text-sm text-muted-foreground">${plan.totalPrice.toFixed(2)}</div>
              <div className="text-xs text-muted-foreground">${plan.pricePerHour}/{t("time.hour")}</div>
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <h3 className="font-medium">{t("rental.email")}</h3>
          <input
            type="email"
            placeholder={t("rental.emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-3">
          <h3 className="font-medium">{t("rental.paymentMethod")}</h3>
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: "stripe" as const, label: t("payment.stripe") },
              { id: "redeem" as const, label: t("payment.redeemCode") },
            ].map((method) => (
              <button
                key={method.id}
                onClick={() => {
                  setPaymentMethod(method.id);
                  if (method.id !== "redeem") {
                    setRedeemCode("");
                    setRedeemCodeValid(false);
                    setRedeemCodeError(null);
                  }
                }}
                className={`rounded-lg border p-3 text-sm text-center transition-all ${
                  paymentMethod === method.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                }`}
              >
                {method.label}
              </button>
            ))}
          </div>

          {/* Redeem code input */}
          {paymentMethod === "redeem" && (
            <div className="space-y-2 pt-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder={t("payment.redeemCode.placeholder")}
                  value={redeemCode}
                  onChange={(e) => {
                    setRedeemCode(e.target.value.toUpperCase());
                    setRedeemCodeValid(false);
                    setRedeemCodeError(null);
                  }}
                  disabled={redeemCodeValid}
                  className="flex-1 rounded-md border bg-background px-3 py-2 text-sm uppercase"
                />
                <Button
                  variant="outline"
                  onClick={validateRedeemCode}
                  disabled={redeemCodeValidating || redeemCodeValid || redeemCode.length < 6}
                >
                  {redeemCodeValidating ? t("common.processing") : redeemCodeValid ? t("payment.redeemCode.valid") : t("payment.redeemCode.validate")}
                </Button>
              </div>
              {redeemCodeError && (
                <p className="text-sm text-red-600">{redeemCodeError}</p>
              )}
              {redeemCodeValid && (
                <p className="text-sm text-green-600">{t("payment.redeemCode.valid")}</p>
              )}
            </div>
          )}
        </div>

        {rentalPlan && paymentMethod !== "redeem" && (
          <div className="rounded-lg bg-muted/50 p-4 text-sm space-y-1">
            <div className="flex justify-between"><span>{t("rental.protocol")}</span><span>{t(PROTOCOL_INFO[protocol!].nameKey)}</span></div>
            <div className="flex justify-between"><span>{t("rental.duration")}</span><span>{tPlan(rentalPlan.id)}</span></div>
            <div className="flex justify-between font-semibold"><span>{t("rental.total")}</span><span className="text-primary">${rentalPlan.totalPrice.toFixed(2)}</span></div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="flex justify-between">
          <Button variant="outline" onClick={() => { setStep(1); setError(null); }}>{t("common.back")}</Button>
          <Button
            disabled={!rentalPlan || !email || !paymentMethod || processing || (paymentMethod === "redeem" && !redeemCodeValid)}
            onClick={async () => {
              setProcessing(true);
              setError(null);
              try {
                // Register user (handles both new and existing — returns token either way)
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
                setRegistered(true);

                if (paymentMethod === "stripe") {
                  // Save state before redirect
                  saveStateForRedirect();
                  // Call Stripe checkout
                  const res = await workerFetch("/api/payment/checkout", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      protocol,
                      durationHours: rentalPlan!.durationHours,
                      email,
                    }),
                  });
                  const data = await res.json();
                  if (data.error) {
                    setError(data.error);
                    setStatus("failed");
                  } else if (data.url) {
                    // Redirect to Stripe checkout
                    window.location.href = data.url;
                    return;
                  }
                } else if (paymentMethod === "redeem") {
                  // Redeem code payment
                  const authState = useAuthStore.getState();
                  const res = await workerFetch("/api/redeem", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "Authorization": `Bearer ${authState.token}`,
                    },
                    body: JSON.stringify({
                      protocol,
                      code: redeemCode,
                    }),
                  });
                  const data = await res.json();
                  if (data.error) {
                    setError(data.error);
                    setStatus("failed");
                  } else {
                    setRentalId(data.rentalId);
                    setRemainingMinutes(data.durationHours * 60);
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
          >
            {processing ? t("common.processing") : t("rental.payAndDeploy")}
          </Button>
        </div>
      </Card>
    );
  }

  // Deploying state
  if (status === "running") {
    return (
      <Card className="p-6 space-y-4 text-center">
        <div className="text-3xl animate-pulse">⚡</div>
        <h2 className="text-lg font-semibold">{t("rental.creatingNode")}</h2>
        <div className="space-y-2 text-sm text-muted-foreground">
          <div>✅ {t("rental.paymentConfirmed")}</div>
          <div className="animate-pulse">⏳ {t("rental.creatingVPS")}</div>
          <div>⬜ {t("rental.generatingConfig")}</div>
        </div>
        <p className="text-xs text-muted-foreground">{t("rental.estimatedTime")}</p>
      </Card>
    );
  }

  if (status === "failed" && error) {
    return (
      <Card className="p-6 space-y-4 text-center">
        <div className="text-3xl">❌</div>
        <h2 className="text-lg font-semibold">{t("rental.deployFailed")}</h2>
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button onClick={() => { setStatus("pending"); setError(null); setStep(1); }}>{t("common.retry")}</Button>
      </Card>
    );
  }

  return null;
}
