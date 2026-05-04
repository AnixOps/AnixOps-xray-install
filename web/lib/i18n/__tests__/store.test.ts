import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useLocaleStore } from "../store";

describe("locale store", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "zh" });
  });

  afterEach(() => {
    useLocaleStore.setState({ locale: "zh" });
  });

  it("defaults to zh locale", () => {
    expect(useLocaleStore.getState().locale).toBe("zh");
  });

  it("switches locale via setLocale", () => {
    useLocaleStore.getState().setLocale("en");
    expect(useLocaleStore.getState().locale).toBe("en");
  });

  it("t() translates known keys", () => {
    const { t } = useLocaleStore.getState();
    expect(t("app.name")).toBe("AnixOps");
  });

  it("t() returns correct translation for current locale", () => {
    useLocaleStore.getState().setLocale("en");
    const { t } = useLocaleStore.getState();
    expect(t("nav.home")).toBe("Home");

    useLocaleStore.getState().setLocale("zh");
    const { t: tZh } = useLocaleStore.getState();
    expect(tZh("nav.home")).toBe("首页");
  });

  it("tPlan() returns plan label for current locale", () => {
    useLocaleStore.getState().setLocale("en");
    const { tPlan } = useLocaleStore.getState();
    expect(tPlan("1h")).toBe("1 hour");

    useLocaleStore.getState().setLocale("zh");
    const { tPlan: tPlanZh } = useLocaleStore.getState();
    expect(tPlanZh("1h")).toBe("1 小时");
  });
});
