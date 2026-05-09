"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Toaster, toast as sonnerToast } from "sonner";

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextValue {
  toasts: Toast[];
  showToast: (message: string, type?: ToastType, duration?: number) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_TOAST_DURATION = 2_147_483_647;

function createToastId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  const random = globalThis.crypto?.getRandomValues
    ? Array.from(globalThis.crypto.getRandomValues(new Uint32Array(2))).map((value) => value.toString(16)).join("")
    : Math.random().toString(16).slice(2);

  return `toast-${Date.now().toString(16)}-${random}`;
}

function emitToast(message: string, type: ToastType, duration: number, id: string) {
  const options = { duration, id };

  switch (type) {
    case "success":
      return sonnerToast.success(message, options);
    case "error":
      return sonnerToast.error(message, options);
    case "warning":
      return sonnerToast.warning(message, options);
    case "info":
    default:
      return sonnerToast.info(message, options);
  }
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
  const timerRefs = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismissToast = useCallback((id: string) => {
    const timer = timerRefs.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timerRefs.current.delete(id);
    }
    sonnerToast.dismiss(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = "info", duration = 5000) => {
      const id = createToastId();
      const effectiveDuration = duration > 0 ? duration : MAX_TOAST_DURATION;
      setToasts((prev) => [...prev, { id, message, type, duration: effectiveDuration }]);
      emitToast(message, type, effectiveDuration, id);

      if (duration > 0) {
        const timer = setTimeout(() => {
          timerRefs.current.delete(id);
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, duration);
        timerRefs.current.set(id, timer);
      }
    },
    []
  );

  useEffect(() => {
    return () => {
      timerRefs.current.forEach((timer) => clearTimeout(timer));
      timerRefs.current.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismissToast }}>
      {children}
      <Toaster
        position="top-right"
        richColors
        closeButton
        expand
        theme="system"
        toastOptions={{
          classNames: {
            toast:
              "rounded-[1.5rem] border border-border/70 bg-white/92 text-foreground shadow-[0_14px_36px_rgba(15,23,42,0.14)] backdrop-blur-xl dark:bg-slate-950/95 dark:text-slate-50",
            title: "text-sm font-medium",
            description: "text-sm leading-6 text-muted-foreground",
            closeButton:
              "border border-border/70 bg-background/90 text-muted-foreground hover:bg-muted dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10",
            success: "border-emerald-200/80",
            error: "border-rose-200/80",
            warning: "border-amber-200/80",
            info: "border-sky-200/80",
          },
        }}
      />
    </ToastContext.Provider>
  );
}
