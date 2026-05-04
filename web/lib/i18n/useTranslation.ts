import { useCallback } from "react";
import { useLocaleStore } from "@/lib/i18n/store";
import { t, tPlan } from "@/lib/i18n/locales";
import type { Locale } from "@/lib/i18n/locales";

export function useTranslation() {
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);

  const translate = useCallback(
    (key: string) => t(locale, key),
    [locale],
  );

  const translatePlan = useCallback(
    (planId: string) => tPlan(locale, planId),
    [locale],
  );

  return {
    t: translate,
    tPlan: translatePlan,
    locale,
    setLocale,
  };
}
