"use client";

import { useRouter } from "next/navigation";
import { useDeployStore } from "@/lib/deploy/store";
import { useAuthStore } from "@/lib/auth/store";
import { useLocaleStore } from "@/lib/i18n/store";
import type { AppMode } from "@/lib/deploy/types";
import { MagicLinkGate } from "@/components/auth/MagicLinkGate";
import { SelfHostedWizard } from "@/components/self-hosted/SelfHostedWizard";
import { RentalWizard } from "@/components/rental/RentalWizard";
import { RentalDashboard } from "@/components/rental/RentalDashboard";
import { Button, Card, Badge } from "@/components/ui";
import versions from "@/../versions.json";

export default function Home() {
  const router = useRouter();
  const mode = useDeployStore((s) => s.mode);
  const setMode = useDeployStore((s) => s.setMode);
  const rentalStatus = useDeployStore((s) => s.rentalStatus);
  const rentalId = useDeployStore((s) => s.rentalId);
  const remainingMinutes = useDeployStore((s) => s.remainingMinutes);
  const protocol = useDeployStore((s) => s.protocol);
  const token = useAuthStore((s) => s.token);

  if (mode === "self-hosted") {
    return <AppLayout>{token ? <SelfHostedWizard /> : <SelfHostedAuthGate />}</AppLayout>;
  }

  if (mode === "rental" && rentalStatus === "active" && rentalId) {
    const initialRental = {
      id: rentalId,
      protocol: protocol || "vless-reality",
      status: "active",
      ip: "",
      duration_hours: remainingMinutes / 60,
      started_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + remainingMinutes * 60000).toISOString(),
      remainingMinutes,
    };
    return (
      <AppLayout>
        <RentalDashboard token={token || ""} initialRental={initialRental} />
      </AppLayout>
    );
  }

  if (mode === "rental") {
    return (
      <AppLayout>
        <RentalWizard />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <ModeSelection onSelect={setMode} onConsoleLogin={() => router.push("/console/wallet")} />
    </AppLayout>
  );
}

function SelfHostedAuthGate() {
  return <MagicLinkGate variant="self-hosted" returnTo="/" />;
}

function ModeSelection({
  onSelect,
  onConsoleLogin,
}: {
  onSelect: (mode: AppMode) => void;
  onConsoleLogin: () => void;
}) {
  const { t, locale } = useLocaleStore();
  const isZh = locale === "zh";

  const heroTitle = isZh
    ? "部署私有节点，也可以像一台一体化产品那样安静、明确、可控。"
    : "Private node deployment, delivered with the calm precision of a first-party product.";
  const heroBody = isZh
    ? "自托管适合长期掌控基础设施，按租适合立刻获得独享节点。AnixOps 把部署、付款、清理与状态反馈收进一个克制但完整的体验里。"
    : "Own the infrastructure when you need long-term control, or rent an exclusive node when speed matters. AnixOps keeps setup, payment, cleanup, and runtime state inside one restrained product surface.";

  const principles = isZh
    ? [
        {
          title: "少一点输入",
          body: "默认优先高确定性的选项，让你只在真正关键的位置做判断。",
        },
        {
          title: "多一点反馈",
          body: "步骤、状态和风险都被前置说明，避免在部署后再解释系统发生了什么。",
        },
        {
          title: "明确结束条件",
          body: "到期、销毁、自动清理和订阅导出都有收口，不留下悬空状态。",
        },
      ]
    : [
        {
          title: "Less input",
          body: "Default to the highest-confidence choices and ask for judgment only where it matters.",
        },
        {
          title: "More feedback",
          body: "Steps, risk, and runtime state are explained up front instead of after deployment.",
        },
        {
          title: "Explicit endings",
          body: "Expiry, cleanup, destroy, and export paths close cleanly without dangling state.",
        },
      ];

  const outcomeCards = isZh
    ? [
        {
          title: "独享连接",
          body: "无共享 IP，无额外租户噪音，配置交付直接面向客户端。",
        },
        {
          title: "部署节奏可预期",
          body: "购买、配置、运行、续费、销毁都按一个连续模型组织。",
        },
        {
          title: "运营面仍然清晰",
          body: "后台、支付、兑换码与审计信息都沿用同一套视觉语言。",
        },
      ]
    : [
        {
          title: "Exclusive connectivity",
          body: "No shared IP pool, no extra tenant noise, and client-ready output by default.",
        },
        {
          title: "Predictable delivery",
          body: "Purchase, deploy, operate, renew, and destroy all follow one continuous model.",
        },
        {
          title: "Operational clarity",
          body: "Admin, payments, redeem codes, and audit data live under the same design language.",
        },
      ];

  const sharedPills = isZh
    ? ["即时配置", "自动清理", "独享 IP", "完整状态反馈"]
    : ["Instant config", "Auto cleanup", "Exclusive IP", "Full runtime feedback"];

  return (
    <div className="space-y-6 md:space-y-8">
      <section className="hero-card animate-rise overflow-hidden">
        <div className="grid min-w-0 gap-8 lg:grid-cols-[1.06fr_0.94fr] lg:items-center">
          <div className="min-w-0 space-y-7">
            <div className="section-eyebrow">
              {isZh ? "Private node orchestration" : "Private node orchestration"}
            </div>

            <div className="space-y-4">
              <h1 className="gradient-title max-w-5xl text-[2.9rem] font-semibold leading-[1.02] tracking-[-0.065em] sm:text-6xl md:text-7xl">
                {heroTitle}
              </h1>
              <p className="max-w-2xl text-base leading-8 text-muted-foreground md:text-lg">
                {heroBody}
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Button size="lg" onClick={() => onSelect("rental")} className="h-12 px-8">
                {isZh ? "立即按租" : "Start rental"}
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => onSelect("self-hosted")}
                className="h-12 px-8"
              >
                {isZh ? "进入自托管" : "Self-host with control"}
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={onConsoleLogin}
                className="h-12 px-8"
              >
                {isZh ? "登录钱包控制台" : "Open wallet console"}
              </Button>
            </div>

            <p className="max-w-2xl text-sm leading-7 text-muted-foreground">
              {isZh
                ? "普通用户可以从这里登录钱包控制台，查看余额、节点、审计和推荐记录。"
                : "Existing users can open the wallet console here to view balance, nodes, audit, and referral data."}
            </p>

            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              {sharedPills.map((item) => (
                <div key={item} className="metric-pill justify-center text-center">
                  {item}
                </div>
              ))}
            </div>
          </div>

          <HeroPreview />
        </div>
      </section>

      <section className="animate-rise-delay-1 grid gap-4 lg:grid-cols-2">
        <ModeCard
          mode="self-hosted"
          eyebrow={isZh ? "Own the stack" : "Own the stack"}
          title={t("mode.selfhosted")}
          description={t("mode.selfhosted.desc")}
          onSelect={onSelect}
          badge={t("mode.selfhosted.badge")}
          details={[
            t("mode.compare.cost.detail"),
            t("mode.compare.privacy.detail"),
            isZh ? "适合长期维护、可持续升级与运维归档。" : "Best when you want long-lived infra, repeatable upgrades, and full ops ownership.",
          ]}
          cta={isZh ? "继续自托管" : "Continue to self-host"}
        />
        <ModeCard
          mode="rental"
          eyebrow={isZh ? "Need it now" : "Need it now"}
          title={t("mode.rental")}
          description={t("mode.rental.desc")}
          onSelect={onSelect}
          badge={t("mode.rental.badge")}
          details={[
            t("mode.compare.tech.detail"),
            t("mode.compare.exclusive.detail"),
            isZh ? "适合立刻交付、临时使用或快速验证线路。" : "Best when you need immediate delivery, temporary use, or fast route validation.",
          ]}
          cta={isZh ? "继续按租" : "Continue to rental"}
        />
      </section>

      <section className="animate-rise-delay-2 grid gap-4 lg:grid-cols-[0.86fr_1.14fr]">
        <Card className="space-y-5 p-6 md:p-7">
          <div>
            <div className="section-eyebrow">{isZh ? "Design principles" : "Design principles"}</div>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.045em] md:text-4xl">
              {isZh ? "把复杂路径压成可判断的步骤。" : "Compress complex paths into steps you can judge at a glance."}
            </h2>
          </div>

          <div className="space-y-3">
            {principles.map((item) => (
              <div key={item.title} className="rounded-[1.6rem] border border-black/5 bg-white/75 p-5">
                <div className="text-lg font-semibold tracking-[-0.03em]">{item.title}</div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="space-y-5 p-6 md:p-7">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="section-eyebrow">{t("mode.compare.title")}</div>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.045em] md:text-4xl">
                {isZh ? "从入口到交付，始终保持同一套节奏。" : "One cadence from entry to delivery."}
              </h2>
            </div>
            <Badge variant="outline" className="self-start px-3 py-1 md:self-auto">
              v{versions.frontend}
            </Badge>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <CompareRow label={t("mode.compare.tech")} value={t("mode.compare.tech.detail")} />
            <CompareRow label={t("mode.compare.cost")} value={t("mode.compare.cost.detail")} />
            <CompareRow label={t("mode.compare.exclusive")} value={t("mode.compare.exclusive.detail")} />
            <CompareRow label={t("mode.compare.privacy")} value={t("mode.compare.privacy.detail")} />
          </div>

          <div className="grid gap-3 pt-1 md:grid-cols-2">
            <FlowTrack
              eyebrow={isZh ? "Rental track" : "Rental track"}
              title={isZh ? "选择协议，付款后立即交付连接。" : "Choose a protocol, pay once, and move straight into a live node."}
              steps={
                isZh
                  ? ["选择协议与时长", "付款或兑换码", "获取配置并续费/销毁"]
                  : ["Select protocol and duration", "Pay or redeem", "Receive config and renew or destroy"]
              }
            />
            <FlowTrack
              eyebrow={isZh ? "Self-hosted track" : "Self-hosted track"}
              title={isZh ? "授权后配置基础设施，再让系统完成部署。" : "Authorize, choose infrastructure, then let the system finish the rest."}
              steps={
                isZh
                  ? ["选择接入方式", "配置域名、协议与清理策略", "审阅风险并部署"]
                  : ["Choose access method", "Set domain, protocol, and cleanup", "Review risk and deploy"]
              }
            />
          </div>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {outcomeCards.map((item, index) => (
          <Card key={item.title} className={`p-6 ${index === 1 ? "md:translate-y-4" : ""}`}>
            <div className="section-eyebrow">{isZh ? "Outcome" : "Outcome"}</div>
            <h3 className="mt-3 text-2xl font-semibold tracking-[-0.04em]">{item.title}</h3>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">{item.body}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}

function HeroPreview() {
  return (
    <div className="relative min-h-[420px] min-w-0 overflow-hidden rounded-[2.45rem] border border-white/70 bg-slate-950 p-5 text-white shadow-[0_34px_80px_rgba(15,23,42,0.24)] md:p-6">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_24%_18%,rgba(78,164,255,0.42),transparent_32%),radial-gradient(circle_at_78%_74%,rgba(255,179,113,0.26),transparent_34%),linear-gradient(160deg,rgba(255,255,255,0.04),rgba(255,255,255,0))]" />

      <div className="relative flex h-full flex-col justify-between gap-6">
        <div className="flex items-center justify-between text-xs text-white/58">
          <span>AnixOps Control</span>
          <span>private.edge</span>
        </div>

        <div className="space-y-4">
          <div className="rounded-[1.75rem] border border-white/12 bg-white/10 p-5 backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.24em] text-white/45">Delivery state</div>
                <div className="mt-2 text-3xl font-semibold tracking-[-0.05em]">Ready in motion</div>
              </div>
              <div className="rounded-full border border-white/16 bg-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-white/70">
                Live
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <PreviewTile label="Runtime" value="23:58" emphasize />
              <PreviewTile label="Protocol" value="VLESS Reality" />
              <PreviewTile label="Region" value="Tokyo" />
              <PreviewTile label="Cleanup" value="Auto after expiry" />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-[1.6rem] border border-white/12 bg-white/10 p-4 backdrop-blur-xl">
              <div className="text-xs uppercase tracking-[0.24em] text-white/45">Flow</div>
              <div className="mt-3 space-y-2.5">
                <PreviewLine title="Select" note="Protocol and duration" state="done" />
                <PreviewLine title="Authorize" note="Payment or magic link" state="active" />
                <PreviewLine title="Deploy" note="Config delivery and cleanup" state="pending" />
              </div>
            </div>

            <div className="rounded-[1.6rem] border border-white/12 bg-white/10 p-4 backdrop-blur-xl">
              <div className="text-xs uppercase tracking-[0.24em] text-white/45">Design target</div>
              <p className="mt-3 text-sm leading-6 text-white/75">
                Fewer choices on screen, stronger status feedback, and no ambiguity about what happens next.
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.22em] text-white/68">
                <span className="rounded-full border border-white/12 px-3 py-1">Zero shared IP</span>
                <span className="rounded-full border border-white/12 px-3 py-1">Explicit cleanup</span>
                <span className="rounded-full border border-white/12 px-3 py-1">Calm control</span>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-full border border-white/12 bg-white/10 px-4 py-2 text-xs text-white/70 backdrop-blur-xl">
          Built to keep payment, state, config, and cleanup inside one continuous surface.
        </div>
      </div>
    </div>
  );
}

function PreviewTile({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="rounded-[1.25rem] border border-white/10 bg-white/10 p-4 backdrop-blur-xl">
      <div className="text-[11px] uppercase tracking-[0.22em] text-white/44">{label}</div>
      <div className={`mt-2 ${emphasize ? "font-mono text-4xl tracking-[-0.07em]" : "text-sm font-semibold"}`}>
        {value}
      </div>
    </div>
  );
}

function PreviewLine({
  title,
  note,
  state,
}: {
  title: string;
  note: string;
  state: "done" | "active" | "pending";
}) {
  const marker =
    state === "done"
      ? "bg-green-400"
      : state === "active"
        ? "bg-white"
        : "bg-white/16";

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/10 px-3 py-3">
      <span className={`h-2.5 w-2.5 rounded-full ${marker}`} />
      <div className="min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-white/55">{note}</div>
      </div>
    </div>
  );
}

function FlowTrack({
  eyebrow,
  title,
  steps,
}: {
  eyebrow: string;
  title: string;
  steps: string[];
}) {
  return (
    <div className="rounded-[1.7rem] border border-black/5 bg-white/70 p-5">
      <div className="section-eyebrow">{eyebrow}</div>
      <h3 className="mt-3 text-xl font-semibold tracking-[-0.03em]">{title}</h3>
      <div className="mt-4 space-y-2.5">
        {steps.map((step, index) => (
          <div key={step} className="flex gap-3 rounded-2xl border border-black/5 bg-white/80 px-3 py-3">
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-950 text-[11px] font-semibold text-white">
              {index + 1}
            </div>
            <div className="pt-0.5 text-sm leading-6 text-foreground">{step}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ModeCard({
  mode,
  eyebrow,
  title,
  description,
  badge,
  details,
  cta,
  onSelect,
}: {
  mode: AppMode;
  eyebrow: string;
  title: string;
  description: string;
  badge: string;
  details: string[];
  cta: string;
  onSelect: (mode: AppMode) => void;
}) {
  return (
    <button onClick={() => onSelect(mode)} className="choice-card group min-h-[320px] p-5 md:p-6">
      <div className="flex h-full flex-col justify-between gap-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="section-eyebrow">{eyebrow}</div>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.045em]">{title}</h2>
            <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground md:text-base">{description}</p>
          </div>
          <Badge variant="outline" className="px-3 py-1">
            {badge}
          </Badge>
        </div>

        <div className="space-y-2.5">
          {details.map((detail) => (
            <div
              key={detail}
              className="rounded-[1.35rem] border border-black/5 bg-white/60 px-4 py-3 text-sm leading-6 text-muted-foreground"
            >
              {detail}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-sm font-semibold text-primary transition group-hover:translate-x-1">{cta}</span>
          <span className="rounded-full border border-black/5 bg-white/85 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            {mode === "rental" ? "Fast path" : "Control path"}
          </span>
        </div>
      </div>
    </button>
  );
}

function CompareRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.45rem] border border-black/5 bg-white/60 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-foreground/85">{label}</div>
      <div className="mt-2 text-sm leading-6 text-muted-foreground">{value}</div>
    </div>
  );
}

function AppLayout({ children }: { children: React.ReactNode }) {
  const mode = useDeployStore((s) => s.mode);
  const reset = useDeployStore((s) => s.reset);
  const { t, locale, setLocale } = useLocaleStore();
  const token = useAuthStore((s) => s.token);
  const email = useAuthStore((s) => s.email);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const logout = useAuthStore((s) => s.logout);
  const router = useRouter();

  return (
    <main className="apple-shell flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 w-full px-3 pt-3">
        <div className="mobile-viewport-frame-narrow mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 rounded-full border border-white/70 bg-white/75 px-3 py-2 shadow-[0_12px_40px_rgba(18,30,49,0.08)] backdrop-blur-2xl md:px-5">
          <button onClick={reset} className="flex items-center gap-3 rounded-full pr-2">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-slate-950 text-xs font-semibold text-white shadow-lg">
              AX
            </div>
            <div className="text-left">
              <div className="text-base font-semibold tracking-[-0.03em]">AnixOps</div>
              <div className="hidden text-[11px] uppercase tracking-[0.22em] text-muted-foreground md:block">
                Private node delivery
              </div>
            </div>
          </button>

          <div className="flex flex-wrap items-center justify-end gap-2 text-sm text-muted-foreground">
            {mode === "self-hosted" && (
              <ShellAction tone={token ? "success" : "warning"}>
                {token ? "Authorized" : "Sign-in required"}
              </ShellAction>
            )}
            {mode === "rental" && <ShellAction>{t("mode.rental.label")}</ShellAction>}
            {mode === "rental" && token && (
              <button
                onClick={() => router.push("/payments")}
                className="rounded-full border border-black/10 bg-white/60 px-3 py-1 text-xs transition hover:bg-white"
              >
                {t("payment.history")}
              </button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/console/wallet")}
              className="rounded-full border-black/10 bg-white/90 px-4 shadow-sm"
            >
              {token
                ? (locale === "zh" ? "钱包控制台" : "Wallet console")
                : (locale === "zh" ? "登录控制台" : "Console login")}
            </Button>
            {token && isAdmin && (
              <button
                onClick={() => router.push("/admin")}
                className="rounded-full border border-black/10 bg-white/60 px-3 py-1 text-xs transition hover:bg-white"
              >
                Admin
              </button>
            )}
            {token && email && (
              <div className="flex items-center gap-2 rounded-full border border-black/5 bg-white/55 px-3 py-1">
                <span className="max-w-[180px] truncate text-xs">{email}</span>
                <button
                  onClick={() => {
                    logout();
                    router.push("/");
                  }}
                  className="rounded-full border border-black/10 bg-white/80 px-3 py-1 text-xs transition hover:bg-white"
                >
                  Logout
                </button>
              </div>
            )}
            <button
              onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
              className="rounded-full border border-black/10 bg-slate-950 px-3 py-1 text-xs text-white shadow-sm transition hover:bg-slate-800"
            >
              {locale === "zh" ? t("common.lang.en") : t("common.lang.zh")}
            </button>
          </div>
        </div>
      </header>

      <div className="mobile-viewport-frame mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:py-14">
        {children}
      </div>

      <footer className="mt-auto w-full px-4 pb-8">
        <div className="mx-auto grid max-w-6xl gap-4 rounded-[1.9rem] border border-white/60 bg-white/65 px-5 py-5 backdrop-blur-xl md:grid-cols-[1.2fr_0.8fr] md:px-6">
          <div>
            <div className="text-sm font-semibold tracking-[-0.02em] text-foreground">
              Calm control for self-hosted and rental node delivery.
            </div>
            <div className="mt-2 text-sm leading-6 text-muted-foreground">
              {t("footer.free")} |{" "}
              <a href="#kb" className="text-primary hover:underline">
                {t("footer.kb")}
              </a>
              {" "}|
              {" "}
              <a href="#ai-agent" className="text-primary hover:underline">
                {t("footer.ai")}
              </a>
            </div>
          </div>

          <div className="space-y-1 text-left text-xs text-muted-foreground md:text-right">
            <div>FE v{versions.frontend} | BE v{versions.backend}</div>
            <div>{versions.commit || "dev"}</div>
          </div>
        </div>
      </footer>
    </main>
  );
}

function ShellAction({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning";
}) {
  const toneClass =
    tone === "success"
      ? "border-green-300 bg-green-50 text-green-700"
      : tone === "warning"
        ? "border-amber-300 bg-amber-50 text-amber-700"
        : "border-black/10 bg-white/60 text-muted-foreground";

  return <span className={`rounded-full border px-3 py-1 text-xs ${toneClass}`}>{children}</span>;
}
