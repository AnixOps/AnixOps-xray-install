"use client";

import type { ReactNode } from "react";
import { cn } from "@/components/ui/utils";

export function WorkspaceShell({
  header,
  children,
  className,
  contentClassName,
}: {
  header: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <main className={cn("min-h-screen bg-background", className)}>
      <div className="border-b border-border/40 bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-[1480px] px-4 py-3 md:px-6">{header}</div>
      </div>
      <div className={cn("mx-auto max-w-[1480px] px-4 py-6 md:px-6 md:py-10", contentClassName)}>{children}</div>
    </main>
  );
}
