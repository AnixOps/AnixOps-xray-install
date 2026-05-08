import { describe, expect, it } from "vitest";
import {
  buildLegacyWalletLedger,
  buildLegacyWalletLedgerEntry,
  buildWalletLedger,
  buildWalletLedgerEntry,
  buildWalletSummary,
  buildWalletSummaryFromBalance,
  normalizeTopupAmount,
} from "../src/wallet.js";

describe("wallet compatibility helpers", () => {
  it("builds a wallet summary from the legacy users.balance field", () => {
    expect(buildWalletSummary({ id: "user-1", balance: 10.125 })).toEqual({
      userId: "user-1",
      balance: 10.13,
      currency: "usd",
      reserved: 0,
      available: 10.13,
      source: "legacy-user-balance",
    });
  });

  it("never exposes a negative available balance", () => {
    expect(buildWalletSummary({ id: "user-1", balance: -2 })).toMatchObject({
      balance: -2,
      available: 0,
    });
  });

  it("maps legacy payments into ledger-compatible entries", () => {
    expect(buildLegacyWalletLedgerEntry({
      id: "payment-1",
      rentalId: "rental-1",
      amount: 3,
      currency: "usd",
      method: "stripe",
      status: "completed",
      createdAt: "2026-05-06T12:00:00.000Z",
    })).toEqual({
      id: "payment-1",
      type: "legacy_payment",
      amount: 3,
      currency: "usd",
      status: "completed",
      rentalId: "rental-1",
      source: "payments",
      createdAt: "2026-05-06T12:00:00.000Z",
    });
  });

  it("marks redeem-code rows as legacy rental grants", () => {
    expect(buildLegacyWalletLedgerEntry({
      id: "payment-2",
      amount: 0,
      method: "redeem_code",
    })).toMatchObject({
      type: "legacy_redeem_rental_grant",
      amount: 0,
      currency: "usd",
      rentalId: null,
      source: "payments",
    });
  });

  it("builds a legacy ledger envelope without pagination until wallet_ledger exists", () => {
    expect(buildLegacyWalletLedger([
      { id: "payment-1", amount: 0.5, method: "stripe" },
    ])).toEqual({
      entries: [expect.objectContaining({ id: "payment-1", type: "legacy_payment" })],
      source: "legacy-payments",
      nextCursor: null,
    });
  });

  it("builds a ledger-derived wallet summary", () => {
    expect(buildWalletSummaryFromBalance({
      userId: "user-2",
      balance: 12.345,
      currency: "usd",
      source: "wallet-ledger",
    })).toEqual({
      userId: "user-2",
      balance: 12.35,
      currency: "usd",
      reserved: 0,
      available: 12.35,
      source: "wallet-ledger",
    });
  });

  it("maps wallet_ledger rows into API ledger entries", () => {
    expect(buildWalletLedgerEntry({
      id: "ledger-1",
      type: "topup",
      amount: 10,
      currency: "usd",
      topupId: "topup-1",
      balanceAfter: 12,
      idempotencyKey: "stripe:session-1:topup",
      createdAt: "2026-05-06T12:00:00.000Z",
    })).toEqual({
      id: "ledger-1",
      type: "topup",
      amount: 10,
      currency: "usd",
      status: "completed",
      rentalId: null,
      topupId: "topup-1",
      balanceAfter: 12,
      idempotencyKey: "stripe:session-1:topup",
      source: "wallet_ledger",
      createdAt: "2026-05-06T12:00:00.000Z",
    });
    expect(buildWalletLedger([
      { id: "ledger-1", type: "topup", amount: 10, balanceAfter: 12 },
    ])).toMatchObject({
      entries: [expect.objectContaining({ id: "ledger-1", balanceAfter: 12 })],
      source: "wallet-ledger",
      nextCursor: null,
    });
  });

  it("normalizes topup amounts to positive money values", () => {
    expect(normalizeTopupAmount("10.129")).toBe(10.13);
    expect(normalizeTopupAmount(0)).toBeNull();
    expect(normalizeTopupAmount("not-money")).toBeNull();
  });
});
