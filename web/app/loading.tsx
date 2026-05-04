"use client";

import { useLocaleStore } from "@/lib/i18n/store";

export default function Loading() {
  const { t } = useLocaleStore();

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="text-center">
        <div className="text-3xl animate-pulse">⏳</div>
        <p className="mt-4 text-muted-foreground">{t("rental.loadingConfig")}</p>
      </div>
    </div>
  );
}
