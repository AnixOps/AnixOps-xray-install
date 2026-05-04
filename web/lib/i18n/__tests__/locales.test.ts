import { describe, it, expect } from "vitest";
import { translations, defaultLocale, t } from "../locales";

describe("i18n locale parity", () => {
  it("all zh keys have en equivalents", () => {
    const zhKeys = Object.keys(translations.zh);
    const enKeys = new Set(Object.keys(translations.en));

    const missing = zhKeys.filter((k) => !enKeys.has(k));
    expect(missing).toEqual([]);
  });

  it("all en keys have zh equivalents", () => {
    const enKeys = Object.keys(translations.en);
    const zhKeys = new Set(Object.keys(translations.zh));

    const missing = enKeys.filter((k) => !zhKeys.has(k));
    expect(missing).toEqual([]);
  });

  it("no empty translation values", () => {
    for (const [locale, map] of Object.entries(translations)) {
      for (const [key, value] of Object.entries(map)) {
        expect(value.trim()).not.toBe("");
      }
    }
  });

  it("default locale is zh", () => {
    expect(defaultLocale).toBe("zh");
  });

  it("t() returns key as fallback for missing translations", () => {
    const result = t("zh", "nonexistent.key");
    expect(result).toBe("nonexistent.key");
  });

  it("t() returns correct value for existing key", () => {
    expect(t("zh", "app.name")).toBe("AnixOps");
    expect(t("en", "app.name")).toBe("AnixOps");
  });

  it("does not expose free trial payment copy", () => {
    expect(translations.zh["payment.freeTrial"]).toBeUndefined();
    expect(translations.en["payment.freeTrial"]).toBeUndefined();
  });
});
