"use client";

import { useRouter } from "next/navigation";
import { useDeployStore } from "@/lib/deploy/store";
import { useLocaleStore } from "@/lib/i18n/store";
import { Button, Card } from "@/components/ui";

export default function RentalCancelPage() {
  const router = useRouter();
  const { t } = useLocaleStore();
  const setStep = useDeployStore((s) => s.setStep);
  const setStatus = useDeployStore((s) => s.setStatus);

  const handleRetry = () => {
    setStatus("pending");
    setStep(2);
    router.push("/");
  };

  return (
    <div className="mx-auto max-w-lg space-y-6 py-12 text-center">
      <Card className="p-6 space-y-4">
        <div className="text-3xl">❌</div>
        <h2 className="text-xl font-semibold">{t("rental.cancel.title")}</h2>
        <p className="text-muted-foreground">
          {t("rental.cancel.desc")}
        </p>
        <div className="flex justify-center gap-3">
          <Button variant="outline" onClick={() => router.push("/")}>
            {t("nav.home")}
          </Button>
          <Button onClick={handleRetry}>
            {t("common.retry")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
