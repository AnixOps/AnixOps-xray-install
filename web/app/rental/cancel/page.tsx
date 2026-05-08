"use client";

import { useRouter } from "next/navigation";
import { useDeployStore } from "@/lib/deploy/store";
import { useLocaleStore } from "@/lib/i18n/store";
import { Button } from "@/components/ui";
import { CenteredStatus } from "@/components/layout/CenteredStatus";

export default function RentalCancelPage() {
  const router = useRouter();
  const { t, locale } = useLocaleStore();
  const setStep = useDeployStore((s) => s.setStep);
  const setStatus = useDeployStore((s) => s.setStatus);
  const isZh = locale === "zh";

  const handleRetry = () => {
    setStatus("pending");
    setStep(2);
    router.push("/");
  };

  return (
    <CenteredStatus
      eyebrow="Checkout paused"
      title={t("rental.cancel.title")}
      body={t("rental.cancel.desc")}
      tone="warning"
      action={(
        <div className="flex flex-col justify-center gap-3 sm:flex-row">
          <Button variant="outline" onClick={() => router.push("/")}>
            {t("nav.home")}
          </Button>
          <Button onClick={handleRetry}>{t("common.retry")}</Button>
        </div>
      )}
      meta={(
        <div className="rounded-[1.5rem] border border-black/5 bg-white/70 px-5 py-4 text-sm leading-6 text-muted-foreground">
          {isZh
            ? "支付被取消后，当前选择不会自动丢失。你可以返回首页继续当前配置，或者稍后再开始。"
            : "Cancelling checkout does not destroy your current selections. Return home to continue the same setup now or later."}
        </div>
      )}
    />
  );
}
