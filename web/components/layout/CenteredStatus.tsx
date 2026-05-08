"use client";

import type { ReactNode } from "react";
import { Card } from "@/components/ui";

type CenteredStatusTone = "neutral" | "success" | "warning" | "danger";

export function CenteredStatus({
  eyebrow,
  title,
  body,
  tone,
  action,
  meta,
  pulse = false,
  iconLabel = "AX",
}: {
  eyebrow: string;
  title: string;
  body: string;
  tone: CenteredStatusTone;
  action?: ReactNode;
  meta?: ReactNode;
  pulse?: boolean;
  iconLabel?: string;
}) {
  const accent =
    tone === "success"
      ? "bg-green-100 text-green-700"
      : tone === "warning"
        ? "bg-amber-50 text-amber-700"
        : tone === "danger"
          ? "bg-red-50 text-red-600"
          : "bg-primary/10 text-primary";

  return (
    <div className="apple-shell flex min-h-[70vh] items-center justify-center px-4">
      <Card className="animate-rise max-w-2xl space-y-5 p-8 text-center">
        <div
          className={`mx-auto grid h-16 w-16 place-items-center rounded-full text-xl font-semibold ${accent} ${
            pulse ? "animate-pulse" : ""
          }`}
        >
          {iconLabel}
        </div>
        <div className="section-eyebrow">{eyebrow}</div>
        <h2 className="text-3xl font-semibold tracking-[-0.045em]">{title}</h2>
        <p className="mx-auto max-w-xl text-sm leading-7 text-muted-foreground">{body}</p>
        {meta ? <div className="flex justify-center">{meta}</div> : null}
        {action}
      </Card>
    </div>
  );
}
