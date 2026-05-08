"use client";

import { useRouter } from "next/navigation";
import { useDeployStore } from "@/lib/deploy/store";
import { useLocaleStore } from "@/lib/i18n/store";
import { Button, Card } from "@/components/ui";

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
    <div className="apple-shell flex min-h-[70vh] items-center justify-center px-4">
      <Card className="animate-rise max-w-2xl space-y-5 p-8 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-amber-50 text-xl font-semibold text-amber-700">
          AX
        </div>
        <div className="section-eyebrow">Checkout paused</div>
        <h2 className="text-3xl font-semibold tracking-[-0.045em]">{t("rental.cancel.title")}</h2>
        <p className="mx-auto max-w-xl text-sm leading-7 text-muted-foreground">
          {t("rental.cancel.desc")}
        </p>
        <div className="rounded-[1.5rem] border border-black/5 bg-white/70 px-5 py-4 text-sm leading-6 text-muted-foreground">
          {isZh
            ? "支付被取消后，当前选择不会自动丢失。你可以返回首页继续当前配置，或者稍后再开始。"
            : "Cancelling checkout does not destroy your current selections. Return home to continue the same setup now or later."}
        </div>
        <div className="flex flex-col justify-center gap-3 sm:flex-row">
          <Button variant="outline" onClick={() => router.push("/")}>
            {t("nav.home")}
          </Button>
          <Button onClick={handleRetry}>{t("common.retry")}</Button>
        </div>
      </Card>
    </div>
  );
}
