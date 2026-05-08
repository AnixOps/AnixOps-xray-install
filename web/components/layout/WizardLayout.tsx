"use client";

import type { ReactNode } from "react";
import { Card } from "@/components/ui";
import { cn } from "@/components/ui/utils";

export function WizardFrame({
  eyebrow,
  title,
  description,
  stepLabel,
  children,
  aside,
}: {
  eyebrow: string;
  title: string;
  description: string;
  stepLabel: string;
  children: ReactNode;
  aside: ReactNode;
}) {
  return (
    <div className="animate-rise grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="space-y-7 p-6 md:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="section-eyebrow">{eyebrow}</div>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.045em] md:text-4xl">{title}</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{description}</p>
          </div>
          <div className="metric-pill self-start">{stepLabel}</div>
        </div>
        {children}
      </Card>
      <div className="space-y-4">{aside}</div>
    </div>
  );
}

export function WizardAside({
  title,
  rows,
  footer,
  eyebrow = "Snapshot",
}: {
  title: string;
  rows: Array<{ label: string; value: string }>;
  footer?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <Card className="space-y-5 p-5">
      <div>
        <div className="section-eyebrow">{eyebrow}</div>
        <h3 className="mt-2 text-xl font-semibold tracking-[-0.03em]">{title}</h3>
      </div>
      <div className="space-y-3">
        {rows.map((row) => (
          <WizardSummaryRow key={row.label} label={row.label} value={row.value} />
        ))}
      </div>
      {footer}
    </Card>
  );
}

export function WizardSummaryRow({
  label,
  value,
  emphasize = false,
  mono = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  mono?: boolean;
}) {
  const valueClassName = mono
    ? "max-w-[60%] break-all font-mono text-right text-sm"
    : emphasize
      ? "max-w-[60%] text-right text-sm font-semibold text-primary"
      : "max-w-[60%] text-right text-sm font-medium text-foreground";

  return (
    <div className="flex items-center justify-between gap-4 rounded-[1.2rem] border border-black/5 bg-white/70 px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn(valueClassName)}>{value}</span>
    </div>
  );
}
