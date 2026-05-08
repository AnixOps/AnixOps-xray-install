import { randomUUID } from "crypto";
import { beforeAll, describe, expect, it } from "vitest";

let allocateCryptoDepositAddress: typeof import("../src/crypto-topups.js").allocateCryptoDepositAddress;
let completeCryptoTopup: typeof import("../src/crypto-topups.js").completeCryptoTopup;
let buildExpectedCryptoAmount: typeof import("../src/crypto-topups.js").buildExpectedCryptoAmount;
let buildCryptoTopupIdempotencyKey: typeof import("../src/crypto-topups.js").buildCryptoTopupIdempotencyKey;
let createCryptoTopup: typeof import("../src/crypto-topups.js").createCryptoTopup;
let getCryptoTopupForUser: typeof import("../src/crypto-topups.js").getCryptoTopupForUser;
let getLatestLedgerBalance: typeof import("../src/wallet-ledger.js").getLatestLedgerBalance;
let listPendingCryptoTopups: typeof import("../src/crypto-topups.js").listPendingCryptoTopups;
let formatCryptoTopup: typeof import("../src/crypto-topups.js").formatCryptoTopup;
let normalizeCryptoAsset: typeof import("../src/crypto-topups.js").normalizeCryptoAsset;
let normalizeCryptoFiatAmount: typeof import("../src/crypto-topups.js").normalizeCryptoFiatAmount;
let normalizeCryptoNetwork: typeof import("../src/crypto-topups.js").normalizeCryptoNetwork;
let normalizeCryptoRail: typeof import("../src/crypto-topups.js").normalizeCryptoRail;

process.env.DATABASE_URL ||= "postgresql://anixops:test@localhost:5432/anixops";
process.env.REDIS_URL ||= "redis://localhost:6379";

async function canConnectToDatabase() {
  try {
    const { Client } = await import("pg");
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 250,
    });
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

const runDbIntegration = await canConnectToDatabase();

beforeAll(async () => {
  ({
    allocateCryptoDepositAddress,
    completeCryptoTopup,
    buildExpectedCryptoAmount,
    buildCryptoTopupIdempotencyKey,
    createCryptoTopup,
    getCryptoTopupForUser,
    getLatestLedgerBalance,
    listPendingCryptoTopups,
    formatCryptoTopup,
    normalizeCryptoAsset,
    normalizeCryptoFiatAmount,
    normalizeCryptoNetwork,
    normalizeCryptoRail,
  } = await import("../src/crypto-topups.js"));
});

describe("crypto topup helpers", () => {
  it("normalizes supported assets, networks, and fiat amounts", () => {
    expect(normalizeCryptoAsset("usdt")).toBe("USDT");
    expect(normalizeCryptoAsset("doge")).toBeNull();
    expect(normalizeCryptoNetwork("polygon")).toBe("POLYGON");
    expect(normalizeCryptoFiatAmount("10.129")).toBe(10.13);
    expect(normalizeCryptoFiatAmount("0.5")).toBeNull();
    expect(normalizeCryptoRail("wallet")).toBe("wallet");
    expect(normalizeCryptoRail("x402")).toBe("x402");
    expect(normalizeCryptoRail("card")).toBeNull();
  });

  it("allocates deterministic self-hosted deposit references", () => {
    expect(allocateCryptoDepositAddress({
      userId: "user-1",
      asset: "USDT",
      network: "TRC20",
    })).toMatch(/^anixops_trc20_[a-f0-9]{32}$/);
  });

  it("builds transaction-scoped idempotency keys", () => {
    expect(buildCryptoTopupIdempotencyKey({ network: "TRC20", txHash: "  ABC12345  " }))
      .toBe("crypto:trc20:abc12345");
  });

  it("builds six-decimal expected crypto amounts", () => {
    expect(buildExpectedCryptoAmount(10)).toBe(10);
    expect(buildExpectedCryptoAmount(10, 321)).toBe(10.000321);
  });

  it("formats crypto topups with rail and timestamp fields", () => {
    expect(formatCryptoTopup({
      id: "topup-1",
      userId: "user-1",
      asset: "USDT",
      network: "TRC20",
      rail: undefined,
      address: "anixops_trc20_test",
      expectedAmount: 10,
      receivedAmount: 10,
      fiatAmount: 10,
      currency: "usd",
      status: "pending",
      txHash: null,
      confirmations: 0,
      ledgerId: null,
      expiresAt: "2026-05-06T13:00:00.000Z",
      completedAt: null,
      createdAt: "2026-05-06T12:00:00.000Z",
      updatedAt: "2026-05-06T12:00:00.000Z",
      idempotencyKey: "crypto-topup:topup-1",
    } as Parameters<typeof formatCryptoTopup>[0])).toMatchObject({
      rail: "wallet",
      createdAt: "2026-05-06T12:00:00.000Z",
      expiresAt: "2026-05-06T13:00:00.000Z",
      completedAt: null,
    });
  });

  const maybeIt = runDbIntegration ? it : it.skip;

  maybeIt("books a completed crypto topup into the wallet ledger", async () => {
    const userId = `user-${randomUUID()}`;
    const receiverAddress = "anixops_trc20_test_wallet";

    const created = await createCryptoTopup({
      userId,
      fiatAmount: 15.25,
      asset: "USDT",
      network: "TRC20",
      rail: "wallet",
      receiverAddress,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.error);
    }

    expect(created.topup.rail).toBe("wallet");
    expect(await getLatestLedgerBalance(userId)).toBeNull();
    expect(await getCryptoTopupForUser(userId, created.topup.id)).toMatchObject({
      id: created.topup.id,
      rail: "wallet",
      status: "pending",
    });
    expect(await listPendingCryptoTopups({
      asset: "USDT",
      network: "TRC20",
      address: receiverAddress,
    })).toHaveLength(1);

    const txHash = `0x${randomUUID().replace(/-/g, "")}`;
    const completed = await completeCryptoTopup({
      topupId: created.topup.id,
      txHash,
      receivedAmount: 15.25,
      confirmations: 12,
    });
    expect(completed.ok).toBe(true);
    if (!completed.ok) {
      throw new Error(completed.error);
    }

    expect(completed.alreadyProcessed).toBe(false);
    expect(completed.topup).toMatchObject({
      id: created.topup.id,
      rail: "wallet",
      status: "completed",
      txHash,
    });
    expect(await getCryptoTopupForUser(userId, created.topup.id)).toMatchObject({
      id: created.topup.id,
      status: "completed",
      txHash,
      rail: "wallet",
    });
    expect(await listPendingCryptoTopups({
      asset: "USDT",
      network: "TRC20",
      address: receiverAddress,
    })).toHaveLength(0);
    expect(await getLatestLedgerBalance(userId)).toEqual({
      balance: 15.25,
      currency: "usd",
    });

    const replay = await completeCryptoTopup({
      topupId: created.topup.id,
      txHash,
      receivedAmount: 15.25,
      confirmations: 12,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) {
      throw new Error(replay.error);
    }
    expect(replay.alreadyProcessed).toBe(true);
  });
});
