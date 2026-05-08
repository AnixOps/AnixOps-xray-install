import { describe, expect, it } from "vitest";
import { isChainFeatureAllowed, normalizeChainEnvironment, normalizeEmail } from "../src/chain-mode.js";

describe("chain mode helpers", () => {
  it("normalizes email addresses and chain environment values", () => {
    expect(normalizeEmail(" Test@Example.com ")).toBe("test@example.com");
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeChainEnvironment("mainnet")).toBe("mainnet");
    expect(normalizeChainEnvironment("anything-else")).toBe("testnet");
  });

  it("allows everyone when the chain environment is mainnet", () => {
    expect(isChainFeatureAllowed({
      chainEnvironment: "mainnet",
      whitelistEmails: [],
      email: null,
    })).toEqual({
      allowed: true,
      allowlistedOnly: false,
      reason: null,
    });
  });

  it("only allows whitelisted emails in testnet mode", () => {
    expect(isChainFeatureAllowed({
      chainEnvironment: "testnet",
      whitelistEmails: ["allow@example.com"],
      email: "allow@example.com",
    })).toEqual({
      allowed: true,
      allowlistedOnly: true,
      reason: null,
    });

    expect(isChainFeatureAllowed({
      chainEnvironment: "testnet",
      whitelistEmails: ["allow@example.com"],
      email: "block@example.com",
    })).toEqual({
      allowed: false,
      allowlistedOnly: true,
      reason: "not_allowlisted",
    });
  });
});
