"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDeployStore } from "@/lib/deploy/store";
import { useAuthStore } from "@/lib/auth/store";
import { useLocaleStore } from "@/lib/i18n/store";
import type { AppMode } from "@/lib/deploy/types";
import { SelfHostedWizard } from "@/components/self-hosted/SelfHostedWizard";
import { RentalWizard } from "@/components/rental/RentalWizard";
import { RentalDashboard } from "@/components/rental/RentalDashboard";
import { Button, Card, Badge } from "@/components/ui";
import versions from "@/../versions.json";

export default function Home() {
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
    return <AppLayout><RentalDashboard token={token || ""} initialRental={initialRental} /></AppLayout>;
  }

  if (mode === "rental") {
    return <AppLayout><RentalWizard /></AppLayout>;
  }

  return (
    <AppLayout>
      <ModeSelection onSelect={setMode} />
    </AppLayout>
  );
}

function SelfHostedAuthGate() {
  const { t } = useLocaleStore();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sendLink = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setMessage(t("auth.magicLink.sent"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error.generic"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-6 space-y-4">
      <h2 className="text-lg font-semibold">{t("auth.magicLink.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("auth.magicLink.desc")}</p>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t("rental.emailPlaceholder")}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
      />
      {message && <p className="text-sm text-green-600">{message}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end">
        <Button disabled={!email || loading} onClick={sendLink}>
          {loading ? t("common.processing") : t("auth.magicLink.send")}
        </Button>
      </div>
    </Card>
  );
}

function ModeSelection({ onSelect }: { onSelect: (mode: AppMode) => void }) {
  const { t } = useLocaleStore();

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">AnixOps</h1>
        <p className="mt-2 text-muted-foreground">{t("app.subtitle")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ModeCard
          mode="self-hosted"
          icon="🔧"
          title={t("mode.selfhosted")}
          description={t("mode.selfhosted.desc")}
          onSelect={onSelect}
          badge={t("mode.selfhosted.badge")}
        />
        <ModeCard
          mode="rental"
          icon="⚡"
          title={t("mode.rental")}
          description={t("mode.rental.desc")}
          onSelect={onSelect}
          badge={t("mode.rental.badge")}
        />
      </div>

      <div className="rounded-lg border border-border/40 bg-muted/30 p-4 text-sm">
        <h3 className="mb-2 font-semibold">{t("mode.compare.title")}</h3>
        <div className="space-y-2 text-muted-foreground">
          <div className="flex justify-between">
            <span>{t("mode.compare.tech")}</span>
            <span>{t("mode.compare.tech.detail")}</span>
          </div>
          <div className="flex justify-between">
            <span>{t("mode.compare.cost")}</span>
            <span>{t("mode.compare.cost.detail")}</span>
          </div>
          <div className="flex justify-between">
            <span>{t("mode.compare.exclusive")}</span>
            <span>{t("mode.compare.exclusive.detail")}</span>
          </div>
          <div className="flex justify-between">
            <span>{t("mode.compare.privacy")}</span>
            <span>{t("mode.compare.privacy.detail")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModeCard({
  mode,
  icon,
  title,
  description,
  badge,
  onSelect,
}: {
  mode: AppMode;
  icon: string;
  title: string;
  description: string;
  badge: string;
  onSelect: (mode: AppMode) => void;
}) {
  return (
    <button
      onClick={() => onSelect(mode)}
      className="rounded-xl border-2 border-border/60 p-6 text-left transition-all hover:border-primary/50 hover:shadow-md"
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-2xl">{icon}</div>
          <h2 className="mt-3 text-lg font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <Badge variant="outline" className="text-xs">
          {badge}
        </Badge>
      </div>
    </button>
  );
}

function AppLayout({ children }: { children: React.ReactNode }) {
  const mode = useDeployStore((s) => s.mode);
  const reset = useDeployStore((s) => s.reset);
  const { t, locale, setLocale } = useLocaleStore();
  const token = useAuthStore((s) => s.token);
  const router = useRouter();

  return (
    <main className="flex min-h-screen flex-col items-center">
      <header className="w-full border-b border-border/40 bg-background/60 backdrop-blur-sm">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <button onClick={reset} className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-primary" />
            <span className="text-lg font-bold tracking-tight">AnixOps</span>
          </button>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            {mode === "rental" && (
              <span className="text-xs text-muted-foreground">{t("mode.rental.label")}</span>
            )}
            {mode === "rental" && token && (
              <button
                onClick={() => router.push("/payments")}
                className="rounded-md border px-2 py-0.5 text-xs hover:bg-muted transition"
              >
                {t("payment.history")}
              </button>
            )}
            <button
              onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
              className="rounded-md border px-2 py-0.5 text-xs hover:bg-muted transition"
            >
              {locale === "zh" ? t("common.lang.en") : t("common.lang.zh")}
            </button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 md:py-12">
        <div className="mx-auto max-w-2xl">{children}</div>
      </div>

      <footer className="mt-auto w-full border-t border-border/40 py-6">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          {t("footer.free")} ·{" "}
          <a href="#kb" className="text-primary hover:underline">{t("footer.kb")}</a>
          {" "}·{" "}
          <a href="#ai-agent" className="text-primary hover:underline">{t("footer.ai")} →</a>
          <div className="mt-2 text-xs text-muted-foreground/80">FE v{versions.frontend}</div>
        </div>
      </footer>
    </main>
  );
}
