"use client";

import { useMemo, useState } from "react";
import { useDeployStore } from "@/lib/deploy/store";
import { useAuthStore } from "@/lib/auth/store";
import { PROVIDER_INFO, PROTOCOL_INFO } from "@/lib/deploy/types";
import { useLocaleStore } from "@/lib/i18n/store";
import { WizardAside, WizardFrame, WizardSummaryRow as SummaryRow } from "@/components/layout/WizardLayout";
import { Button, Input, Label, Card, Badge } from "@/components/ui";
import {
  encodeBase64Text,
  generateHysteria2Config,
  generateVlessRealityConfig,
} from "@/lib/config/generator";

export function SelfHostedWizard() {
  const step = useDeployStore((s) => s.step);
  const deployMethod = useDeployStore((s) => s.deployMethod);
  const provider = useDeployStore((s) => s.provider);
  const apiKey = useDeployStore((s) => s.apiKey);
  const region = useDeployStore((s) => s.region);
  const plan = useDeployStore((s) => s.plan);
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
  const isZh = locale === "zh";

  const localText = {
    cleanupTitle: isZh ? "自动清理" : "Auto cleanup",
    cleanupModeDuration: isZh ? "按时长" : "After duration",
    cleanupModeDatetime: isZh ? "指定时间" : "At exact time",
    cleanupHours: isZh ? "保留小时数" : "Keep alive hours",
    cleanupHoursHint: isZh
      ? "支持小数，例如 0.5 表示 30 分钟。"
      : "Decimal values are allowed. For example, 0.5 means 30 minutes.",
    cleanupDatetime: isZh ? "清理时间" : "Cleanup time",
    cleanupDatetimeHint: isZh
      ? "到期后会停止服务并清理 Xray 或 Hysteria 痕迹。"
      : "When the time is reached, services stop and Xray or Hysteria traces are removed.",
    cleanupReview: isZh ? "自动清理" : "Auto cleanup",
    shareTitle: isZh ? "节点链接" : "Node link",
    copyRaw: isZh ? "复制原始链接" : "Copy raw link",
    copyBase64: isZh ? "复制 Base64" : "Copy Base64",
  };

  const generatedShareLink = useMemo(() => {
    if (!config?.protocol || !config.ip || !config.port) {
      return null;
    }

    if (
      config.protocol === "vless-reality" &&
      config.uuid &&
      config.serverName &&
      config.publicKey &&
      config.shortId
    ) {
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
        port: config.port,
        password: config.password,
        obfs: config.obfs,
        domain: config.domain,
        insecure: config.insecure !== "false",
      }).v2rayN;
    }

    return null;
  }, [config]);

  const encodedShareLink = generatedShareLink ? encodeBase64Text(generatedShareLink) : null;

  const providerInfo = deployMethod === "api" && provider ? PROVIDER_INFO[provider] : null;
  const regionName = providerInfo
    ? t(providerInfo.regions.find((item) => item.id === region)?.nameKey || "")
    : "";
  const planInfo = providerInfo?.plans.find((item) => item.id === plan);
  const cleanupSummary =
    cleanupMode === "duration" ? `${cleanupHours || "24"}h` : cleanupAtInput || "—";

  const snapshotRows = [
    {
      label: isZh ? "接入方式" : "Access",
      value:
        deployMethod === "api"
          ? t("selfhosted.method.api")
          : deployMethod === "ssh"
            ? t("selfhosted.method.ssh")
            : "—",
    },
    {
      label: isZh ? "供应商 / 主机" : "Provider / host",
      value:
        deployMethod === "api"
          ? providerInfo?.name || "—"
          : serverIp || "—",
    },
    {
      label: t("selfhosted.review.protocol"),
      value: protocol ? t(PROTOCOL_INFO[protocol].nameKey) : "—",
    },
    {
      label: localText.cleanupReview,
      value: cleanupSummary,
    },
  ];

  const checklist = isZh
    ? [
        "连接方式和凭据放在同一步，减少来回切换。",
        "协议、域名和清理策略作为同一个交付面审阅。",
        "部署前单独强调费用与回滚风险。",
      ]
    : [
        "Connection path and credentials stay in one place to reduce context switching.",
        "Protocol, connectivity, and cleanup policy are reviewed as one delivery surface.",
        "Cost and rollback risk are isolated before deployment starts.",
      ];

  if (status === "running") {
    return (
      <div className="animate-rise grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="space-y-6 p-6 md:p-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="section-eyebrow">Deployment</div>
              <h2 className="mt-3 text-3xl font-semibold md:text-4xl">
                {t("selfhosted.deploying")}
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
                {t("selfhosted.deploying.note")}
              </p>
            </div>
            <div className="metric-pill self-start">Live</div>
          </div>

          <div className="space-y-3">
            {steps.map((item) => (
              <StatusStep
                key={item.id}
                status={item.status}
                label={t(item.label)}
                message={item.message}
              />
            ))}
          </div>

          {deployLogs.length > 0 && (
            <div className="rounded-[1.7rem] border border-black/5 bg-white/75 p-4">
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Logs
              </div>
              <div className="code-block max-h-64 space-y-1 overflow-auto">
                {deployLogs.map((log, index) => (
                  <div key={`${log.ts}-${index}`} className="flex gap-2">
                    <span className="shrink-0 text-muted-foreground">
                      {new Date(log.ts).toLocaleTimeString()}
                    </span>
                    <span
                      className={
                        log.level === "error"
                          ? "text-red-600"
                          : log.level === "warn"
                            ? "text-amber-600"
                            : "text-foreground"
                      }
                    >
                      {log.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <WizardAside
          title={isZh ? "部署快照" : "Deployment snapshot"}
          rows={snapshotRows}
          footer={(
            <div className="space-y-2">
              {[
                isZh ? "系统会按阶段回传状态与日志。" : "The server reports progress and logs back in phases.",
                isZh ? "成功后可直接复制原始链接或 Base64。" : "On success you can copy the raw link or the Base64 form immediately.",
                isZh ? "清理策略会跟配置一起返回，避免部署后状态失联。" : "Cleanup policy returns with the config so the end state is explicit.",
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
      </div>
    );
  }

  if (status === "success" && config) {
    return (
      <div className="animate-rise grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <Card className="space-y-6 p-6 md:p-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="section-eyebrow">{isZh ? "Deployment complete" : "Deployment complete"}</div>
                <h2 className="mt-3 text-3xl font-semibold text-green-700 md:text-4xl">
                  {t("selfhosted.success")}
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
                  {isZh
                    ? "节点已经可用，连接信息、清理策略与导出链接都在当前页完整交付。"
                    : "The node is live. Connection details, cleanup policy, and export links are all delivered on this page."}
                </p>
              </div>
              <Badge className="self-start px-3 py-1 md:self-auto">
                {String(config.protocol ?? "")}
              </Badge>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <SummaryRow label={t("selfhosted.summary.protocol")} value={String(config.protocol ?? "")} />
              <SummaryRow
                label={t("selfhosted.summary.connection")}
                value={
                  config.domain
                    ? `${String(config.domain)}:${String(config.port ?? "")}`
                    : config.ip
                      ? `${String(config.ip)}:${String(config.port ?? "")}`
                      : "—"
                }
                mono
              />
              <SummaryRow
                label={t("selfhosted.summary.cleanupMode")}
                value={String(config.cleanupMode ?? "—")}
              />
              <SummaryRow
                label={t("selfhosted.summary.cleanupAt")}
                value={String(config.cleanupAt ?? "—")}
              />
              <SummaryRow
                label={t("selfhosted.summary.cleanupTimer")}
                value={String(config.cleanupTimerName ?? "—")}
                mono
              />
            </div>
          </Card>

          <Card className="space-y-4 p-6 md:p-8">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="section-eyebrow">{isZh ? "Configuration payload" : "Configuration payload"}</div>
                <h3 className="mt-2 text-2xl font-semibold">
                  {isZh ? "完整返回字段" : "Full returned fields"}
                </h3>
              </div>
            </div>

            <div className="table-shell divide-y divide-black/5 text-sm">
              {Object.entries(config).map(([key, value]) => (
                <div key={key} className="flex justify-between gap-4 px-4 py-3">
                  <span className="text-muted-foreground">{key}</span>
                  <span className="break-all text-right font-mono text-xs">{String(value)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {generatedShareLink && (
            <Card className="space-y-4 p-5">
              <div>
                <div className="section-eyebrow">{isZh ? "Export" : "Export"}</div>
                <h3 className="mt-2 text-xl font-semibold">{localText.shareTitle}</h3>
              </div>
              <div className="code-block break-all">{generatedShareLink}</div>
              <div className="flex flex-col gap-2">
                <Button variant="outline" onClick={() => navigator.clipboard?.writeText(generatedShareLink)}>
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
                <div className="rounded-[1.25rem] border border-black/5 bg-white/70 px-4 py-3 break-all font-mono text-xs text-muted-foreground">
                  {encodedShareLink}
                </div>
              )}
            </Card>
          )}

          <WizardAside
            title={isZh ? "交付说明" : "Delivery notes"}
            rows={snapshotRows}
            footer={(
              <div className="space-y-2">
                {[
                  isZh ? "建议在客户端导入后先做一次短链路验证。" : "After import, validate with a short client connection check.",
                  isZh ? "保留返回的清理时间，避免误判节点生命周期。" : "Keep the cleanup timestamp visible so lifecycle is never ambiguous.",
                  isZh ? "需要重新开始时可回到首页并重置当前会话。" : "If you need to start again, return home and reset the current session.",
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

          <Button variant="outline" onClick={reset}>
            {t("common.back")}
          </Button>
        </div>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <Card className="animate-rise mx-auto max-w-xl space-y-5 p-8 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-red-50 text-xl font-semibold text-red-600">
          !
        </div>
        <div>
          <h2 className="text-2xl font-semibold text-red-600">
            {t("selfhosted.failed")}
          </h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">{error}</p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setStatus("pending");
            setStep(1);
          }}
        >
          {t("common.retry")}
        </Button>
      </Card>
    );
  }

  if (step === 1) {
    const isApi = deployMethod === "api";
    const isSsh = deployMethod === "ssh";
    const canProceed = isApi
      ? Boolean(provider && apiKey && region && plan)
      : Boolean(isSsh && serverIp && sshPassword);

    return (
      <WizardFrame
        eyebrow="Self-hosted"
        title={t("selfhosted.step1.title")}
        description={t("selfhosted.connectionMethod")}
        stepLabel="1 / 3"
        aside={(
          <WizardAside
            title={isZh ? "部署前准备" : "Before you deploy"}
            rows={snapshotRows}
            footer={(
              <div className="space-y-2">
                {checklist.map((item) => (
                  <div
                    key={item}
                    className="rounded-[1.25rem] border border-black/5 bg-white/75 px-4 py-3 text-sm leading-6 text-muted-foreground"
                  >
                    {item}
                  </div>
                ))}
              </div>
            )}
          />
        )}
      >
        <div className="space-y-7">
          <section>
            <Label>{t("selfhosted.connectionMethod")}</Label>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <button
                onClick={() => {
                  setDeployMethod("api");
                  setProvider(null);
                  setApiKey("");
                  setRegion("");
                  setPlan("");
                }}
                className={`choice-card min-h-[176px] ${isApi ? "choice-card-active" : ""}`}
              >
                <div className="space-y-4 text-left">
                  <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-950 text-sm font-semibold text-white shadow-lg">
                    API
                  </div>
                  <div>
                    <div className="text-lg font-semibold">
                      {t("selfhosted.method.api")}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-muted-foreground">
                      {t("selfhosted.method.api.desc")}
                    </div>
                  </div>
                </div>
              </button>
              <button
                onClick={() => setDeployMethod("ssh")}
                className={`choice-card min-h-[176px] ${isSsh ? "choice-card-active" : ""}`}
              >
                <div className="space-y-4 text-left">
                  <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-950 text-sm font-semibold text-white shadow-lg">
                    SSH
                  </div>
                  <div>
                    <div className="text-lg font-semibold">
                      {t("selfhosted.method.ssh")}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-muted-foreground">
                      {t("selfhosted.method.ssh.desc")}
                    </div>
                  </div>
                </div>
              </button>
            </div>
          </section>

          {isApi && (
            <section className="space-y-6">
              <div>
                <Label>{t("selfhosted.provider")}</Label>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  {(["vultr", "digitalocean", "aws"] as const).map((item) => (
                    <button
                      key={item}
                      onClick={() => setProvider(item)}
                      className={`choice-card min-h-[120px] ${provider === item ? "choice-card-active" : ""}`}
                    >
                      <div className="text-left">
                        <div className="text-base font-semibold">
                          {PROVIDER_INFO[item].name}
                        </div>
                        <div className="mt-2 text-sm leading-6 text-muted-foreground">
                          {item === "aws"
                            ? "EC2"
                            : item === "digitalocean"
                              ? "Droplets"
                              : "HF / Cloud compute"}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {provider && (
                <>
                  <div>
                    <Label>{t("selfhosted.apikey.label")}</Label>
                    <Input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={provider === "aws" ? "AKIA...:wJalr..." : t("selfhosted.apikey.placeholder")}
                      className="mt-2 h-12 rounded-[1.1rem]"
                    />
                    {provider === "aws" && (
                      <p className="mt-2 text-xs leading-6 text-muted-foreground">
                        {t("selfhosted.awsKeyFormat")}
                      </p>
                    )}
                  </div>

                  <div>
                    <Label>{t("selfhosted.region")}</Label>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {PROVIDER_INFO[provider].regions.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => setRegion(item.id)}
                          className={`rounded-full border px-4 py-2 text-sm transition-all ${
                            region === item.id
                              ? "border-primary/50 bg-primary/10 text-primary"
                              : "border-black/10 bg-white/70 text-muted-foreground hover:bg-white"
                          }`}
                        >
                          {t(item.nameKey)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label>{t("selfhosted.plan")}</Label>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {PROVIDER_INFO[provider].plans.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => setPlan(item.id)}
                          className={`choice-card min-h-[118px] ${plan === item.id ? "choice-card-active" : ""}`}
                        >
                          <div className="flex items-center justify-between gap-4 text-left">
                            <div className="font-medium">{item.name}</div>
                            <div className="text-sm text-primary">{t(item.priceKey)}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </section>
          )}

          {isSsh && (
            <section className="grid gap-5 md:grid-cols-2">
              <div className="space-y-3 md:col-span-2">
                <Label>{t("selfhosted.serverIp.label")}</Label>
                <Input
                  value={serverIp}
                  onChange={(e) => setServerIp(e.target.value)}
                  placeholder={t("selfhosted.serverIp.placeholder")}
                  className="h-12 rounded-[1.1rem]"
                />
              </div>
              <div className="space-y-3">
                <Label>{t("selfhosted.sshPort.label")}</Label>
                <Input
                  type="number"
                  value={sshPort}
                  onChange={(e) => setSshPort(Number(e.target.value))}
                  className="h-12 rounded-[1.1rem]"
                />
              </div>
              <div className="space-y-3">
                <Label>{t("selfhosted.sshPassword.label")}</Label>
                <Input
                  type="password"
                  value={sshPassword}
                  onChange={(e) => setSshPassword(e.target.value)}
                  placeholder={t("selfhosted.sshPassword.placeholder")}
                  className="h-12 rounded-[1.1rem]"
                />
                <p className="text-xs leading-6 text-muted-foreground">{t("selfhosted.sshPasswordHint")}</p>
              </div>
            </section>
          )}
        </div>

        <div className="flex justify-end border-t border-black/5 pt-6">
          <Button disabled={!canProceed} onClick={() => setStep(2)} className="h-12 px-6">
            {t("common.next")}
          </Button>
        </div>
      </WizardFrame>
    );
  }

  if (step === 2) {
    const hasCleanupValue =
      cleanupMode === "duration"
        ? cleanupHours.trim().length > 0
        : cleanupAtInput.trim().length > 0;
    const canProceed = Boolean(protocol && hasCleanupValue);

    return (
      <WizardFrame
        eyebrow={isZh ? "交付策略" : "Delivery"}
        title={t("selfhosted.step2.title")}
        description={localText.cleanupDatetimeHint}
        stepLabel="2 / 3"
        aside={(
          <WizardAside
            title={isZh ? "本步重点" : "This step defines delivery"}
            rows={[
              { label: t("selfhosted.review.protocol"), value: protocol ? t(PROTOCOL_INFO[protocol].nameKey) : "—" },
              { label: isZh ? "代理域名" : "Proxy domain", value: protocol === "hysteria2" ? "pblaze.com" : "—" },
              { label: localText.cleanupReview, value: cleanupSummary },
            ]}
            footer={(
              <div className="space-y-2">
                {[
                  isZh ? "Hysteria2 会为每单自动生成 pblaze.com 下的随机子域名。" : "Hysteria2 will auto-generate a random subdomain under pblaze.com for each order.",
                  isZh ? "Cloudflare Token 和 Zone ID 从 .local-secrets.env 读取。" : "Cloudflare token and zone ID are read from .local-secrets.env.",
                  isZh ? "清理策略应该在部署前决定，而不是在节点上线后补救。" : "Cleanup policy should be decided before deploy, not patched in after launch.",
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
          <section className="rounded-[1.75rem] border border-black/5 bg-white/70 p-4 md:p-5">
            <div className="text-sm font-semibold">
              {isZh ? "随机子域名策略" : "Random subdomain policy"}
            </div>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">
              {isZh
                ? "Hysteria2 会在 pblaze.com 下为每单自动生成随机子域名，Cloudflare Token 和 Zone ID 从 .local-secrets.env 读取。"
                : "Hysteria2 will auto-generate a random subdomain under pblaze.com for each order, with Cloudflare token and zone ID read from .local-secrets.env."}
            </p>
          </section>

          <section>
            <Label>{t("selfhosted.protocol")}</Label>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {(["vless-reality", "hysteria2"] as const).map((item) => (
                <button
                  key={item}
                  onClick={() => setProtocol(item)}
                  className={`choice-card min-h-[166px] ${protocol === item ? "choice-card-active" : ""}`}
                >
                  <div className="flex h-full items-start gap-4 text-left">
                    <span className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-950 text-xs font-semibold text-white shadow-lg">
                      {item === "vless-reality" ? "VR" : "H2"}
                    </span>
                    <div>
                      <div className="text-lg font-semibold">
                        {t(PROTOCOL_INFO[item].nameKey)}
                      </div>
                      <div className="mt-2 text-sm leading-6 text-muted-foreground">
                        {t(PROTOCOL_INFO[item].descKey)}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-[1.75rem] border border-black/5 bg-white/70 p-4 md:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <Label>{localText.cleanupTitle}</Label>
              <Badge variant="outline" className="px-3 py-1">
                {cleanupMode === "duration" ? localText.cleanupModeDuration : localText.cleanupModeDatetime}
              </Badge>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                onClick={() => setCleanupMode("duration")}
                className={`choice-card min-h-[110px] ${cleanupMode === "duration" ? "choice-card-active" : ""}`}
              >
                <div className="text-left">
                  <div className="text-base font-semibold">
                    {localText.cleanupModeDuration}
                  </div>
                  <div className="mt-2 text-sm leading-6 text-muted-foreground">
                    {isZh ? "适合按租用时长或实验窗口清理。" : "Best when cleanup should track a known runtime window."}
                  </div>
                </div>
              </button>
              <button
                onClick={() => setCleanupMode("datetime")}
                className={`choice-card min-h-[110px] ${cleanupMode === "datetime" ? "choice-card-active" : ""}`}
              >
                <div className="text-left">
                  <div className="text-base font-semibold">
                    {localText.cleanupModeDatetime}
                  </div>
                  <div className="mt-2 text-sm leading-6 text-muted-foreground">
                    {isZh ? "适合需要固定截止时间的交付。" : "Best when delivery must end at an exact cutoff."}
                  </div>
                </div>
              </button>
            </div>

            <div className="mt-4">
              {cleanupMode === "duration" ? (
                <div className="space-y-3">
                  <Label>{localText.cleanupHours}</Label>
                  <Input
                    type="number"
                    min="0.1"
                    step="0.5"
                    value={cleanupHours}
                    onChange={(e) => setCleanupHours(e.target.value)}
                    className="h-12 rounded-[1.1rem]"
                  />
                  <p className="text-xs leading-6 text-muted-foreground">{localText.cleanupHoursHint}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <Label>{localText.cleanupDatetime}</Label>
                  <Input
                    type="datetime-local"
                    value={cleanupAtInput}
                    onChange={(e) => setCleanupAtInput(e.target.value)}
                    className="h-12 rounded-[1.1rem]"
                  />
                  <p className="text-xs leading-6 text-muted-foreground">{localText.cleanupDatetimeHint}</p>
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-3 border-t border-black/5 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="outline" onClick={() => setStep(1)} className="h-12 px-6">
            {t("common.back")}
          </Button>
          <Button disabled={!canProceed} onClick={() => setStep(3)} className="h-12 px-6">
            {t("common.next")}
          </Button>
        </div>
      </WizardFrame>
    );
  }

  if (step === 3) {
    const handleDeploy = async () => {
      if (!token) {
        setError("Unauthorized");
        setStatus("failed");
        return;
      }

      setStatus("running");
      setError(null);

      try {
        updateStep({ stepId: "provision", status: "running", message: t("selfhosted.step.provision") });

        const body: Record<string, unknown> = {
          deployMethod,
          protocol,
          ...(cleanupMode === "duration"
            ? { cleanupHours: cleanupHours ? Number(cleanupHours) : undefined }
            : { cleanupAt: cleanupAtInput ? new Date(cleanupAtInput).toISOString() : undefined }),
        };

        if (deployMethod === "api") {
          Object.assign(body, { provider, apiKey, region, plan });
        } else {
          Object.assign(body, { serverIp, sshPort, sshPassword });
        }

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
        let attempts = 0;
        const maxAttempts = 120;

        while (attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          attempts += 1;

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
      <WizardFrame
        eyebrow="Review"
        title={t("selfhosted.step3.title")}
        description={t("selfhosted.review.warning")}
        stepLabel="3 / 3"
        aside={(
          <WizardAside
            title={isZh ? "最终审阅" : "Final review"}
            rows={[
              { label: isZh ? "接入方式" : "Access", value: deployMethod === "api" ? t("selfhosted.method.api") : t("selfhosted.method.ssh") },
              {
                label: isZh ? "目标" : "Target",
                value: deployMethod === "api" ? [providerInfo?.name, regionName, planInfo?.name].filter(Boolean).join(" / ") || "—" : serverIp || "—",
              },
              { label: t("selfhosted.review.protocol"), value: protocol ? t(`protocol.${protocol}`) : "—" },
              { label: localText.cleanupReview, value: cleanupSummary },
            ]}
            footer={(
              <div className="space-y-2">
                {[
                  isZh ? "部署会创建或接管一台真实服务器，并写入运行配置。" : "Deployment creates or takes over a real server and writes runtime configuration.",
                  isZh ? "若使用云厂商 API，费用责任在你的账户下立即生效。" : "If you use a cloud API, charges begin under your account immediately.",
                  isZh ? "确认后系统会按阶段执行，并把日志回传到当前页。" : "After confirmation, the system executes in phases and returns logs to this page.",
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
        <div className="space-y-6">
          <section className="rounded-[1.75rem] border border-black/5 bg-white/72 p-5">
            <div className="mb-4 text-sm font-semibold">
              {isZh ? "部署摘要" : "Deployment summary"}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {deployMethod === "api" ? (
                <>
                  <SummaryRow label={t("selfhosted.review.provider")} value={providerInfo?.name || "—"} />
                  <SummaryRow label={t("selfhosted.review.region")} value={regionName || "—"} />
                  <SummaryRow label={t("selfhosted.review.plan")} value={planInfo?.name || "—"} />
                </>
              ) : (
                <>
                  <SummaryRow label={t("selfhosted.serverIp.label")} value={serverIp || "—"} mono />
                  <SummaryRow label={t("selfhosted.sshPort.label")} value={String(sshPort)} />
                </>
              )}
              <SummaryRow
                label={t("selfhosted.review.protocol")}
                value={protocol ? t(`protocol.${protocol}`) : "—"}
              />
              <SummaryRow label={localText.cleanupReview} value={cleanupSummary} />
            </div>
          </section>

          <section className="rounded-[1.6rem] border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-800">
            {t("selfhosted.review.warning")}
          </section>
        </div>

        <div className="flex flex-col gap-3 border-t border-black/5 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="outline" onClick={() => setStep(2)} className="h-12 px-6">
            {t("common.back")}
          </Button>
          <Button onClick={handleDeploy} className="h-12 bg-green-600 px-6 hover:bg-green-700">
            {t("selfhosted.review.deploy")}
          </Button>
        </div>
      </WizardFrame>
    );
  }

  return null;
}

function StatusStep({
  status,
  label,
  message,
}: {
  status: "pending" | "running" | "success" | "failed";
  label: string;
  message?: string;
}) {
  const marker =
    status === "success"
      ? "bg-green-500"
      : status === "running"
        ? "bg-primary"
        : status === "failed"
          ? "bg-red-500"
          : "bg-black/10";

  return (
    <div className="flex items-center gap-3 rounded-[1.5rem] border border-black/5 bg-white/70 p-4 text-sm">
      <span className={`h-2.5 w-2.5 rounded-full ${marker}`} />
      <span className="flex-1 font-medium">{label}</span>
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </div>
  );
}
