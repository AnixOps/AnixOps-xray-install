"use client";

import { useMemo, useState } from "react";
import { useDeployStore } from "@/lib/deploy/store";
import { useAuthStore } from "@/lib/auth/store";
import { PROVIDER_INFO, PROTOCOL_INFO } from "@/lib/deploy/types";
import { useLocaleStore } from "@/lib/i18n/store";
import { Button, Input, Label, Card } from "@/components/ui";
import { encodeBase64Text, generateHysteria2Config, generateVlessRealityConfig } from "@/lib/config/generator";

export function SelfHostedWizard() {
  const step = useDeployStore((s) => s.step);
  const deployMethod = useDeployStore((s) => s.deployMethod);
  const provider = useDeployStore((s) => s.provider);
  const apiKey = useDeployStore((s) => s.apiKey);
  const region = useDeployStore((s) => s.region);
  const plan = useDeployStore((s) => s.plan);
  const dnsToken = useDeployStore((s) => s.dnsToken);
  const domain = useDeployStore((s) => s.domain);
  const protocol = useDeployStore((s) => s.protocol);
  const serverIp = useDeployStore((s) => s.serverIp);
  const sshPort = useDeployStore((s) => s.sshPort);
  const sshPassword = useDeployStore((s) => s.sshPassword);
  const cleanupMode = useDeployStore((s) => s.cleanupMode);
  const cleanupHours = useDeployStore((s) => s.cleanupHours);
  const cleanupAtInput = useDeployStore((s) => s.cleanupAtInput);
  const status = useDeployStore((s) => s.status);
  const steps = useDeployStore((s) => s.steps);
  const config = useDeployStore((s) => s.config);
  const error = useDeployStore((s) => s.error);
  const [deployLogs, setDeployLogs] = useState<Array<{ ts: string; level: string; message: string }>>([]);
  const token = useAuthStore((s) => s.token);

  const setStep = useDeployStore((s) => s.setStep);
  const setDeployMethod = useDeployStore((s) => s.setDeployMethod);
  const setProvider = useDeployStore((s) => s.setProvider);
  const setApiKey = useDeployStore((s) => s.setApiKey);
  const setRegion = useDeployStore((s) => s.setRegion);
  const setPlan = useDeployStore((s) => s.setPlan);
  const setDnsToken = useDeployStore((s) => s.setDnsToken);
  const setDomain = useDeployStore((s) => s.setDomain);
  const setProtocol = useDeployStore((s) => s.setProtocol);
  const setServerIp = useDeployStore((s) => s.setServerIp);
  const setSshPort = useDeployStore((s) => s.setSshPort);
  const setSshPassword = useDeployStore((s) => s.setSshPassword);
  const setCleanupMode = useDeployStore((s) => s.setCleanupMode);
  const setCleanupHours = useDeployStore((s) => s.setCleanupHours);
  const setCleanupAtInput = useDeployStore((s) => s.setCleanupAtInput);
  const setStatus = useDeployStore((s) => s.setStatus);
  const updateStep = useDeployStore((s) => s.updateStep);
  const setConfig = useDeployStore((s) => s.setConfig);
  const setError = useDeployStore((s) => s.setError);
  const reset = useDeployStore((s) => s.reset);
  const { t, locale } = useLocaleStore();
  const localText = {
    cleanupTitle: locale === "zh" ? "自动清理" : "Auto cleanup",
    cleanupModeDuration: locale === "zh" ? "按时长" : "After duration",
    cleanupModeDatetime: locale === "zh" ? "指定时间" : "At exact time",
    cleanupHours: locale === "zh" ? "保留小时数" : "Keep alive hours",
    cleanupHoursHint: locale === "zh" ? "支持小数，例如 0.5 表示 30 分钟" : "Decimal values are allowed. Example: 0.5 means 30 minutes.",
    cleanupDatetime: locale === "zh" ? "清理时间" : "Cleanup time",
    cleanupDatetimeHint: locale === "zh" ? "到期后将停止服务并清理 Xray/Hysteria 痕迹" : "When reached, the server timer stops services and wipes Xray/Hysteria traces.",
    cleanupReview: locale === "zh" ? "自动清理" : "Auto cleanup",
    shareTitle: locale === "zh" ? "节点链接" : "Node link",
    copyRaw: locale === "zh" ? "复制原始链接" : "Copy raw link",
    copyBase64: locale === "zh" ? "复制 Base64" : "Copy Base64",
  };
  const generatedShareLink = useMemo(() => {
    if (!config?.protocol || !config.ip || !config.port) {
      return null;
    }

    if (config.protocol === "vless-reality" && config.uuid && config.serverName && config.publicKey && config.shortId) {
      return generateVlessRealityConfig({
        ip: config.ip,
        port: Number(config.port),
        uuid: config.uuid,
        serverName: config.serverName,
        publicKey: config.publicKey,
        shortId: config.shortId,
      }).v2rayN;
    }

    if (config.protocol === "hysteria2" && config.password) {
      return generateHysteria2Config({
        ip: config.ip,
        port: Number(config.port),
        password: config.password,
        obfs: config.obfs,
        insecure: config.insecure !== "false",
      }).v2rayN;
    }

    return null;
  }, [config]);
  const encodedShareLink = generatedShareLink ? encodeBase64Text(generatedShareLink) : null;

  if (status === "running") {
    return (
      <Card className="p-6 space-y-4">
        <h2 className="text-lg font-semibold">{t("selfhosted.deploying")}</h2>
        <p className="text-sm text-muted-foreground">{t("selfhosted.deploying.note")}</p>
        {steps.map((s) => (
          <div key={s.id} className="flex items-center gap-3 text-sm">
            <span>{s.status === "success" ? "✅" : s.status === "running" ? "⏳" : s.status === "failed" ? "❌" : "⬜"}</span>
            <span className="flex-1">{t(s.label)}</span>
            {s.message && <span className="text-xs text-muted-foreground">{s.message}</span>}
          </div>
        ))}
        {deployLogs.length > 0 && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">Logs</div>
            <div className="max-h-56 space-y-1 overflow-auto font-mono text-xs">
              {deployLogs.map((log, index) => (
                <div key={`${log.ts}-${index}`} className="flex gap-2">
                  <span className="shrink-0 text-muted-foreground">{new Date(log.ts).toLocaleTimeString()}</span>
                  <span className={log.level === "error" ? "text-red-600" : log.level === "warn" ? "text-amber-600" : "text-foreground"}>
                    {log.message}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    );
  }

  if (status === "success" && config) {
    return (
      <Card className="p-6 space-y-4">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl">✓</div>
          <h2 className="text-2xl font-bold text-green-700">{t("selfhosted.success")}</h2>
        </div>
        <div className="rounded-lg bg-muted/40 p-4 text-sm space-y-2">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("selfhosted.summary.protocol")}</span>
            <span>{String(config.protocol ?? "")}</span>
          </div>
          {config.ip && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("selfhosted.summary.connection")}</span>
              <span className="font-mono text-xs">{String(config.ip)}:{String(config.port ?? "")}</span>
            </div>
          )}
          {config.cleanupAt && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("selfhosted.summary.cleanupAt")}</span>
              <span>{String(config.cleanupAt)}</span>
            </div>
          )}
          {config.cleanupMode && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("selfhosted.summary.cleanupMode")}</span>
              <span>{String(config.cleanupMode)}</span>
            </div>
          )}
          {config.cleanupTimerName && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("selfhosted.summary.cleanupTimer")}</span>
              <span className="font-mono text-xs">{String(config.cleanupTimerName)}</span>
            </div>
          )}
        </div>
        <div className="space-y-2 text-sm">
          {Object.entries(config).map(([key, value]) => (
            <div key={key} className="flex justify-between">
              <span className="text-muted-foreground">{key}</span>
              <span className="font-mono text-xs">{value}</span>
            </div>
          ))}
        </div>
        {generatedShareLink && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
            <div className="text-sm font-medium">{localText.shareTitle}</div>
            <div className="break-all font-mono text-xs">{generatedShareLink}</div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => navigator.clipboard?.writeText(generatedShareLink)}
              >
                {localText.copyRaw}
              </Button>
              <Button
                variant="outline"
                onClick={() => encodedShareLink && navigator.clipboard?.writeText(encodedShareLink)}
              >
                {localText.copyBase64}
              </Button>
            </div>
            {encodedShareLink && (
              <div className="break-all font-mono text-xs text-muted-foreground">{encodedShareLink}</div>
            )}
          </div>
        )}
        <div className="flex justify-end">
          <Button variant="outline" onClick={reset}>{t("common.back")}</Button>
        </div>
      </Card>
    );
  }

  if (status === "failed") {
    return (
      <Card className="p-6 space-y-4">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-red-600">{t("selfhosted.failed")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <div className="mt-4 space-x-2">
            <Button variant="outline" onClick={() => { setStatus("pending"); setStep(1); }}>
              {t("common.retry")}
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  // Step 1: Connection Method + Credentials
  if (step === 1) {
    const isApi = deployMethod === "api";
    const isSsh = deployMethod === "ssh";
    const canProceed = isApi
      ? provider && apiKey && region && plan
      : isSsh && serverIp && sshPassword;

    return (
      <Card className="p-6 space-y-6">
        <h2 className="text-lg font-semibold">{t("selfhosted.step1.title")}</h2>

        {/* Deploy method selection */}
        <div>
          <Label>{t("selfhosted.connectionMethod")}</Label>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <button
              onClick={() => { setDeployMethod("api"); setProvider(null); setApiKey(""); setRegion(""); setPlan(""); }}
              className={`rounded-lg border-2 p-4 text-left transition-all ${
                isApi ? "border-primary bg-primary/5" : "border-border text-muted-foreground hover:border-primary/50"
              }`}
            >
              <div className="font-medium">{t("selfhosted.method.api")}</div>
              <div className="text-xs text-muted-foreground">{t("selfhosted.method.api.desc")}</div>
            </button>
            <button
              onClick={() => setDeployMethod("ssh")}
              className={`rounded-lg border-2 p-4 text-left transition-all ${
                isSsh ? "border-primary bg-primary/5" : "border-border text-muted-foreground hover:border-primary/50"
              }`}
            >
              <div className="font-medium">{t("selfhosted.method.ssh")}</div>
              <div className="text-xs text-muted-foreground">{t("selfhosted.method.ssh.desc")}</div>
            </button>
          </div>
        </div>

        {/* API mode: cloud provider selection */}
        {isApi && (
          <>
            <div>
              <Label>{t("selfhosted.provider")}</Label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {(["vultr", "digitalocean", "aws"] as const).map((key) => (
                  <button
                    key={key}
                    onClick={() => setProvider(key)}
                    className={`rounded-lg border-2 p-3 text-center text-sm font-medium transition-all ${
                      provider === key ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    {PROVIDER_INFO[key].name}
                  </button>
                ))}
              </div>
            </div>

            {provider && (
              <>
                <div>
                  <Label>{t("selfhosted.apikey.label")}</Label>
                  <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={provider === "aws" ? "AKIA...:wJalr..." : t("selfhosted.apikey.placeholder")} className="mt-1" />
                  {provider === "aws" && <p className="mt-1 text-xs text-muted-foreground">{t("selfhosted.awsKeyFormat")}</p>}
                </div>
                <div>
                  <Label>{t("selfhosted.region")}</Label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {PROVIDER_INFO[provider].regions.map((r) => (
                      <button key={r.id} onClick={() => setRegion(r.id)}
                        className={`rounded-full border px-3 py-1 text-sm transition-all ${region === r.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}
                      >{t(r.nameKey)}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label>{t("selfhosted.plan")}</Label>
                  <div className="mt-2 space-y-2">
                    {PROVIDER_INFO[provider].plans.map((p) => (
                      <button key={p.id} onClick={() => setPlan(p.id)}
                        className={`w-full rounded-lg border-2 p-3 text-left transition-all ${plan === p.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{p.name}</span>
                          <span className="text-sm text-primary">{t(p.priceKey)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* SSH mode: direct connect */}
        {isSsh && (
          <>
            <div>
              <Label>{t("selfhosted.serverIp.label")}</Label>
              <Input value={serverIp} onChange={(e) => setServerIp(e.target.value)} placeholder={t("selfhosted.serverIp.placeholder")} className="mt-1" />
            </div>
            <div>
              <Label>{t("selfhosted.sshPort.label")}</Label>
              <Input type="number" value={sshPort} onChange={(e) => setSshPort(Number(e.target.value))} className="mt-1" />
            </div>
            <div>
              <Label>{t("selfhosted.sshPassword.label")}</Label>
              <Input type="password" value={sshPassword} onChange={(e) => setSshPassword(e.target.value)} placeholder={t("selfhosted.sshPassword.placeholder")} className="mt-1" />
              <p className="mt-1 text-xs text-muted-foreground">{t("selfhosted.sshPasswordHint")}</p>
            </div>
          </>
        )}

        <div className="flex justify-end">
          <Button disabled={!canProceed} onClick={() => setStep(2)}>{t("common.next")}</Button>
        </div>
      </Card>
    );
  }

  // Step 2: Domain & Protocol
  if (step === 2) {
    // VLESS Reality doesn't need a domain
    const hasCleanupValue = cleanupMode === "duration"
      ? cleanupHours.trim().length > 0
      : cleanupAtInput.trim().length > 0;
    const canProceed = (protocol === "vless-reality" || domain) && protocol && hasCleanupValue;
    return (
      <Card className="p-6 space-y-6">
        <h2 className="text-lg font-semibold">{t("selfhosted.step2.title")}</h2>

        <div>
          <Label>{t("selfhosted.domain.label")}</Label>
          <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder={t("selfhosted.domain.placeholder")} className="mt-1" />
        </div>

        <div>
          <Label>{t("selfhosted.dns.label")}</Label>
          <Input type="password" value={dnsToken} onChange={(e) => setDnsToken(e.target.value)} placeholder={t("selfhosted.dns.placeholder")} className="mt-1" />
        </div>

        <div>
          <Label>{t("selfhosted.protocol")}</Label>
          <div className="mt-2 space-y-2">
            {(["vless-reality", "hysteria2"] as const).map((key) => (
              <button key={key} onClick={() => setProtocol(key)}
                className={`w-full rounded-lg border-2 p-4 text-left transition-all ${protocol === key ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">{PROTOCOL_INFO[key].icon}</span>
                  <div>
                    <div className="font-medium">{t(PROTOCOL_INFO[key].nameKey)}</div>
                    <div className="text-sm text-muted-foreground">{t(PROTOCOL_INFO[key].descKey)}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
          <Label>{localText.cleanupTitle}</Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setCleanupMode("duration")}
              className={`rounded-lg border px-3 py-2 text-sm transition-all ${
                cleanupMode === "duration" ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-primary/50"
              }`}
            >
              {localText.cleanupModeDuration}
            </button>
            <button
              onClick={() => setCleanupMode("datetime")}
              className={`rounded-lg border px-3 py-2 text-sm transition-all ${
                cleanupMode === "datetime" ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-primary/50"
              }`}
            >
              {localText.cleanupModeDatetime}
            </button>
          </div>
          {cleanupMode === "duration" ? (
            <div>
              <Label>{localText.cleanupHours}</Label>
              <Input
                type="number"
                min="0.1"
                step="0.5"
                value={cleanupHours}
                onChange={(e) => setCleanupHours(e.target.value)}
                className="mt-1"
              />
              <p className="mt-1 text-xs text-muted-foreground">{localText.cleanupHoursHint}</p>
            </div>
          ) : (
            <div>
              <Label>{localText.cleanupDatetime}</Label>
              <Input
                type="datetime-local"
                value={cleanupAtInput}
                onChange={(e) => setCleanupAtInput(e.target.value)}
                className="mt-1"
              />
              <p className="mt-1 text-xs text-muted-foreground">{localText.cleanupDatetimeHint}</p>
            </div>
          )}
        </div>

        <div className="flex justify-between">
          <Button variant="outline" onClick={() => setStep(1)}>{t("common.back")}</Button>
          <Button disabled={!canProceed} onClick={() => setStep(3)}>{t("common.next")}</Button>
        </div>
      </Card>
    );
  }

  // Step 3: Review & Deploy
  if (step === 3) {
    const isApi = deployMethod === "api";
    const providerInfo = isApi && provider ? PROVIDER_INFO[provider] : null;
    const regionName = providerInfo ? t(providerInfo.regions.find((r) => r.id === region)?.nameKey || "") : "";
    const planInfo = providerInfo?.plans.find((p) => p.id === plan);
    const cleanupSummary = cleanupMode === "duration"
      ? `${cleanupHours || "24"}h`
      : (cleanupAtInput || "-");

    const handleDeploy = async () => {
      if (!token) {
        setError("Unauthorized");
        setStatus("failed");
        return;
      }

      setStatus("running");
      try {
        updateStep({ stepId: "provision", status: "running", message: t("selfhosted.step.provision") });

        const body: Record<string, unknown> = {
          deployMethod,
          protocol,
          domain,
          dnsToken,
          ...(cleanupMode === "duration"
            ? { cleanupHours: cleanupHours ? Number(cleanupHours) : undefined }
            : { cleanupAt: cleanupAtInput ? new Date(cleanupAtInput).toISOString() : undefined }),
        };
        if (isApi) {
          Object.assign(body, { provider, apiKey, region, plan });
        } else {
          Object.assign(body, { serverIp, sshPort, sshPassword });
        }

        // Call the real self-hosted deploy API
        const response = await fetch("/api/self-hosted", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || t("selfhosted.error.generic"));
        }

        const data = await response.json();
        const deployId = data.deployId;

        // Poll for deployment status
        let attempts = 0;
        const maxAttempts = 120; // 10 minutes at 5s intervals

        while (attempts < maxAttempts) {
          await new Promise((r) => setTimeout(r, 5000));
          attempts++;

          const statusRes = await fetch(`/api/self-hosted/${deployId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const statusData = await statusRes.json();
          setDeployLogs(statusData.logs || []);

          if (!statusRes.ok) {
            throw new Error(statusData.error || t("selfhosted.error.generic"));
          }

          if (statusData.status === "success") {
            updateStep({ stepId: "config", status: "success", message: t("selfhosted.step.config.ready") });
            setConfig(statusData.config);
            setStatus("success");
            return;
          }

          if (statusData.status === "failed") {
            throw new Error(statusData.error || t("selfhosted.error.generic"));
          }

          // Update progress based on deployment phase
          if (statusData.progress >= 33) {
            updateStep({ stepId: "provision", status: "success", message: t("selfhosted.step.provision.ready") });
          }
          if (statusData.progress >= 66) {
            updateStep({ stepId: "deploy", status: "running", message: t("selfhosted.step.deploy.pushing") });
          }
          if (statusData.progress >= 90) {
            updateStep({ stepId: "deploy", status: "success", message: t("selfhosted.step.deploy.done") });
          }
        }

        throw new Error(t("selfhosted.error.timeout"));
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : t("selfhosted.error.generic");
        setError(message);
        setStatus("failed");
      }
    };

    return (
      <Card className="p-6 space-y-6">
        <h2 className="text-lg font-semibold">{t("selfhosted.step3.title")}</h2>

        <div className="space-y-2 rounded-lg bg-muted/50 p-4 text-sm">
          {isApi ? (
            <>
              <div className="flex justify-between"><span className="text-muted-foreground">{t("selfhosted.review.provider")}</span><span>{providerInfo?.name}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t("selfhosted.review.region")}</span><span>{regionName}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t("selfhosted.review.plan")}</span><span>{planInfo?.name}</span></div>
            </>
          ) : (
            <>
              <div className="flex justify-between"><span className="text-muted-foreground">{t("selfhosted.serverIp.label")}</span><span className="font-mono">{serverIp}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t("selfhosted.sshPort.label")}</span><span>{sshPort}</span></div>
            </>
          )}
          <div className="flex justify-between"><span className="text-muted-foreground">{t("selfhosted.review.protocol")}</span><span>{protocol ? t(`protocol.${protocol}`) : ""}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">{localText.cleanupReview}</span><span>{cleanupSummary}</span></div>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          {t("selfhosted.review.warning")}
        </div>

        <div className="flex justify-between">
          <Button variant="outline" onClick={() => setStep(2)}>{t("common.back")}</Button>
          <Button onClick={handleDeploy} className="bg-green-600 hover:bg-green-700">{t("selfhosted.review.deploy")}</Button>
        </div>
      </Card>
    );
  }

  return null;
}
