"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore } from "@/lib/auth/store";
import { normalizeReturnToPath } from "@/lib/auth/redirect";
import { Button, Card } from "@/components/ui";
import { useLocaleStore } from "@/lib/i18n/store";

export default function AuthCallbackPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t, locale } = useLocaleStore();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [error, setError] = useState<string | null>(null);
  const isZh = locale === "zh";

  useEffect(() => {
    const token = searchParams.get("token");
    const returnTo = normalizeReturnToPath(searchParams.get("returnTo"), "/");
    if (!token) {
      setError(t("auth.magicLink.missingToken"));
      return;
    }

    fetch("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(readJsonResponse)
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setAuth(data.userId, data.token, data.email, Boolean(data.isAdmin));
        router.push(returnTo);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Verification failed");
      });
  }, [router, searchParams, setAuth, t]);

  return (
    <div className="apple-shell flex min-h-[70vh] items-center justify-center px-4">
      <Card className="animate-rise max-w-2xl space-y-5 p-8 text-center">
        <div className={`mx-auto grid h-16 w-16 place-items-center rounded-full text-sm font-semibold ${error ? "bg-red-50 text-red-600" : "bg-primary/10 text-primary"}`}>
          {error ? "!" : "AX"}
        </div>
        <div className="section-eyebrow">{error ? "Access failed" : "Secure sign-in"}</div>
        <h1 className="text-3xl font-semibold tracking-[-0.045em]">
          {error ? t("error.title") : t("auth.magicLink.signingIn")}
        </h1>
        <p className="mx-auto max-w-xl text-sm leading-7 text-muted-foreground">
          {error || t("auth.magicLink.verifying")}
        </p>
        <div className="rounded-[1.5rem] border border-black/5 bg-white/70 px-5 py-4 text-sm leading-6 text-muted-foreground">
          {error
            ? (isZh
              ? "这通常表示登录链接已经失效、被使用过，或者当前会话无法完成验证。"
              : "This usually means the link expired, has already been used, or the current session could not complete verification.")
            : (isZh
              ? "验证成功后会自动回到你发起登录的页面，并恢复你的登录状态与权限。"
              : "After verification succeeds, you will be returned to the page where you started sign-in with your session and access restored.")}
        </div>
        {error && (
          <Button variant="outline" onClick={() => router.push("/")}>
            {t("nav.home")}
          </Button>
        )}
      </Card>
    </div>
  );
}

async function readJsonResponse(res: Response) {
  const text = await res.text();
  if (!text.trim()) {
    return { error: `Empty response from server (${res.status})` };
  }
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || `Invalid response from server (${res.status})` };
  }
}
