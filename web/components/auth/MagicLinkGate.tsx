"use client";

import { useState } from "react";
import { Button, Card, Input } from "@/components/ui";
import { normalizeReturnToPath } from "@/lib/auth/redirect";
import { useLocaleStore } from "@/lib/i18n/store";

type MagicLinkVariant = "self-hosted" | "console";

interface MagicLinkGateProps {
  variant: MagicLinkVariant;
  returnTo: string;
}

function readJsonResponse(res: Response) {
  return res.text().then((text) => {
    if (!text.trim()) {
      return { error: `Empty response from server (${res.status})` };
    }
    try {
      return JSON.parse(text);
    } catch {
      return { error: text || `Invalid response from server (${res.status})` };
    }
  });
}

function formatAuthError(data: { error?: string; code?: string }, isZh: boolean) {
  if (data.code === "AUTH_EMAIL_NOT_CONFIGURED") {
    return isZh
      ? "登录邮件服务尚未配置。请先在服务器环境中配置 SMTP_HOST、SMTP_USER 和 SMTP_PASS。"
      : "Email sign-in is not configured yet. Configure SMTP_HOST, SMTP_USER, and SMTP_PASS on the server.";
  }
  if (data.code === "AUTH_EMAIL_DELIVERY_FAILED") {
    return isZh
      ? "登录邮件暂时发送失败。请稍后重试，或检查 SMTP 服务状态。"
      : "The sign-in email could not be sent. Try again later or check the SMTP service.";
  }
  return data.error || (isZh ? "登录请求失败。" : "Sign-in request failed.");
}

export function MagicLinkGate({ variant, returnTo }: MagicLinkGateProps) {
  const { t, locale } = useLocaleStore();
  const isZh = locale === "zh";
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const copy = variant === "self-hosted"
    ? {
        leftEyebrow: isZh ? "Private access" : "Private access",
        leftTitle: isZh ? "先确认身份，再进入自托管部署。" : "Authorize first, then move straight into deployment.",
        leftDescription: isZh
          ? "AnixOps 把登录压缩成一个动作，只在真正需要写入服务器或云账号之前进行授权。"
          : "AnixOps compresses access into a single step and only asks for it right before you need to touch servers or cloud credentials.",
        highlights: isZh
          ? [
              "只在需要时开启授权，部署路径更干净。",
              "邮件登录避免在浏览器侧保存额外管理密码。",
              "登录后直接进入自托管流程，不做无意义跳转。",
            ]
          : [
              "Authorize only when you actually need deployment access.",
              "Email sign-in avoids storing another admin password in the browser.",
              "Once verified, you drop directly into the self-hosted flow.",
            ],
        routeDetail: isZh
          ? "Magic link 会返回到自托管流程。"
          : "Magic link returns you to the self-hosted flow.",
        formEyebrow: isZh ? "Secure sign-in" : "Secure sign-in",
        formDescription: t("auth.magicLink.desc"),
        note: isZh
          ? "授权邮件会发送到你填写的地址。完成验证后，部署凭据只在当前会话中使用。"
          : "The sign-in link is sent to the address above. Once verified, deployment credentials are used only in the current session.",
      }
    : {
        leftEyebrow: isZh ? "Console access" : "Console access",
        leftTitle: isZh ? "登录后打开你的钱包控制台。" : "Sign in to open your wallet console.",
        leftDescription: isZh
          ? "普通用户可以通过邮件链接登录，查看钱包、节点、审计和推荐奖励。"
          : "Regular users can sign in with email to view wallet, nodes, audit, and referral data.",
        highlights: isZh
          ? [
              "普通用户也能直接登录，不需要管理员权限。",
              "验证完成后会自动回到钱包控制台。",
              "同一套邮箱登录可访问账户相关页面。",
            ]
          : [
              "Regular users can sign in without admin privileges.",
              "Verification brings you back to the wallet console automatically.",
              "The same email login opens account-related pages.",
            ],
        routeDetail: isZh
          ? "Magic link 会在验证后返回 /console/wallet。"
          : "Magic link returns to /console/wallet after verification.",
        formEyebrow: isZh ? "Account sign-in" : "Account sign-in",
        formDescription: isZh
          ? "输入你的邮箱，验证后就会返回钱包控制台。"
          : "Enter your email and you'll be sent back to the wallet console after verification.",
        note: isZh
          ? "如果你已存在会话，登录后会恢复同一账户。"
          : "If you already have a session, sign-in restores the same account.",
      };

  const sendLink = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const payload: { email: string; returnTo?: string } = { email };
      const normalizedReturnTo = normalizeReturnToPath(returnTo, "");
      if (normalizedReturnTo) {
        payload.returnTo = normalizedReturnTo;
      }
      const res = await fetch("/api/auth/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await readJsonResponse(res);
      if (data.error) {
        setError(formatAuthError(data, isZh));
      } else {
        setMessage(t("auth.magicLink.sent"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error.generic"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[0.88fr_1.12fr]">
      <Card className="relative overflow-hidden border-white/60 bg-slate-950 p-6 text-white shadow-[0_30px_80px_rgba(15,23,42,0.22)] md:p-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(76,146,255,0.36),transparent_30%),radial-gradient(circle_at_80%_80%,rgba(255,180,120,0.18),transparent_34%)]" />
        <div className="relative space-y-6">
          <div className="space-y-3">
            <div className="section-eyebrow text-white/55">{copy.leftEyebrow}</div>
            <h2 className="max-w-md text-3xl font-semibold md:text-4xl">
              {copy.leftTitle}
            </h2>
            <p className="max-w-lg text-sm leading-7 text-white/72 md:text-base">
              {copy.leftDescription}
            </p>
          </div>

          <div className="space-y-3">
            {copy.highlights.map((item) => (
              <div
                key={item}
                className="rounded-[1.4rem] border border-white/12 bg-white/10 px-4 py-4 text-sm leading-6 text-white/82 backdrop-blur-xl"
              >
                {item}
              </div>
            ))}
          </div>

          <div className="rounded-[1.6rem] border border-white/12 bg-white/10 p-4 backdrop-blur-xl">
            <div className="text-xs uppercase tracking-[0.28em] text-white/42">
              {isZh ? "Access route" : "Access route"}
            </div>
            <div className="mt-3 flex items-center gap-3 text-sm text-white/74">
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-950">
                Mail
              </span>
              <span>{copy.routeDetail}</span>
            </div>
          </div>
        </div>
      </Card>

      <Card className="space-y-6 p-6 md:p-8">
        <div className="space-y-2">
          <div className="section-eyebrow">{copy.formEyebrow}</div>
          <h2 className="text-3xl font-semibold">{t("auth.magicLink.title")}</h2>
          <p className="max-w-xl text-sm leading-7 text-muted-foreground md:text-base">
            {copy.formDescription}
          </p>
        </div>

        <div className="rounded-[1.75rem] border border-black/5 bg-white/80 p-4 shadow-inner shadow-black/[0.03] md:p-5">
          <div className="mb-3 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
            {isZh ? "Work email" : "Work email"}
          </div>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("rental.emailPlaceholder")}
            className="h-12 rounded-[1.15rem]"
          />
        </div>

        {message && (
          <div className="rounded-[1.35rem] border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            {message}
          </div>
        )}
        {error && (
          <div className="rounded-[1.35rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-black/5 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-md text-xs leading-6 text-muted-foreground">
            {copy.note}
          </p>
          <Button disabled={!email || loading} onClick={sendLink} className="h-12 px-6">
            {loading ? t("common.processing") : t("auth.magicLink.send")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
