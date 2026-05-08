import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildWalletEnvSnippet, parseArgs } = require("./generate-testnet-wallets.js");

describe("generate-testnet-wallets helpers", () => {
  it("parses CLI arguments", () => {
    expect(parseArgs([
      "--chain", "polygon-amoy",
      "--whitelist-emails", "qa1@example.com,qa2@example.com",
      "--json",
    ])).toEqual({
      chain: "polygon-amoy",
      whitelistEmails: "qa1@example.com,qa2@example.com",
      json: true,
    });
  });

  it("defaults to base-sepolia", () => {
    expect(parseArgs([])).toEqual({
      chain: "base-sepolia",
      whitelistEmails: "",
      json: false,
    });
  });

  it("builds an env snippet for the generated wallets", () => {
    const snippet = buildWalletEnvSnippet({
      chain: "polygon-amoy",
      whitelistEmails: "qa@example.com",
      topup: {
        address: "0x" + "1".repeat(40),
        privateKey: "0x" + "2".repeat(64),
      },
      anchor: {
        address: "0x" + "3".repeat(40),
        privateKey: "0x" + "4".repeat(64),
      },
    });

    expect(snippet).toContain("CHAIN_ENVIRONMENT=testnet");
    expect(snippet).toContain("CHAIN_TESTNET_WHITELIST_EMAILS=qa@example.com");
    expect(snippet).toContain("CRYPTO_TOPUP_CHAIN=polygon");
    expect(snippet).toContain("CRYPTO_TOPUP_RPC_URL=https://rpc-amoy.polygon.technology");
    expect(snippet).toContain("CRYPTO_TOPUP_SIGNER_PRIVATE_KEY=0x" + "2".repeat(64));
    expect(snippet).toContain("AUDIT_ANCHOR_TARGET_ADDRESS=0x" + "3".repeat(40));
  });

  it("uses base-sepolia defaults when requested", () => {
    const snippet = buildWalletEnvSnippet({
      chain: "base-sepolia",
      whitelistEmails: "qa@example.com",
      topup: {
        address: "0x" + "1".repeat(40),
        privateKey: "0x" + "2".repeat(64),
      },
      anchor: {
        address: "0x" + "3".repeat(40),
        privateKey: "0x" + "4".repeat(64),
      },
    });

    expect(snippet).toContain("CRYPTO_TOPUP_CHAIN=base");
    expect(snippet).toContain("CRYPTO_TOPUP_RPC_URL=https://sepolia.base.org");
    expect(snippet).toContain("AUDIT_ANCHOR_CHAIN=base");
  });
});
