"use client";

import { useEffect } from "react";
import { useLocaleStore } from "@/lib/i18n/store";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useLocaleStore();

  useEffect(() => {
    console.error("AnixOps app error:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg py-12 text-center">
      <h2 className="text-xl font-semibold text-red-600">{t("error.title")}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
      <button
        className="mt-4 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
        onClick={() => reset()}
      >
        {t("error.retry")}
      </button>
    </div>
  );
}
