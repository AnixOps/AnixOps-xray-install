"use client";

import { useLocaleStore } from "@/lib/i18n/store";
import { Card } from "@/components/ui";

export default function Loading() {
  const { t, locale } = useLocaleStore();
  const isZh = locale === "zh";

  return (
    <div className="apple-shell flex min-h-[70vh] items-center justify-center px-4">
      <Card className="animate-rise max-w-xl space-y-4 p-8 text-center">
        <div className="mx-auto grid h-14 w-14 animate-pulse place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          AX
        </div>
        <div className="section-eyebrow">Loading</div>
        <h2 className="text-3xl font-semibold">
          {isZh ? "正在准备当前视图。" : "Preparing the current view."}
        </h2>
        <p className="text-sm leading-7 text-muted-foreground">{t("rental.loadingConfig")}</p>
      </Card>
    </div>
  );
}
