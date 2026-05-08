import { beforeAll, describe, expect, it } from "vitest";

let allocateCryptoDepositAddress: typeof import("../src/crypto-topups.js").allocateCryptoDepositAddress;
let buildExpectedCryptoAmount: typeof import("../src/crypto-topups.js").buildExpectedCryptoAmount;
let buildCryptoTopupIdempotencyKey: typeof import("../src/crypto-topups.js").buildCryptoTopupIdempotencyKey;
let normalizeCryptoAsset: typeof import("../src/crypto-topups.js").normalizeCryptoAsset;
let normalizeCryptoFiatAmount: typeof import("../src/crypto-topups.js").normalizeCryptoFiatAmount;
let normalizeCryptoNetwork: typeof import("../src/crypto-topups.js").normalizeCryptoNetwork;

beforeAll(async () => {
  process.env.DATABASE_URL ||= "postgresql://anixops:test@localhost:5432/anixops";
  process.env.REDIS_URL ||= "redis://localhost:6379";
  ({
    allocateCryptoDepositAddress,
    buildExpectedCryptoAmount,
    buildCryptoTopupIdempotencyKey,
    normalizeCryptoAsset,
    normalizeCryptoFiatAmount,
    normalizeCryptoNetwork,
  } = await import("../src/crypto-topups.js"));
});

describe("crypto topup helpers", () => {
  it("normalizes supported assets, networks, and fiat amounts", () => {
    expect(normalizeCryptoAsset("usdt")).toBe("USDT");
    expect(normalizeCryptoAsset("doge")).toBeNull();
    expect(normalizeCryptoNetwork("polygon")).toBe("POLYGON");
    expect(normalizeCryptoFiatAmount("10.129")).toBe(10.13);
    expect(normalizeCryptoFiatAmount("0.5")).toBeNull();
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
});
