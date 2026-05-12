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
import { Button, Card } from "@/components/ui";
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
  const { locale } = useLocaleStore();
  const isZh = locale === "zh";

  const sharedPills = isZh
    ? ["即时配置", "自动清理", "独享 IP", "完整状态反馈"]
    : ["Instant config", "Auto cleanup", "Exclusive IP", "Full runtime feedback"];

  return (
    <div className="space-y-5 md:space-y-6">
      <section className="hero-card animate-rise overflow-hidden">
        <div className="grid min-w-0 gap-8 lg:grid-cols-[1fr_0.82fr] lg:items-center">
          <div className="min-w-0 space-y-7">
            <div className="section-eyebrow">
              {isZh ? "One-click private route" : "One-click private route"}
            </div>

            <div className="space-y-4">
              <h1 className="gradient-title max-w-5xl text-[3.2rem] font-semibold leading-[1.02] sm:text-6xl md:text-7xl">
                {isZh ? "一键连接，系统处理其余全部。" : "One button. The system handles the rest."}
              </h1>
              <p className="max-w-2xl text-base leading-8 text-muted-foreground md:text-lg">
                {isZh
                  ? "默认 VLESS Reality、最严格审计、自动选区、失败自恢复。用户不需要理解协议、地区、探测和配置细节。"
                  : "VLESS Reality, strict audit, automatic region selection, and recovery by default. No protocol, region, probe, or config decisions are exposed."}
              </p>
            </div>

            <Button size="lg" onClick={() => onSelect("rental")} className="h-14 w-full max-w-sm px-8 text-base">
              {isZh ? "一键连接" : "One-click connect"}
            </Button>

            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              {sharedPills.map((item) => (
                <div key={item} className="metric-pill justify-center text-center">
                  {item}
                </div>
              ))}
            </div>

            <details className="max-w-2xl rounded-lg border border-border bg-card px-4 py-3">
              <summary className="cursor-pointer text-sm font-semibold">
                {isZh ? "辅助入口" : "Secondary paths"}
              </summary>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Button variant="outline" onClick={() => onSelect("self-hosted")} className="h-11">
                  {isZh ? "自托管" : "Self-hosted"}
                </Button>
                <Button variant="outline" onClick={onConsoleLogin} className="h-11">
                  {isZh ? "钱包控制台" : "Wallet console"}
                </Button>
              </div>
            </details>
          </div>

          <HeroPreview />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {(isZh
          ? [
              { title: "默认最严格", body: "审计与出站规则默认采用受限策略。" },
              { title: "自动换区", body: "探测失败后自动清理并切换地区重试。" },
              { title: "APP 就绪", body: "连接配置可直接供未来 xray 内核客户端消费。" },
            ]
          : [
              { title: "Strict by default", body: "Audit and egress policy use the restricted profile by default." },
              { title: "Auto recovery", body: "Probe failures clean up and rotate regions automatically." },
              { title: "App-ready", body: "Connection profiles are shaped for a future xray-core client." },
            ]).map((item) => (
          <Card key={item.title} className="p-6">
            <div className="section-eyebrow">{isZh ? "Outcome" : "Outcome"}</div>
            <h3 className="mt-3 text-2xl font-semibold">{item.title}</h3>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">{item.body}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}

function HeroPreview() {
  return (
    <div className="relative min-h-[420px] min-w-0 overflow-hidden rounded-lg border border-white/70 bg-slate-950 p-5 text-white shadow-sm md:p-6">
      <div className="relative flex h-full flex-col justify-between gap-6">
        <div className="flex items-center justify-between text-xs text-white/58">
          <span>AnixOps Control</span>
          <span>private.edge</span>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-white/12 bg-white/10 p-5 ">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.24em] text-white/45">Delivery state</div>
                <div className="mt-2 text-3xl font-semibold">Ready in motion</div>
              </div>
              <div className="rounded-lg border border-white/16 bg-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-white/70">
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
            <div className="rounded-lg border border-white/12 bg-white/10 p-4 ">
              <div className="text-xs uppercase tracking-[0.24em] text-white/45">Flow</div>
              <div className="mt-3 space-y-2.5">
                <PreviewLine title="Select" note="Protocol and duration" state="done" />
                <PreviewLine title="Authorize" note="Payment or magic link" state="active" />
                <PreviewLine title="Deploy" note="Config delivery and cleanup" state="pending" />
              </div>
            </div>

            <div className="rounded-lg border border-white/12 bg-white/10 p-4 ">
              <div className="text-xs uppercase tracking-[0.24em] text-white/45">Design target</div>
              <p className="mt-3 text-sm leading-6 text-white/75">
                Fewer choices on screen, stronger status feedback, and no ambiguity about what happens next.
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.22em] text-white/68">
                <span className="rounded-lg border border-white/12 px-3 py-1">Zero shared IP</span>
                <span className="rounded-lg border border-white/12 px-3 py-1">Explicit cleanup</span>
                <span className="rounded-lg border border-white/12 px-3 py-1">Calm control</span>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-white/12 bg-white/10 px-4 py-2 text-xs text-white/70 ">
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
    <div className="rounded-lg border border-white/10 bg-white/10 p-4 ">
      <div className="text-[11px] uppercase tracking-[0.22em] text-white/44">{label}</div>
      <div className={`mt-2 ${emphasize ? "font-mono text-4xl" : "text-sm font-semibold"}`}>
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
    <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/10 px-3 py-3">
      <span className={`h-2.5 w-2.5 rounded-full ${marker}`} />
      <div className="min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-white/55">{note}</div>
      </div>
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
        <div className="mobile-viewport-frame-narrow mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 rounded-lg border border-white/70 bg-card px-3 py-2 shadow-sm  md:px-5">
          <button onClick={reset} className="flex items-center gap-3 rounded-lg pr-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-slate-950 text-xs font-semibold text-white shadow-lg">
              AX
            </div>
            <div className="text-left">
              <div className="text-base font-semibold">AnixOps</div>
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/console/wallet")}
              className="rounded-lg border-border bg-card px-4 shadow-sm"
            >
              {token
                ? (locale === "zh" ? "钱包控制台" : "Wallet console")
                : (locale === "zh" ? "登录控制台" : "Console login")}
            </Button>
            {token && email && (
              <details className="rounded-lg border border-border bg-card px-3 py-1 text-xs">
                <summary className="max-w-[180px] cursor-pointer truncate">
                  {email}
                </summary>
                <div className="mt-3 grid gap-2 pb-2">
                  <button
                    onClick={() => router.push("/payments")}
                    className="rounded-lg border border-border bg-card px-3 py-2 text-left transition hover:bg-muted"
                  >
                    {t("payment.history")}
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => router.push("/admin")}
                      className="rounded-lg border border-border bg-card px-3 py-2 text-left transition hover:bg-muted"
                    >
                      Admin
                    </button>
                  )}
                  <button
                    onClick={() => {
                      logout();
                      router.push("/");
                    }}
                    className="rounded-lg border border-border bg-card px-3 py-2 text-left transition hover:bg-muted"
                  >
                    Logout
                  </button>
                </div>
              </details>
            )}
            <button
              onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
              className="rounded-lg border border-border bg-slate-950 px-3 py-1 text-xs text-white shadow-sm transition hover:bg-slate-800"
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
        <div className="mx-auto grid max-w-6xl gap-4 rounded-lg border border-white/60 bg-card px-5 py-5  md:grid-cols-[1.2fr_0.8fr] md:px-6">
          <div>
            <div className="text-sm font-semibold text-foreground">
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
        : "border-border bg-card text-muted-foreground";

  return <span className={`rounded-lg border px-3 py-1 text-xs ${toneClass}`}>{children}</span>;
}
