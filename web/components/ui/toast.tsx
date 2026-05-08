"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import { cn } from "./index";

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextValue {
  toasts: Toast[];
  showToast: (message: string, type: ToastType, duration?: number) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

function createToastId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  const random = globalThis.crypto?.getRandomValues
    ? Array.from(globalThis.crypto.getRandomValues(new Uint32Array(2))).map((value) => value.toString(16)).join("")
    : Math.random().toString(16).slice(2);
  return `toast-${Date.now().toString(16)}-${random}`;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = "info", duration = 5000) => {
    const id = createToastId();
    const toast: Toast = { id, message, type, duration };
    setToasts((prev) => [...prev, toast]);

    if (duration > 0) {
      setTimeout(() => dismissToast(id), duration);
    }
  }, [dismissToast]);

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismissToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-4 top-4 z-50 flex flex-col items-stretch gap-2 md:right-4 md:left-auto md:w-[380px]">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const icons: Record<ToastType, string> = {
    success: "OK",
    error: "!",
    warning: "!",
    info: "i",
  };

  const styles: Record<ToastType, string> = {
    success: "border-green-200/80 text-green-800 before:bg-green-500",
    error: "border-red-200/80 text-red-800 before:bg-red-500",
    warning: "border-amber-200/80 text-amber-800 before:bg-amber-500",
    info: "border-blue-200/80 text-blue-800 before:bg-blue-500",
  };

  return (
    <div
      className={cn(
        "pointer-events-auto animate-rise relative flex min-w-[280px] max-w-md items-start gap-3 overflow-hidden rounded-[1.4rem] border bg-white/92 px-4 py-3 shadow-[0_18px_48px_rgba(18,30,49,0.14)] backdrop-blur-2xl before:absolute before:inset-y-0 before:left-0 before:w-1",
        styles[toast.type]
      )}
      role="alert"
    >
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/80 text-[10px] font-bold shadow-sm">
        {icons[toast.type]}
      </span>
      <div className="flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {toast.type}
        </div>
        <p className="mt-1 text-sm font-medium leading-6">{toast.message}</p>
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-black/5"
        aria-label="Dismiss"
      >
        x
      </button>
    </div>
  );
}
