"use client";

import Link from "next/link";
import { useLocaleStore } from "@/lib/i18n/store";
import { Card } from "@/components/ui";

export default function NotFound() {
  const { t, locale } = useLocaleStore();
  const isZh = locale === "zh";

  return (
    <div className="apple-shell flex min-h-[70vh] items-center justify-center px-4">
      <Card className="animate-rise max-w-2xl space-y-5 p-8 text-center">
        <div className="section-eyebrow">Not found</div>
        <h2 className="text-6xl font-semibold tracking-[-0.065em]">{t("notFound.title")}</h2>
        <p className="mx-auto max-w-xl text-sm leading-7 text-muted-foreground">
          {t("notFound.desc")}
        </p>
        <div className="rounded-[1.5rem] border border-black/5 bg-white/70 px-5 py-4 text-sm leading-6 text-muted-foreground">
          {isZh
            ? "页面可能已经移动，或者这条路径从未存在。回到首页后可以重新进入自托管、按租或后台入口。"
            : "The page may have moved, or the route may never have existed. Return home to re-enter the self-hosted, rental, or admin paths."}
        </div>
        <Link
          href="/"
          className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-[0_14px_32px_rgba(0,113,227,0.26)] transition hover:-translate-y-0.5 hover:bg-primary/90"
        >
          {t("notFound.back")}
        </Link>
      </Card>
    </div>
  );
}
