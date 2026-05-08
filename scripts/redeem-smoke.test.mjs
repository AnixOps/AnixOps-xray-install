import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  normalizeAmount,
  normalizeDurationHours,
  parseArgs,
  runRedeemSmoke,
  waitForSubscriptionLink,
} = require("./redeem-smoke.js");

describe("redeem-smoke helpers", () => {
  it("parses CLI arguments", () => {
    expect(parseArgs([
      "--api", "http://127.0.0.1:8787",
      "--env-file", ".env.test",
      "--email", "qa@example.com",
      "--duration-hours", "24",
      "--wallet-amount", "12.5",
      "--protocol", "hysteria2",
      "--compliance-profile-id", "standard",
      "--poll-interval-ms", "1500",
      "--rental-timeout-ms", "9000",
      "--json",
    ])).toEqual({
      api: "http://127.0.0.1:8787",
      envFile: ".env.test",
      email: "qa@example.com",
      durationHours: 24,
      walletAmount: 12.5,
      protocol: "hysteria2",
      complianceProfileId: "standard",
      pollIntervalMs: 1500,
      rentalTimeoutMs: 9000,
      json: true,
    });
  });

  it("normalizes duration hours and wallet amounts", () => {
    expect(normalizeDurationHours("8")).toBe(8);
    expect(normalizeDurationHours("5")).toBeNaN();
    expect(normalizeAmount("12.345")).toBe(12.35);
    expect(normalizeAmount("0")).toBeNaN();
  });

  it("waits for a ready subscription link", async () => {
    const requestJson = vi.fn(async ({ path }) => {
      if (path === "/api/rental/rental-1/subscription?format=universal") {
        return {
          ok: true,
          status: 200,
          body: { subscription: "subscription://ready" },
        };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    await expect(waitForSubscriptionLink({
      requestJson,
      token: "token",
      rentalId: "rental-1",
      timeoutMs: 1000,
      pollIntervalMs: 1000,
      sleep: async () => {},
    })).resolves.toBe("subscription://ready");
  });

  it("treats transient 404s as not ready when waiting for a subscription link", async () => {
    let attempts = 0;
    const requestJson = vi.fn(async ({ path }) => {
      if (path === "/api/rental/rental-1/subscription?format=universal") {
        attempts += 1;
        if (attempts < 2) {
          return {
            ok: false,
            status: 404,
            body: { error: "Not ready yet" },
          };
        }
        return {
          ok: true,
          status: 200,
          body: { subscription: "subscription://ready" },
        };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    await expect(waitForSubscriptionLink({
      requestJson,
      token: "token",
      rentalId: "rental-1",
      timeoutMs: 1000,
      pollIntervalMs: 1000,
      sleep: async () => {},
    })).resolves.toBe("subscription://ready");
  });

  it("runs the redeem smoke flow end to end in synthetic mode", async () => {
    const state = {
      walletBalance: 5,
      durationConfigPolls: 0,
      durationSubscriptionPolls: 0,
      nextLedgerEntryId: 1,
      durationRentalDestroyed: false,
      durationCode: "ANIX-DUR1",
      walletCode: "ANIX-WAL1",
    };

    const requestJson = vi.fn(async ({ method, path, token, apiSecret, body }) => {
      if (method === "POST" && path === "/api/auth/register") {
        return {
          ok: true,
          status: 200,
          body: {
            userId: "user-1",
            token: "token-1",
            email: body.email,
          },
        };
      }

      if (method === "GET" && path === "/api/rentals") {
        expect(token).toBe("token-1");
        return { ok: true, status: 200, body: { rentals: [] } };
      }

      if (method === "GET" && path === "/api/wallet") {
        expect(token).toBe("token-1");
        return { ok: true, status: 200, body: { balance: state.walletBalance, currency: "usd" } };
      }

      if (method === "POST" && path === "/api/admin/redeem-codes") {
        expect(apiSecret).toBe("test-secret");
        if (body.codeType === "duration") {
          return {
            ok: true,
            status: 200,
            body: {
              codes: [{ code: state.durationCode, codeType: "duration", durationHours: body.durationHours, walletAmount: null }],
              count: 1,
            },
          };
        }
        return {
          ok: true,
          status: 200,
          body: {
            codes: [{ code: state.walletCode, codeType: "wallet", durationHours: 0, walletAmount: body.walletAmount }],
            count: 1,
          },
        };
      }

      if (method === "POST" && path === "/api/redeem/validate") {
        if (body.code === state.durationCode) {
          return {
            ok: true,
            status: 200,
            body: { valid: true, codeType: "duration", durationHours: 1, walletAmount: null },
          };
        }
        if (body.code === state.walletCode) {
          return {
            ok: true,
            status: 200,
            body: { valid: true, codeType: "wallet", durationHours: 0, walletAmount: 12.5 },
          };
        }
        throw new Error(`Unexpected validation code: ${body.code}`);
      }

      if (method === "POST" && path === "/api/redeem") {
        expect(token).toBe("token-1");
        expect(body.code).toBe(state.durationCode);
        return {
          ok: true,
          status: 200,
          body: {
            rentalId: "rental-1",
            durationHours: 1,
            status: "provisioning",
          },
        };
      }

      if (method === "GET" && path === "/api/rental/rental-1/config") {
        state.durationConfigPolls += 1;
        if (state.durationConfigPolls < 2) {
          return { ok: false, status: 202, body: { error: "Still provisioning" } };
        }
        return { ok: true, status: 200, body: { protocol: "vless-reality", ip: "203.0.113.10" } };
      }

      if (method === "POST" && path === "/api/admin/rentals/rental-1/destroy") {
        expect(apiSecret).toBe("test-secret");
        state.durationRentalDestroyed = true;
        return { ok: true, status: 200, body: { rentalId: "rental-1", status: "destroyed" } };
      }

      if (method === "POST" && path === "/api/wallet/redeem") {
        expect(token).toBe("token-1");
        expect(body.code).toBe(state.walletCode);
        state.walletBalance = 17.5;
        return {
          ok: true,
          status: 200,
          body: {
            codeType: "wallet",
            balanceDelta: 12.5,
            currency: "usd",
            ledgerEntryId: "ledger-1",
          },
        };
      }

      if (method === "GET" && path === "/api/wallet/ledger?limit=5") {
        return {
          ok: true,
          status: 200,
          body: {
            entries: [
              {
                id: "ledger-1",
                type: "redeem_code_credit",
                amount: 12.5,
                balanceAfter: 17.5,
              },
            ],
          },
        };
      }

      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    const webRequestJson = vi.fn(async ({ method, path, token }) => {
      if (method === "GET" && path === "/api/rental/rental-1/subscription?format=universal") {
        expect(token).toBe("token-1");
        state.durationSubscriptionPolls += 1;
        if (state.durationSubscriptionPolls < 2) {
          return { ok: false, status: 202, body: { error: "Still provisioning" } };
        }
        return { ok: true, status: 200, body: { subscription: "subscription://ready" } };
      }

      throw new Error(`Unexpected web request: ${method} ${path}`);
    });

    const result = await runRedeemSmoke({
      api: "http://127.0.0.1:8787",
      envFile: ".env.selfhosted",
      email: "qa@example.com",
      durationHours: 1,
      walletAmount: 12.5,
      protocol: "vless-reality",
      complianceProfileId: "standard",
      pollIntervalMs: 1000,
      rentalTimeoutMs: 5000,
      json: false,
    }, {
      env: { CHAIN_ENVIRONMENT: "testnet" },
      apiSecret: "test-secret",
      requestJson,
      webRequestJson,
      sleep: async () => {},
    });

    expect(result).toMatchObject({
      ok: true,
      email: "qa@example.com",
      duration: {
        code: state.durationCode,
        rentalId: "rental-1",
        subscriptionReady: true,
        configReady: true,
        destroyStatus: "destroyed",
      },
      wallet: {
        code: state.walletCode,
        amount: 12.5,
        balanceBefore: 5,
        balanceAfter: 17.5,
      },
      env: {
        chainEnvironment: "testnet",
      },
    });
    expect(state.durationRentalDestroyed).toBe(true);
    expect(requestJson).toHaveBeenCalled();
  });
});
