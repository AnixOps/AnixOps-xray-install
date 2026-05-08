import { beforeAll, describe, expect, it } from "vitest";

let matchPendingTopupsToObservedTransfers: typeof import("../src/evm-chain.js").matchPendingTopupsToObservedTransfers;

beforeAll(async () => {
  process.env.DATABASE_URL ||= "postgresql://anixops:test@localhost:5432/anixops";
  process.env.REDIS_URL ||= "redis://localhost:6379";
  ({ matchPendingTopupsToObservedTransfers } = await import("../src/evm-chain.js"));
});

describe("evm-chain matching helpers", () => {
  it("matches a uniquely identifiable pending topup to an observed transfer", () => {
    const result = matchPendingTopupsToObservedTransfers({
      pendingTopups: [
        {
          id: "topup-1",
          address: "0x1111111111111111111111111111111111111111",
          expectedAmount: 10.000321,
          createdAt: "2026-05-08T10:00:00.000Z",
          expiresAt: "2026-05-08T11:00:00.000Z",
        },
      ],
      observedTransfers: [
        {
          txHash: "0xaaa",
          address: "0x1111111111111111111111111111111111111111",
          amount: 10.000321,
          confirmations: 12,
          blockNumber: 100,
          observedAt: "2026-05-08T10:05:00.000Z",
        },
      ],
      requiredConfirmations: 12,
      now: "2026-05-08T10:10:00.000Z",
    });

    expect(result.matches).toEqual([
      {
        topupId: "topup-1",
        txHash: "0xaaa",
        address: "0x1111111111111111111111111111111111111111",
        amount: 10.000321,
        confirmations: 12,
        blockNumber: 100,
        observedAt: "2026-05-08T10:05:00.000Z",
      },
    ]);
    expect(result.ambiguous).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("fails closed when multiple pending topups could match the same transfer", () => {
    const result = matchPendingTopupsToObservedTransfers({
      pendingTopups: [
        {
          id: "topup-1",
          address: "0x1111111111111111111111111111111111111111",
          expectedAmount: 10,
          createdAt: "2026-05-08T10:00:00.000Z",
          expiresAt: "2026-05-08T11:00:00.000Z",
        },
        {
          id: "topup-2",
          address: "0x1111111111111111111111111111111111111111",
          expectedAmount: 10,
          createdAt: "2026-05-08T10:01:00.000Z",
          expiresAt: "2026-05-08T11:00:00.000Z",
        },
      ],
      observedTransfers: [
        {
          txHash: "0xaaa",
          address: "0x1111111111111111111111111111111111111111",
          amount: 10,
          confirmations: 12,
          blockNumber: 100,
          observedAt: "2026-05-08T10:05:00.000Z",
        },
      ],
      requiredConfirmations: 12,
      now: "2026-05-08T10:10:00.000Z",
    });

    expect(result.matches).toEqual([]);
    expect(result.ambiguous).toHaveLength(1);
  });
});
