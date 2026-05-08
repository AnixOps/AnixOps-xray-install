import { afterEach, describe, expect, it, vi } from "vitest";
import { buildNoStoreHeaders, fetchWithProxyTimeout, getProxyErrorDetail, getProxyTimeoutMs } from "../proxy-utils";

describe("API proxy utilities", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("uses a safe default timeout unless a positive override is provided", () => {
    expect(getProxyTimeoutMs()).toBe(15000);
    expect(getProxyTimeoutMs("2500")).toBe(2500);
    expect(getProxyTimeoutMs("0")).toBe(15000);
    expect(getProxyTimeoutMs("not-a-number")).toBe(15000);
  });

  it("builds no-store response headers", () => {
    expect(buildNoStoreHeaders("application/json")).toMatchObject({
      "Content-Type": "application/json",
      "Cache-Control": expect.stringContaining("no-store"),
      "Pragma": "no-cache",
    });
  });

  it("passes an abort signal into upstream fetch", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWithProxyTimeout("https://api.example.test", {}, 1000)).resolves.toHaveProperty("status", 200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("aborts upstream fetch when the timeout is reached", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    })));

    const request = fetchWithProxyTimeout("https://api.example.test", {}, 25);
    const assertion = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });

  it("formats timeout errors without leaking stack details", () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    expect(getProxyErrorDetail(error, 25)).toBe("Upstream request timed out after 25ms");
  });
});
