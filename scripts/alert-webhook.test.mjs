import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildAlertMessage, normalizeWebhookUrl, sendAlertWebhook } = require("./alert-webhook.js");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("alert-webhook helpers", () => {
  it("normalizes only http and https webhook URLs", () => {
    expect(normalizeWebhookUrl(" https://alerts.example/hook ")).toBe("https://alerts.example/hook");
    expect(normalizeWebhookUrl("http://alerts.example/hook")).toBe("http://alerts.example/hook");
    expect(normalizeWebhookUrl("ftp://alerts.example/hook")).toBe("");
    expect(normalizeWebhookUrl("")).toBe("");
  });

  it("builds a readable alert message", () => {
    expect(buildAlertMessage({
      level: "error",
      title: "Worker failed",
      detail: "RPC timeout",
      facts: [
        { label: "stage", value: "chain-send" },
        { label: "batchId", value: "batch-1" },
      ],
    })).toBe("[ERROR] Worker failed\nRPC timeout\nstage: chain-send\nbatchId: batch-1");
  });

  it("skips network delivery when no valid webhook URL is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendAlertWebhook("", { title: "ignored" })).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts structured JSON to the configured webhook", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendAlertWebhook("https://alerts.example/hook", {
      source: "crypto-topup-worker",
      level: "warn",
      title: "Crypto topup auto-confirm requires operator review",
      detail: "Ambiguous matches were skipped.",
      facts: [{ label: "ambiguous", value: 2 }],
    })).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://alerts.example/hook",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      type: "anixops_alert",
      level: "warn",
      title: "Crypto topup auto-confirm requires operator review",
      source: "crypto-topup-worker",
      facts: [{ label: "ambiguous", value: 2 }],
    });
  });
});
