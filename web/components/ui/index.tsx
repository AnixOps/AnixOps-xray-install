"use client";

import React, { createContext, useContext, useState } from "react";
import { cn } from "./utils";

export { cn } from "./utils";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "destructive";
  size?: "default" | "sm" | "lg" | "icon";
}

export function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl border border-transparent text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";

  const variants: Record<string, string> = {
    default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:shadow-md",
    outline: "border border-border bg-background/80 text-foreground shadow-sm hover:bg-muted/50",
    ghost: "text-foreground hover:bg-muted/60",
    destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
  };

  const sizes: Record<string, string> = {
    default: "h-10 px-4 py-2",
    sm: "h-9 px-3.5",
    lg: "h-11 px-5",
    icon: "h-10 w-10",
  };

  return <button className={cn(base, variants[variant], sizes[size], className)} {...props} />;
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "flex h-10 w-full rounded-xl border border-border bg-background/80 px-3.5 py-2 text-sm shadow-sm ring-offset-background transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {}

export function Label({ className, ...props }: LabelProps) {
  return (
    <label
      className={cn("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", className)}
      {...props}
    />
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-2xl border border-border/70 bg-card text-card-foreground shadow-sm", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 p-6 pb-4", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-xl font-semibold leading-tight tracking-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center gap-3 p-6 pt-0", className)} {...props} />;
}

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: "default" | "secondary" | "destructive" | "outline" }) {
  const variants: Record<string, string> = {
    default: "bg-primary/10 text-primary ring-1 ring-inset ring-primary/20",
    secondary: "bg-muted text-foreground",
    destructive: "bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20",
    outline: "border border-border bg-background/80 text-foreground",
  };
  return (
    <div
      className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors", variants[variant], className)}
      {...props}
    />
  );
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export * from "./toast";

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "flex min-h-[96px] w-full rounded-xl border border-border bg-background/80 px-3.5 py-3 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export function Separator({
  className,
  orientation = "horizontal",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { orientation?: "horizontal" | "vertical" }) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        "shrink-0 bg-border",
        className
      )}
      {...props}
    />
  );
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full caption-bottom text-sm", className)} {...props} />;
}

export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("[&_tr]:border-b", className)} {...props} />;
}

export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

export function TableFooter({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tfoot className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)} {...props} />;
}

export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "border-b transition-colors hover:bg-muted/40 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "h-12 px-4 text-left align-middle text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-3 align-middle", className)} {...props} />;
}

export function TableCaption({ className, ...props }: React.HTMLAttributes<HTMLTableCaptionElement>) {
  return <caption className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />;
}

type TabsContextValue = {
  value: string;
  setValue: (value: string) => void;
};

const TabsContext = createContext<TabsContextValue | null>(null);

export function Tabs({
  value,
  defaultValue,
  onValueChange,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const currentValue = value ?? internalValue;

  const setValue = (nextValue: string) => {
    if (value === undefined) {
      setInternalValue(nextValue);
    }
    onValueChange?.(nextValue);
  };

  return (
    <TabsContext.Provider value={{ value: currentValue, setValue }}>
      <div className={cn("flex flex-col gap-3", className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div role="tablist" className={cn("inline-flex h-10 items-center rounded-xl bg-muted p-1 text-muted-foreground", className)} {...props} />;
}

export function TabsTrigger({
  className,
  value,
  onClick,
  type: _type,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) {
  const context = useContext(TabsContext);
  const active = context?.value === value;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-state={active ? "active" : "inactive"}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          context?.setValue(value);
        }
      }}
      className={cn(
        "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
        className
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  value,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { value: string }) {
  const context = useContext(TabsContext);

  if (context?.value !== value) {
    return null;
  }

  return <div role="tabpanel" className={cn("focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)} {...props} />;
}
