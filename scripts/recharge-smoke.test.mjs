import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildSyntheticTxHash,
  loadRechargeEnv,
  parseArgs,
  runRechargeSmoke,
} = require("./recharge-smoke.js");

describe("recharge-smoke helpers", () => {
  it("parses CLI arguments", () => {
    expect(parseArgs([
      "--api", "http://127.0.0.1:8787",
      "--env-file", ".env.test",
      "--email", "qa@example.com",
      "--amount", "2.5",
      "--protocol", "hysteria2",
      "--duration-hours", "6",
      "--compliance-profile-id", "standard",
      "--confirmation-mode", "synthetic",
      "--tx-hash", "0xabc",
      "--poll-interval-ms", "1500",
      "--rental-timeout-ms", "9000",
      "--json",
    ])).toEqual({
      api: "http://127.0.0.1:8787",
      envFile: ".env.test",
      email: "qa@example.com",
      amount: 2.5,
      protocol: "hysteria2",
      durationHours: 6,
      complianceProfileId: "standard",
      confirmationMode: "synthetic",
      txHash: "0xabc",
      pollIntervalMs: 1500,
      rentalTimeoutMs: 9000,
      json: true,
    });
  });

  it("builds a transaction-shaped synthetic tx hash", () => {
    expect(buildSyntheticTxHash()).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it("prefers runtime env over file-backed env", () => {
    const dir = mkdtempSync(join(tmpdir(), "anixops-recharge-env-"));
    try {
      writeFileSync(join(dir, ".env.selfhosted"), [
        "CHAIN_ENVIRONMENT=production",
        "CHAIN_TESTNET_WHITELIST_EMAILS=busy@example.com",
        "OTHER=value-from-file",
        "",
      ].join("\n"), "utf8");
      writeFileSync(join(dir, ".local-secrets.env"), [
        "CHAIN_TESTNET_WHITELIST_EMAILS=from-local-secrets@example.com",
        "SECRET=value-from-local-secrets",
        "",
      ].join("\n"), "utf8");

      expect(loadRechargeEnv(join(dir, ".env.selfhosted"), {
        runtimeEnv: {
          CHAIN_ENVIRONMENT: "testnet",
          CHAIN_TESTNET_WHITELIST_EMAILS: "free@example.com",
          RUNTIME_ONLY: "present",
        },
        cwd: dir,
      })).toEqual(expect.objectContaining({
        CHAIN_ENVIRONMENT: "testnet",
        CHAIN_TESTNET_WHITELIST_EMAILS: "free@example.com",
        OTHER: "value-from-file",
        SECRET: "value-from-local-secrets",
        RUNTIME_ONLY: "present",
      }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs the recharge smoke flow end to end in synthetic mode", async () => {
    const state = {
      walletBalance: 0,
      ledgerStage: "topup",
      confirmedTxHash: "",
      configPolls: 0,
      chargeAttempts: 0,
      cleanupCalls: 0,
    };

    const requestJson = vi.fn(async ({ method, path, token, body }) => {
      if (method === "POST" && path === "/api/auth/register") {
        if (body.email === "busy@example.com") {
          return { ok: true, status: 200, body: { userId: "user-busy", token: "token-busy", email: body.email } };
        }
        return { ok: true, status: 200, body: { userId: "user-free", token: "token-free", email: body.email } };
      }

      if (method === "GET" && path === "/api/rentals") {
        if (token === "token-busy") {
          return {
            ok: true,
            status: 200,
            body: { rentals: [{ id: "old-rental", status: "active" }] },
          };
        }
        return { ok: true, status: 200, body: { rentals: [] } };
      }

      if (method === "GET" && path === "/api/wallet") {
        return { ok: true, status: 200, body: { balance: state.walletBalance, currency: "usd" } };
      }

      if (method === "POST" && path === "/api/wallet/crypto-topups") {
        state.walletBalance += 1;
        state.ledgerStage = "topup";
        return {
          ok: true,
          status: 200,
          body: {
            chainMode: {
              environment: "testnet",
              allowlisted: true,
              chain: {
                cryptoTopupEnabled: false,
                chain: "base",
                networkName: "base-sepolia",
                tokenAddress: "0x" + "1".repeat(40),
              },
            },
            topup: {
              id: "topup-1",
              rail: "wallet",
              expectedAmount: 1,
              fiatAmount: 1,
              amount: 1,
              address: "anixops_recharge_receiver",
            },
          },
        };
      }

      if (method === "POST" && path === "/internal/crypto-topups/topup-1/confirm") {
        state.confirmedTxHash = body.txHash;
        return {
          ok: true,
          status: 200,
          body: {
            alreadyProcessed: false,
            topup: {
              id: "topup-1",
              status: "completed",
              txHash: body.txHash,
            },
          },
        };
      }

      if (method === "GET" && path === "/api/wallet/ledger?limit=5") {
        if (state.ledgerStage === "topup") {
          state.ledgerStage = "charge";
          return {
            ok: true,
            status: 200,
            body: {
              entries: [{
                id: "ledger-topup",
                type: "crypto_topup",
                amount: 1,
                balanceAfter: 1,
              }],
            },
          };
        }
        return {
          ok: true,
          status: 200,
          body: {
            entries: [{
              id: "ledger-charge",
              type: "billing_charge",
              amount: -0.5,
              balanceAfter: 0.5,
            }],
          },
        };
      }

      if (method === "POST" && path === "/api/rental") {
        return {
          ok: true,
          status: 200,
          body: {
            rentalId: "rental-1",
            totalPrice: 0.5,
            status: "provisioning",
            billingMode: "wallet_tick",
          },
        };
      }

      if (method === "GET" && path === "/api/rental/rental-1/config") {
        state.configPolls += 1;
        if (state.configPolls < 2) {
          return {
            ok: false,
            status: 202,
            body: { error: "Still provisioning" },
          };
        }
        return {
          ok: true,
          status: 200,
          body: { protocol: "vless-reality", ip: "203.0.113.10" },
        };
      }

      if (method === "POST" && path === "/internal/billing/rentals/rental-1/charge") {
        state.chargeAttempts += 1;
        if (state.chargeAttempts < 2) {
          return {
            ok: false,
            status: 409,
            body: { error: "Rental is not an active wallet rental" },
          };
        }
        state.walletBalance = 0.5;
        return {
          ok: true,
          status: 200,
          body: {
            rentalId: "rental-1",
            status: "charged",
            amount: 0.5,
            ledgerEntryId: "ledger-charge",
            alreadyProcessed: false,
          },
        };
      }

      if (method === "POST" && path === "/api/admin/rentals/rental-1/destroy") {
        state.cleanupCalls += 1;
        return {
          ok: true,
          status: 200,
          body: {
            status: "destroyed",
            rentalId: "rental-1",
          },
        };
      }

      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    const result = await runRechargeSmoke({
      api: "http://127.0.0.1:8787",
      envFile: ".env.selfhosted",
      amount: 1,
      protocol: "vless-reality",
      durationHours: 1,
      complianceProfileId: "standard",
      confirmationMode: "synthetic",
      txHash: "",
      pollIntervalMs: 1000,
      rentalTimeoutMs: 5000,
      json: false,
    }, {
      env: {
        CHAIN_ENVIRONMENT: "testnet",
        CHAIN_TESTNET_WHITELIST_EMAILS: "busy@example.com,free@example.com",
      },
      apiSecret: "secret",
      requestJson,
      sleep: async () => {},
    });

    expect(result).toMatchObject({
      ok: true,
      email: "free@example.com",
      topup: expect.objectContaining({
        id: "topup-1",
        confirmationMode: "synthetic",
      }),
      wallet: {
        before: 0,
        afterTopup: 1,
        afterCharge: 0.5,
      },
      rental: expect.objectContaining({
        id: "rental-1",
        status: "provisioning",
        configReady: true,
        chargeAmount: 0.5,
      }),
      cleanup: {
        rentalId: "rental-1",
        status: "destroyed",
      },
    });

    expect(state.confirmedTxHash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(state.chargeAttempts).toBe(2);
    expect(state.cleanupCalls).toBe(1);
    expect(requestJson).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      path: "/api/auth/register",
      body: { email: "busy@example.com" },
    }));
    expect(requestJson).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      path: "/api/rental",
      token: "token-free",
    }));
  });

  it("fails closed when testnet broadcasting is enabled but prerequisites are missing", async () => {
    const requestJson = vi.fn(async ({ method, path, token, body }) => {
      if (method === "POST" && path === "/api/auth/register") {
        return { ok: true, status: 200, body: { userId: "user-free", token: "token-free", email: body.email } };
      }

      if (method === "GET" && path === "/api/rentals") {
        return { ok: true, status: 200, body: { rentals: [] } };
      }

      if (method === "GET" && path === "/api/wallet") {
        return { ok: true, status: 200, body: { balance: 0, currency: "usd" } };
      }

      if (method === "POST" && path === "/api/wallet/crypto-topups") {
        return {
          ok: true,
          status: 200,
          body: {
            chainMode: {
              environment: "testnet",
              allowlisted: true,
              chain: {
                cryptoTopupEnabled: true,
                chain: "base",
                networkName: "base-sepolia",
                tokenAddress: "0x" + "1".repeat(40),
              },
            },
            topup: {
              id: "topup-2",
              rail: "wallet",
              expectedAmount: 1,
              fiatAmount: 1,
              amount: 1,
              address: "0x" + "2".repeat(40),
            },
          },
        };
      }

      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    await expect(runRechargeSmoke({
      api: "http://127.0.0.1:8787",
      envFile: ".env.selfhosted",
      amount: 1,
      protocol: "vless-reality",
      durationHours: 1,
      complianceProfileId: "standard",
      confirmationMode: "auto",
      txHash: "",
      pollIntervalMs: 1000,
      rentalTimeoutMs: 5000,
      json: false,
    }, {
      env: {
        CHAIN_ENVIRONMENT: "testnet",
        CHAIN_TESTNET_WHITELIST_EMAILS: "free@example.com",
      },
      apiSecret: "secret",
      requestJson,
      sleep: async () => {},
    })).rejects.toThrow("broadcast prerequisites are missing");

    expect(requestJson).not.toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      path: "/internal/crypto-topups/topup-2/confirm",
    }));
  });
});
