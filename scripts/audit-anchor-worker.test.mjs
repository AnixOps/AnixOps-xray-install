import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildAuditAnchorAlert,
  finalizeWithRetries,
  hasAnchorSendConfig,
  isRetriableFinalizeFailure,
  loadApiSecret,
  parseArgs,
  runWorker,
} = require("./audit-anchor-worker.js");

describe("audit-anchor-worker helpers", () => {
  it("parses CLI arguments", () => {
    expect(parseArgs([
      "--api", "http://127.0.0.1:8787",
      "--env-file", ".env.test",
      "--limit", "500",
      "--chain", "base-sepolia",
      "--tx-hash", "0xabc",
      "--finalize-attempts", "4",
      "--finalize-retry-delay-ms", "250",
      "--json",
    ])).toEqual({
      api: "http://127.0.0.1:8787",
      envFile: ".env.test",
      limit: 500,
      chain: "base-sepolia",
      txHash: "0xabc",
      finalizeAttempts: 4,
      finalizeRetryDelayMs: 250,
      json: true,
    });
  });

  it("loads API_SECRET from env files", () => {
    const dir = mkdtempSync(join(tmpdir(), "anixops-anchor-"));
    const envFile = join(dir, ".env.selfhosted");
    writeFileSync(envFile, "API_SECRET=test-secret\n");

    expect(loadApiSecret(envFile)).toBe("test-secret");
  });

  it("builds a warn alert for operator-action pending batches", () => {
    const error = new Error("pending");
    error.code = "AUDIT_ANCHOR_PENDING";

    expect(buildAuditAnchorAlert(error, {
      baseUrl: "http://127.0.0.1:8787",
      stage: "chain-send",
      batch: {
        id: "batch-1",
        eventCount: 2,
        merkleRoot: `0x${"a".repeat(64)}`,
      },
    }, {})).toMatchObject({
      source: "audit-anchor-worker",
      level: "warn",
      title: "Audit anchor batch requires operator action",
    });
  });

  it("builds a recovery-failed alert for pending batch lookup failures", () => {
    expect(buildAuditAnchorAlert(new Error("pending lookup failed"), {
      baseUrl: "http://127.0.0.1:8787",
      stage: "recover-pending",
    }, {})).toMatchObject({
      source: "audit-anchor-worker",
      level: "error",
      title: "Audit anchor pending-batch recovery failed",
    });
  });

  it("retries only retriable finalize failures", () => {
    expect(isRetriableFinalizeFailure(null)).toBe(true);
    expect(isRetriableFinalizeFailure({ ok: false, status: 500, body: { error: "down" } })).toBe(true);
    expect(isRetriableFinalizeFailure({ ok: false, status: 400, body: { error: "bad" } })).toBe(false);
    expect(isRetriableFinalizeFailure({ ok: true, status: 200, body: { batch: { id: "batch-1" } } })).toBe(false);
  });

  it("detects whether anchor auto-send config is present", () => {
    expect(hasAnchorSendConfig({})).toBe(false);
    expect(hasAnchorSendConfig({
      AUDIT_ANCHOR_RPC_URL: "https://rpc.example",
      AUDIT_ANCHOR_SIGNER_PRIVATE_KEY: "0x" + "1".repeat(64),
    })).toBe(true);
  });

  it("skips cleanly when there are no unanchored audit events", async () => {
    const getJson = vi.fn(async () => ({
      ok: false,
      status: 404,
      body: { error: "No pending audit anchor batches" },
    }));
    const requestJson = vi.fn(async () => ({
      ok: false,
      status: 409,
      body: { error: "No unanchored audit events" },
    }));
    const sendAlertWebhook = vi.fn(async () => true);

    const result = await runWorker({
      api: "http://127.0.0.1:8787",
      envFile: ".env.selfhosted",
      limit: 1000,
      chain: "",
      txHash: "",
      json: false,
    }, {
      apiSecret: "test-secret",
      env: { AUDIT_ANCHOR_ALERT_WEBHOOK_URL: "https://alerts.example/audit" },
      getJson,
      requestJson,
      sendAlertWebhook,
    });

    expect(result).toEqual({
      ok: true,
      skipped: true,
      reason: "No unanchored audit events",
    });
    expect(sendAlertWebhook).not.toHaveBeenCalled();
  });

  it("alerts and fails when a batch is created but cannot be finalized automatically", async () => {
    const getJson = vi.fn(async () => ({
      ok: false,
      status: 404,
      body: { error: "No pending audit anchor batches" },
    }));
    const batch = {
      id: "batch-1",
      eventCount: 3,
      merkleRoot: `0x${"b".repeat(64)}`,
      status: "pending",
    };
    const requestJson = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: { batch },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          batch: {
            ...batch,
            submissionStartedAt: "2026-05-08T00:00:00.000Z",
          },
        },
      });
    const sendEvmAnchorTransaction = vi.fn(async () => null);
    const sendAlertWebhook = vi.fn(async () => true);

    await expect(runWorker({
      api: "http://127.0.0.1:8787",
      envFile: ".env.selfhosted",
      limit: 1000,
      chain: "",
      txHash: "",
      json: false,
    }, {
      apiSecret: "test-secret",
      env: { AUDIT_ANCHOR_ALERT_WEBHOOK_URL: "https://alerts.example/audit" },
      getJson,
      requestJson,
      sendEvmAnchorTransaction,
      sendAlertWebhook,
    })).rejects.toThrow("Audit anchor batch created but no chain transaction was sent.");

    expect(sendAlertWebhook).toHaveBeenCalledWith(
      "https://alerts.example/audit",
      expect.objectContaining({
        source: "audit-anchor-worker",
        level: "warn",
        title: "Audit anchor batch requires operator action",
      }),
    );
  });

  it("alerts and fails when finalize returns an error", async () => {
    const getJson = vi.fn(async () => ({
      ok: false,
      status: 404,
      body: { error: "No pending audit anchor batches" },
    }));
    const requestJson = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          batch: {
            id: "batch-2",
            eventCount: 1,
            merkleRoot: `0x${"c".repeat(64)}`,
            status: "pending",
          },
        },
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        body: { error: "Finalize API down" },
      });
    const sendAlertWebhook = vi.fn(async () => true);

    await expect(runWorker({
      api: "http://127.0.0.1:8787",
      envFile: ".env.selfhosted",
      limit: 1000,
      chain: "base-sepolia",
      txHash: "0xabc",
      finalizeAttempts: 1,
      finalizeRetryDelayMs: 0,
      json: false,
    }, {
      apiSecret: "test-secret",
      env: { AUDIT_ANCHOR_ALERT_WEBHOOK_URL: "https://alerts.example/audit" },
      getJson,
      requestJson,
      sendAlertWebhook,
    })).rejects.toThrow("Finalize API down");

    expect(sendAlertWebhook).toHaveBeenCalledWith(
      "https://alerts.example/audit",
      expect.objectContaining({
        source: "audit-anchor-worker",
        level: "error",
        title: "Audit anchor finalize failed",
      }),
    );
  });

  it("retries finalize on transient 5xx failures and then succeeds", async () => {
    const requestJson = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        body: { error: "Gateway timeout" },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          batch: {
            id: "batch-2",
            eventCount: 1,
            merkleRoot: `0x${"c".repeat(64)}`,
            status: "anchored",
            chain: "Base Sepolia",
            txHash: "0xabc",
          },
        },
      });
    const sleep = vi.fn(async () => {});

    await expect(finalizeWithRetries({
      baseUrl: "http://127.0.0.1:8787",
      apiSecret: "test-secret",
      batchId: "batch-2",
      chainResult: { chain: "Base Sepolia", txHash: "0xabc", receipt: null },
      attempts: 3,
      retryDelayMs: 10,
    }, {
      requestJson,
      sleep,
    })).resolves.toMatchObject({
      id: "batch-2",
      status: "anchored",
      txHash: "0xabc",
    });

    expect(requestJson).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it("does not retry finalize on non-retriable 4xx failures", async () => {
    const requestJson = vi.fn(async () => ({
      ok: false,
      status: 400,
      body: { error: "Missing chain or txHash" },
    }));
    const sleep = vi.fn(async () => {});

    await expect(finalizeWithRetries({
      baseUrl: "http://127.0.0.1:8787",
      apiSecret: "test-secret",
      batchId: "batch-4",
      chainResult: { chain: "", txHash: "", receipt: null },
      attempts: 3,
      retryDelayMs: 10,
    }, {
      requestJson,
      sleep,
    })).rejects.toThrow("Missing chain or txHash");

    expect(requestJson).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("finalizes a batch with txHash and receipt when chain send succeeds", async () => {
    const getJson = vi.fn(async () => ({
      ok: false,
      status: 404,
      body: { error: "No pending audit anchor batches" },
    }));
    const chainResult = {
      chain: "Base Sepolia",
      txHash: "0xfeedbeef",
      receipt: {
        blockNumber: 123,
        status: 1,
        gasUsed: "21000",
        to: "0x1111111111111111111111111111111111111111",
        from: "0x2222222222222222222222222222222222222222",
      },
    };
    const requestJson = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          batch: {
            id: "batch-3",
            eventCount: 4,
            merkleRoot: `0x${"d".repeat(64)}`,
            status: "pending",
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          batch: {
            id: "batch-3",
            eventCount: 4,
            merkleRoot: `0x${"d".repeat(64)}`,
            status: "pending",
            submissionStartedAt: "2026-05-08T00:00:00.000Z",
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          batch: {
            id: "batch-3",
            eventCount: 4,
            merkleRoot: `0x${"d".repeat(64)}`,
            status: "pending",
            submissionStartedAt: "2026-05-08T00:00:00.000Z",
            chain: "Base Sepolia",
            txHash: "0xfeedbeef",
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          batch: {
            id: "batch-3",
            eventCount: 4,
            merkleRoot: `0x${"d".repeat(64)}`,
            status: "anchored",
            chain: "Base Sepolia",
            txHash: "0xfeedbeef",
          },
        },
      });
    const sendEvmAnchorTransaction = vi.fn(async () => chainResult);
    const sendAlertWebhook = vi.fn(async () => true);

    const result = await runWorker({
      api: "http://127.0.0.1:8787/",
      envFile: ".env.selfhosted",
      limit: 1000,
      chain: "base-sepolia",
      txHash: "",
      json: false,
    }, {
      apiSecret: "test-secret",
      env: { AUDIT_ANCHOR_ALERT_WEBHOOK_URL: "https://alerts.example/audit" },
      getJson,
      requestJson,
      sendEvmAnchorTransaction,
      sendAlertWebhook,
    });

    expect(result).toEqual({
      ok: true,
      batchId: "batch-3",
      eventCount: 4,
      merkleRoot: `0x${"d".repeat(64)}`,
      status: "anchored",
      chain: "Base Sepolia",
      txHash: "0xfeedbeef",
    });
    expect(sendEvmAnchorTransaction).toHaveBeenCalledWith(
      { AUDIT_ANCHOR_ALERT_WEBHOOK_URL: "https://alerts.example/audit" },
      `0x${"d".repeat(64)}`,
      "base-sepolia",
    );
    expect(requestJson).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:8787/internal/audit/anchor/batch-3/mark-submitted",
      "test-secret",
      {
        chain: "Base Sepolia",
        txHash: "0xfeedbeef",
      },
    );
    expect(requestJson).toHaveBeenNthCalledWith(
      4,
      "http://127.0.0.1:8787/internal/audit/anchor/batch-3/finalize",
      "test-secret",
      chainResult,
    );
    expect(sendAlertWebhook).not.toHaveBeenCalled();
  });

  it("recovers an existing pending batch before trying to create a new one", async () => {
    const batch = {
      id: "batch-pending-1",
      eventCount: 2,
      merkleRoot: `0x${"e".repeat(64)}`,
      status: "pending",
    };
    const chainResult = {
      chain: "Base Sepolia",
      txHash: "0xrecovered",
      receipt: {
        blockNumber: 456,
        status: 1,
        gasUsed: "25000",
        to: "0x1111111111111111111111111111111111111111",
        from: "0x2222222222222222222222222222222222222222",
      },
    };
    const getJson = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: { batch },
    }));
    const requestJson = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          batch: {
            ...batch,
            submissionStartedAt: "2026-05-08T00:00:00.000Z",
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          batch: {
            ...batch,
            submissionStartedAt: "2026-05-08T00:00:00.000Z",
            chain: "Base Sepolia",
            txHash: "0xrecovered",
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          batch: {
            ...batch,
            status: "anchored",
            chain: "Base Sepolia",
            txHash: "0xrecovered",
          },
        },
      });
    const sendEvmAnchorTransaction = vi.fn(async () => chainResult);
    const sendAlertWebhook = vi.fn(async () => true);

    const result = await runWorker({
      api: "http://127.0.0.1:8787",
      envFile: ".env.selfhosted",
      limit: 1000,
      chain: "",
      txHash: "",
      json: false,
    }, {
      apiSecret: "test-secret",
      env: { AUDIT_ANCHOR_ALERT_WEBHOOK_URL: "https://alerts.example/audit" },
      getJson,
      requestJson,
      sendEvmAnchorTransaction,
      sendAlertWebhook,
    });

    expect(result).toEqual({
      ok: true,
      batchId: "batch-pending-1",
      eventCount: 2,
      merkleRoot: `0x${"e".repeat(64)}`,
      status: "anchored",
      chain: "Base Sepolia",
      txHash: "0xrecovered",
    });
    expect(getJson).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/internal/audit/anchor/pending",
      "test-secret",
    );
    expect(requestJson).toHaveBeenCalledTimes(3);
    expect(requestJson).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:8787/internal/audit/anchor/batch-pending-1/mark-submitting",
      "test-secret",
      {},
    );
    expect(requestJson).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:8787/internal/audit/anchor/batch-pending-1/mark-submitted",
      "test-secret",
      {
        chain: "Base Sepolia",
        txHash: "0xrecovered",
      },
    );
    expect(requestJson).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:8787/internal/audit/anchor/batch-pending-1/finalize",
      "test-secret",
      chainResult,
    );
    expect(sendEvmAnchorTransaction).toHaveBeenCalledWith(
      { AUDIT_ANCHOR_ALERT_WEBHOOK_URL: "https://alerts.example/audit" },
      `0x${"e".repeat(64)}`,
      "",
    );
    expect(sendAlertWebhook).not.toHaveBeenCalled();
  });

  it("recovers and finalizes a submitted pending batch when its receipt is available", async () => {
    const batch = {
      id: "batch-submitted-1",
      eventCount: 2,
      merkleRoot: `0x${"a".repeat(64)}`,
      status: "pending",
      chain: "Base Sepolia",
      txHash: "0xalready",
      submissionStartedAt: "2026-05-08T00:00:00.000Z",
    };
    const chainResult = {
      chain: "Base Sepolia",
      txHash: "0xalready",
      receipt: {
        blockNumber: 789,
        status: 1,
        gasUsed: "22000",
        to: "0x1111111111111111111111111111111111111111",
        from: "0x2222222222222222222222222222222222222222",
      },
    };
    const getJson = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: { batch },
    }));
    const requestJson = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: {
        batch: {
          ...batch,
          status: "anchored",
        },
      },
    }));
    const loadAnchorTransactionReceipt = vi.fn(async () => chainResult);
    const sendEvmAnchorTransaction = vi.fn(async () => {
      throw new Error("should not send");
    });
    const sendAlertWebhook = vi.fn(async () => true);

    const result = await runWorker({
      api: "http://127.0.0.1:8787",
      envFile: ".env.selfhosted",
      limit: 1000,
      chain: "",
      txHash: "",
      json: false,
    }, {
      apiSecret: "test-secret",
      env: { AUDIT_ANCHOR_ALERT_WEBHOOK_URL: "https://alerts.example/audit" },
      getJson,
      requestJson,
      loadAnchorTransactionReceipt,
      sendEvmAnchorTransaction,
      sendAlertWebhook,
    });

    expect(result).toEqual({
      ok: true,
      batchId: "batch-submitted-1",
      eventCount: 2,
      merkleRoot: `0x${"a".repeat(64)}`,
      status: "anchored",
      chain: "Base Sepolia",
      txHash: "0xalready",
    });
    expect(loadAnchorTransactionReceipt).toHaveBeenCalledWith(
      { AUDIT_ANCHOR_ALERT_WEBHOOK_URL: "https://alerts.example/audit" },
      "0xalready",
      "Base Sepolia",
    );
    expect(sendEvmAnchorTransaction).not.toHaveBeenCalled();
    expect(requestJson).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/internal/audit/anchor/batch-submitted-1/finalize",
      "test-secret",
      chainResult,
    );
    expect(sendAlertWebhook).not.toHaveBeenCalled();
  });

  it("waits without resending when a submitted pending batch has no receipt yet", async () => {
    const batch = {
      id: "batch-submitted-2",
      eventCount: 2,
      merkleRoot: `0x${"a".repeat(64)}`,
      status: "pending",
      chain: "Base Sepolia",
      txHash: "0xwaiting",
      submissionStartedAt: "2026-05-08T00:00:00.000Z",
    };
    const getJson = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: { batch },
    }));
    const requestJson = vi.fn(async () => {
      throw new Error("should not write");
    });
    const loadAnchorTransactionReceipt = vi.fn(async () => null);
    const sendEvmAnchorTransaction = vi.fn(async () => {
      throw new Error("should not send");
    });
    const sendAlertWebhook = vi.fn(async () => true);

    const result = await runWorker({
      api: "http://127.0.0.1:8787",
      envFile: ".env.selfhosted",
      limit: 1000,
      chain: "",
      txHash: "",
      json: false,
    }, {
      apiSecret: "test-secret",
      env: { AUDIT_ANCHOR_ALERT_WEBHOOK_URL: "https://alerts.example/audit" },
      getJson,
      requestJson,
      loadAnchorTransactionReceipt,
      sendEvmAnchorTransaction,
      sendAlertWebhook,
    });

    expect(result).toEqual({
      ok: true,
      skipped: true,
      reason: "Pending anchor transaction is still waiting for receipt",
      batchId: "batch-submitted-2",
      txHash: "0xwaiting",
    });
    expect(loadAnchorTransactionReceipt).toHaveBeenCalledWith(
      { AUDIT_ANCHOR_ALERT_WEBHOOK_URL: "https://alerts.example/audit" },
      "0xwaiting",
      "Base Sepolia",
    );
    expect(sendEvmAnchorTransaction).not.toHaveBeenCalled();
    expect(requestJson).not.toHaveBeenCalled();
    expect(sendAlertWebhook).not.toHaveBeenCalled();
  });

  it("refuses to auto-resend when a pending batch may already have been submitted", async () => {
    const batch = {
      id: "batch-pending-2",
      eventCount: 2,
      merkleRoot: `0x${"f".repeat(64)}`,
      status: "pending",
      submissionStartedAt: "2026-05-08T00:00:00.000Z",
    };
    const getJson = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: { batch },
    }));
    const requestJson = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: { batch },
    }));
    const sendEvmAnchorTransaction = vi.fn(async () => ({
      chain: "Base Sepolia",
      txHash: "0xshould-not-send",
      receipt: null,
    }));
    const sendAlertWebhook = vi.fn(async () => true);

    await expect(runWorker({
      api: "http://127.0.0.1:8787",
      envFile: ".env.selfhosted",
      limit: 1000,
      chain: "",
      txHash: "",
      json: false,
    }, {
      apiSecret: "test-secret",
      env: { AUDIT_ANCHOR_ALERT_WEBHOOK_URL: "https://alerts.example/audit" },
      getJson,
      requestJson,
      sendEvmAnchorTransaction,
      sendAlertWebhook,
    })).rejects.toThrow("Audit anchor batch may already have been submitted on-chain.");

    expect(requestJson).not.toHaveBeenCalled();
    expect(sendEvmAnchorTransaction).not.toHaveBeenCalled();
    expect(sendAlertWebhook).toHaveBeenCalledWith(
      "https://alerts.example/audit",
      expect.objectContaining({
        source: "audit-anchor-worker",
        level: "warn",
        title: "Audit anchor batch needs txHash-based recovery",
      }),
    );
  });
});
