"use client";

import { useEffect } from "react";
import { useLocaleStore } from "@/lib/i18n/store";
import { Button, Card } from "@/components/ui";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t, locale } = useLocaleStore();
  const isZh = locale === "zh";

  useEffect(() => {
    console.error("AnixOps app error:", error);
  }, [error]);

  return (
    <div className="apple-shell flex min-h-[70vh] items-center justify-center px-4">
      <Card className="animate-rise max-w-2xl space-y-5 p-8 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-red-50 text-xl font-semibold text-red-600">
          AX
        </div>
        <div className="section-eyebrow">Error</div>
        <h2 className="text-3xl font-semibold text-red-600">
          {t("error.title")}
        </h2>
        <p className="mx-auto max-w-xl text-sm leading-7 text-muted-foreground">
          {error.message || (isZh ? "当前页面未能正确加载。" : "The current view could not be rendered correctly.")}
        </p>
        <Button onClick={() => reset()}>{t("error.retry")}</Button>
      </Card>
    </div>
  );
}
