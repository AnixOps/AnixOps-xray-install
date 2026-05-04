"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore } from "@/lib/auth/store";
import { Button, Card } from "@/components/ui";
import { useLocaleStore } from "@/lib/i18n/store";

export default function AuthCallbackPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t } = useLocaleStore();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setError(t("auth.magicLink.missingToken"));
      return;
    }

    fetch("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setAuth(data.userId, data.token, data.email);
        router.push("/");
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Verification failed");
      });
  }, [router, searchParams, setAuth, t]);

  return (
    <div className="mx-auto max-w-lg py-12">
      <Card className="p-6 space-y-4 text-center">
        <h1 className="text-xl font-semibold">{error ? t("error.title") : t("auth.magicLink.signingIn")}</h1>
        <p className="text-sm text-muted-foreground">{error || t("auth.magicLink.verifying")}</p>
        {error && (
          <Button variant="outline" onClick={() => router.push("/")}>
            {t("nav.home")}
          </Button>
        )}
      </Card>
    </div>
  );
}
