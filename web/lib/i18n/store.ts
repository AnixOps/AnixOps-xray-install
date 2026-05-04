import { create } from "zustand";
import { t, tPlan } from "@/lib/i18n/locales";
import type { Locale } from "@/lib/i18n/locales";

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
  tPlan: (planId: string) => string;
}

export const useLocaleStore = create<LocaleState>((set, get) => ({
  locale: (typeof window !== "undefined" && (localStorage.getItem("anixops-locale") as Locale)) || "zh",
  setLocale: (locale) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("anixops-locale", locale);
      // Also set a cookie so server-side layout.tsx can read it
      document.cookie = `locale=${locale}; path=/; max-age=31536000; SameSite=Lax`;
    }
    set({ locale });
  },
  t: (key: string) => t(get().locale, key),
  tPlan: (planId: string) => tPlan(get().locale, planId),
}));
