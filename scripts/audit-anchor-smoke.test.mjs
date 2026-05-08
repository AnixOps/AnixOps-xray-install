import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  AUDIT_MUTATION_PATH,
  buildSyntheticTxHash,
  buildWorkerArgs,
  normalizeConfirmationMode,
  normalizeHexTxHash,
  parseArgs,
  runAuditAnchorSmoke,
} = require("./audit-anchor-smoke.js");

describe("audit-anchor-smoke helpers", () => {
  it("parses CLI arguments", () => {
    expect(parseArgs([
      "--api", "http://127.0.0.1:8787",
      "--env-file", ".env.test",
      "--limit", "500",
      "--chain", "base-sepolia",
      "--tx-hash", "0x" + "1".repeat(64),
      "--provider", "vultr",
      "--region", "iad",
      "--plan", "starter",
      "--confirmation-mode", "manual",
      "--finalize-attempts", "4",
      "--finalize-retry-delay-ms", "250",
      "--json",
    ])).toEqual({
      api: "http://127.0.0.1:8787",
      envFile: ".env.test",
      limit: 500,
      chain: "base-sepolia",
      txHash: "0x" + "1".repeat(64),
      provider: "vultr",
      region: "iad",
      plan: "starter",
      confirmationMode: "manual",
      finalizeAttempts: 4,
      finalizeRetryDelayMs: 250,
      json: true,
    });
  });

  it("builds a transaction-shaped synthetic tx hash", () => {
    expect(buildSyntheticTxHash()).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it("normalizes confirmation mode and tx hashes", () => {
    expect(normalizeConfirmationMode("Synthetic")).toBe("synthetic");
    expect(normalizeConfirmationMode("invalid")).toBe("");
    expect(normalizeHexTxHash("0x" + "a".repeat(64))).toBe("0x" + "a".repeat(64));
    expect(normalizeHexTxHash("a".repeat(64))).toBe("0x" + "a".repeat(64));
    expect(normalizeHexTxHash("bad-hash")).toBe("");
  });

  it("builds worker args for synthetic, manual, and auto modes", () => {
    expect(buildWorkerArgs({
      api: "http://127.0.0.1:8787",
      envFile: ".env.selfhosted",
      limit: 1000,
      chain: "base-sepolia",
      txHash: "",
      provider: "",
      region: "",
      plan: "",
      confirmationMode: "synthetic",
      finalizeAttempts: 3,
      finalizeRetryDelayMs: 1000,
      json: false,
    }, "synthetic")).toMatchObject({
      chain: "base-sepolia",
      finalizeAttempts: 3,
      finalizeRetryDelayMs: 1000,
      json: false,
    });

    expect(buildWorkerArgs({
      api: "http://127.0.0.1:8787",
      envFile: ".env.selfhosted",
      limit: 1000,
      chain: "",
      txHash: "0x" + "1".repeat(64),
      provider: "",
      region: "",
      plan: "",
      confirmationMode: "manual",
      finalizeAttempts: 3,
      finalizeRetryDelayMs: 1000,
      json: false,
    }, "manual")).toMatchObject({
      txHash: "0x" + "1".repeat(64),
    });

    expect(buildWorkerArgs({
      api: "http://127.0.0.1:8787",
      envFile: ".env.selfhosted",
      limit: 1000,
      chain: "",
      txHash: "",
      provider: "",
      region: "",
      plan: "",
      confirmationMode: "auto",
      finalizeAttempts: 3,
      finalizeRetryDelayMs: 1000,
      json: false,
    }, "auto")).toMatchObject({
      txHash: "",
    });
  });

  it("runs the anchor smoke flow in synthetic mode", async () => {
    const requestJson = vi.fn(async (url, apiSecret, body) => {
      if (url === "http://127.0.0.1:8787/api/admin/compliance/profiles") {
        expect(apiSecret).toBe("test-secret");
        expect(body).toMatchObject({
          id: "audit-anchor-smoke",
          name: "Audit Anchor Smoke",
          mode: "standard",
          version: "audit-anchor-smoke.v1",
          isDefault: false,
        });
        return {
          ok: true,
          status: 200,
          body: {
            profile: {
              id: "audit-anchor-smoke",
              mode: "standard",
              version: "audit-anchor-smoke.v1",
            },
          },
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const getJson = vi.fn(async (url, apiSecret) => {
      if (url === "http://127.0.0.1:8787/internal/audit/anchor/pending") {
        expect(apiSecret).toBe("test-secret");
        return {
          ok: false,
          status: 404,
          body: { error: "No pending audit anchor batches" },
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const runWorker = vi.fn(async (workerArgs) => {
      expect(workerArgs.txHash).toMatch(/^0x[a-f0-9]{64}$/);
      return {
        ok: true,
        batchId: "batch-1",
        eventCount: 1,
        merkleRoot: `0x${"a".repeat(64)}`,
        status: "anchored",
        chain: "base-sepolia",
        txHash: workerArgs.txHash,
      };
    });
    const verifyAuditAnchor = vi.fn(async ({ baseUrl, apiSecret, batchId }) => {
      expect(baseUrl).toBe("http://127.0.0.1:8787");
      expect(apiSecret).toBe("test-secret");
      expect(batchId).toBe("batch-1");
      return {
        ok: true,
        batchId: "batch-1",
        eventCount: 1,
        merkleRoot: `0x${"a".repeat(64)}`,
        status: "anchored",
        chain: "base-sepolia",
        txHash: "0x" + "2".repeat(64),
      };
    });

    const result = await runAuditAnchorSmoke({
      api: "http://127.0.0.1:8787",
      envFile: ".env.selfhosted",
      limit: 1000,
      chain: "base-sepolia",
      txHash: "",
      provider: "",
      region: "",
      plan: "",
      confirmationMode: "synthetic",
      finalizeAttempts: 3,
      finalizeRetryDelayMs: 1000,
      json: false,
    }, {
      env: {},
      apiSecret: "test-secret",
      requestJson,
      getJson,
      runWorker,
      verifyAuditAnchor,
      sleep: async () => {},
    });

    expect(result).toMatchObject({
      ok: true,
      confirmationMode: "synthetic",
      mutation: {
        path: AUDIT_MUTATION_PATH,
        status: 200,
        profileId: "audit-anchor-smoke",
      },
      worker: expect.objectContaining({
        batchId: "batch-1",
        eventCount: 1,
      }),
      verification: expect.objectContaining({
        batchId: "batch-1",
      }),
    });
    expect(requestJson).toHaveBeenCalledTimes(1);
    expect(getJson).toHaveBeenCalledTimes(1);
    expect(runWorker).toHaveBeenCalledTimes(1);
    expect(verifyAuditAnchor).toHaveBeenCalledTimes(1);
  });

  it("runs the anchor smoke flow in auto mode without a manual tx hash", async () => {
    const requestJson = vi.fn(async (url) => {
      if (url === "http://127.0.0.1:8787/api/admin/compliance/profiles") {
        return {
          ok: true,
          status: 200,
          body: {
            profile: {
              id: "audit-anchor-smoke",
              mode: "standard",
              version: "audit-anchor-smoke.v1",
            },
          },
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const getJson = vi.fn(async (url) => {
      if (url === "http://127.0.0.1:8787/internal/audit/anchor/pending") {
        return {
          ok: false,
          status: 404,
          body: { error: "No pending audit anchor batches" },
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const runWorker = vi.fn(async (workerArgs) => {
      expect(workerArgs.txHash).toBe("");
      return {
        ok: true,
        batchId: "batch-2",
        eventCount: 1,
        merkleRoot: `0x${"b".repeat(64)}`,
        status: "anchored",
        chain: "base-sepolia",
        txHash: "0x" + "3".repeat(64),
      };
    });
    const verifyAuditAnchor = vi.fn(async () => ({
      ok: true,
      batchId: "batch-2",
      eventCount: 1,
      merkleRoot: `0x${"b".repeat(64)}`,
      status: "anchored",
      chain: "base-sepolia",
      txHash: "0x" + "3".repeat(64),
    }));

    const result = await runAuditAnchorSmoke({
      api: "http://127.0.0.1:8787",
      envFile: ".env.selfhosted",
      limit: 1000,
      chain: "base-sepolia",
      txHash: "",
      provider: "",
      region: "",
      plan: "",
      confirmationMode: "auto",
      finalizeAttempts: 3,
      finalizeRetryDelayMs: 1000,
      json: false,
    }, {
      env: {},
      apiSecret: "test-secret",
      requestJson,
      getJson,
      runWorker,
      verifyAuditAnchor,
      sleep: async () => {},
    });

    expect(result.confirmationMode).toBe("auto");
    expect(runWorker).toHaveBeenCalledTimes(1);
  });

  it("fails when a pending anchor batch already exists", async () => {
    const getJson = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: {
        batch: {
          id: "pending-batch",
        },
      },
    }));

    await expect(runAuditAnchorSmoke({
      api: "http://127.0.0.1:8787",
      envFile: ".env.selfhosted",
      limit: 1000,
      chain: "",
      txHash: "",
      provider: "",
      region: "",
      plan: "",
      confirmationMode: "synthetic",
      finalizeAttempts: 3,
      finalizeRetryDelayMs: 1000,
      json: false,
    }, {
      env: {},
      apiSecret: "test-secret",
      getJson,
      requestJson: vi.fn(),
      runWorker: vi.fn(),
      verifyAuditAnchor: vi.fn(),
      sleep: async () => {},
    })).rejects.toThrow("Pending audit anchor batch pending-batch already exists");
  });
});
