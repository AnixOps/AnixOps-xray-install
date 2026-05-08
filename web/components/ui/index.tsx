import React from "react";

export function cn(...classes: (string | undefined | false | null)[]) {
  return classes.filter(Boolean).join(" ");
}

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
    "inline-flex items-center justify-center rounded-full text-sm font-semibold tracking-[-0.01em] transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";

  const variants: Record<string, string> = {
    default: "bg-primary text-primary-foreground shadow-[0_14px_32px_rgba(0,113,227,0.26)] hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-[0_18px_40px_rgba(0,113,227,0.34)]",
    outline: "border border-black/10 bg-white/75 text-foreground shadow-sm backdrop-blur-xl hover:-translate-y-0.5 hover:bg-white/95 hover:shadow-md",
    ghost: "text-foreground hover:bg-black/5",
    destructive: "bg-destructive text-destructive-foreground shadow-[0_14px_32px_rgba(194,39,27,0.22)] hover:-translate-y-0.5 hover:bg-destructive/90 hover:shadow-[0_18px_40px_rgba(194,39,27,0.3)]",
  };

  const sizes: Record<string, string> = {
    default: "h-11 px-5 py-2",
    sm: "h-9 px-3.5",
    lg: "h-12 px-8",
    icon: "h-10 w-10",
  };

  return <button className={cn(base, variants[variant], sizes[size], className)} {...props} />;
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "flex h-11 w-full rounded-2xl border border-black/10 bg-white/80 px-4 py-2 text-sm shadow-sm backdrop-blur-xl ring-offset-background transition-all file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
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
      className={cn("text-sm font-semibold leading-none tracking-[-0.01em] peer-disabled:cursor-not-allowed peer-disabled:opacity-70", className)}
      {...props}
    />
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-[2rem] border border-white/70 bg-white/75 text-card-foreground shadow-[0_18px_55px_rgba(18,30,49,0.08)] backdrop-blur-xl", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-2xl font-semibold leading-none tracking-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center p-6 pt-0", className)} {...props} />;
}

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: "default" | "secondary" | "destructive" | "outline" }) {
  const variants: Record<string, string> = {
    default: "bg-primary text-primary-foreground shadow-sm",
    secondary: "bg-secondary text-secondary-foreground",
    destructive: "bg-destructive text-destructive-foreground shadow-sm",
    outline: "border border-black/10 bg-white/60 text-foreground backdrop-blur",
  };
  return (
    <div
      className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors", variants[variant], className)}
      {...props}
    />
  );
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-secondary", className)}>
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
        "flex min-h-[80px] w-full rounded-2xl border border-black/10 bg-white/80 px-4 py-3 text-sm shadow-sm backdrop-blur-xl ring-offset-background placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}
