import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildCryptoTopupAlert, loadApiSecret, parseArgs, runWorker } = require("./crypto-topup-worker.js");

describe("crypto-topup-worker helpers", () => {
  it("parses CLI arguments", () => {
    expect(parseArgs([
      "--api", "http://127.0.0.1:8787",
      "--env-file", ".env.test",
      "--limit", "250",
      "--lookback-blocks", "12000",
      "--json",
    ])).toEqual({
      api: "http://127.0.0.1:8787",
      envFile: ".env.test",
      limit: 250,
      lookbackBlocks: 12000,
      json: true,
    });
  });

  it("loads API_SECRET from an env file", () => {
    const dir = mkdtempSync(join(tmpdir(), "anixops-crypto-worker-"));
    const envFile = join(dir, ".env.selfhosted");
    writeFileSync(envFile, "API_SECRET=test-secret\n");
    expect(loadApiSecret(envFile)).toBe("test-secret");
  });

  it("builds an operator-review alert only when matches are ambiguous", () => {
    expect(buildCryptoTopupAlert({ ambiguous: 0 }, { api: "http://127.0.0.1:8787" })).toBeNull();
    expect(buildCryptoTopupAlert({
      ambiguous: 2,
      pendingTopups: 4,
      observedTransfers: 5,
      matched: 1,
      confirmed: 1,
    }, { api: "http://127.0.0.1:8787" })).toMatchObject({
      source: "crypto-topup-worker",
      level: "warn",
      title: "Crypto topup auto-confirm requires operator review",
    });
  });

  it("does not fail the worker when an ambiguity alert webhook fails", async () => {
    const postJson = vi.fn(async () => ({
      matches: [],
      skipped: false,
      reason: null,
      pendingTopups: 3,
      observedTransfers: 2,
      ambiguous: 1,
    }));
    const sendAlertWebhook = vi.fn(async () => {
      throw new Error("webhook down");
    });

    const result = await runWorker({
      api: "http://127.0.0.1:8787",
      envFile: ".env.selfhosted",
      limit: 100,
      lookbackBlocks: 10000,
      json: false,
    }, {
      apiSecret: "test-secret",
      env: { CRYPTO_ALERT_WEBHOOK_URL: "https://alerts.example/crypto" },
      postJson,
      sendAlertWebhook,
    });

    expect(result).toMatchObject({
      ok: true,
      ambiguous: 1,
      matched: 0,
      confirmed: 0,
    });
    expect(sendAlertWebhook).toHaveBeenCalledTimes(1);
  });

  it("sends an error alert before rethrowing worker failures", async () => {
    const postJson = vi.fn(async () => {
      throw new Error("scan failed");
    });
    const sendAlertWebhook = vi.fn(async () => true);

    await expect(runWorker({
      api: "http://127.0.0.1:8787",
      envFile: ".env.selfhosted",
      limit: 100,
      lookbackBlocks: 10000,
      json: false,
    }, {
      apiSecret: "test-secret",
      env: { CRYPTO_ALERT_WEBHOOK_URL: "https://alerts.example/crypto" },
      postJson,
      sendAlertWebhook,
    })).rejects.toThrow("scan failed");

    expect(sendAlertWebhook).toHaveBeenCalledWith(
      "https://alerts.example/crypto",
      expect.objectContaining({
        source: "crypto-topup-worker",
        level: "error",
        title: "Crypto topup worker failed",
      }),
    );
  });
});
