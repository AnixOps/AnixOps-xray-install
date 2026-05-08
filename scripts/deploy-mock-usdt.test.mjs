import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const {
  applyMintGasBuffer,
  normalizeAddress,
  normalizeMintAmount,
  normalizePrivateKey,
  parseLocalEnv,
  parseArgs,
} = require("./deploy-mock-usdt.js");

describe("deploy-mock-usdt helpers", () => {
  it("parses CLI arguments", () => {
    expect(parseArgs([
      "--chain", "base-sepolia",
      "--rpc-url", "https://rpc-amoy.polygon.technology",
      "--private-key", "0x" + "1".repeat(64),
      "--recipient", "0x" + "2".repeat(40),
      "--amount", "250",
      "--gas-limit", "1500000",
      "--json",
    ])).toEqual({
      chain: "base-sepolia",
      rpcUrl: "https://rpc-amoy.polygon.technology",
      privateKey: "0x" + "1".repeat(64),
      envFile: ".env.selfhosted",
      recipient: "0x" + "2".repeat(40),
      amount: "250",
      gasLimit: "1500000",
      json: true,
    });
  });

  it("normalizes keys, addresses, and mint amounts", () => {
    expect(normalizePrivateKey("1".repeat(64))).toBe("0x" + "1".repeat(64));
    expect(normalizePrivateKey("bad")).toBe("");
    expect(normalizeAddress("0x" + "2".repeat(40))).toBe("0x" + "2".repeat(40));
    expect(normalizeAddress("bad")).toBe("");
    expect(normalizeMintAmount("1000")).toBe(1000);
    expect(() => normalizeMintAmount("0")).toThrow("positive number");
  });

  it("adds a safety buffer to mint gas estimates", () => {
    expect(applyMintGasBuffer(71491n)).toBe(100000n);
    expect(applyMintGasBuffer(100000n)).toBe(130000n);
  });

  it("loads env values from the configured env file path", () => {
    const dir = mkdtempSync(join(tmpdir(), "anixops-mock-usdt-"));
    writeFileSync(join(dir, ".env.selfhosted"), "CRYPTO_TOPUP_RPC_URL=https://rpc.example\n");

    expect(parseLocalEnv(join(dir, ".env.selfhosted"))).toEqual({
      CRYPTO_TOPUP_RPC_URL: "https://rpc.example",
    });
  });

  it("lets .local-secrets.env override env file values", () => {
    const dir = mkdtempSync(join(tmpdir(), "anixops-mock-usdt-"));
    writeFileSync(join(dir, ".env.selfhosted"), "CRYPTO_TOPUP_RPC_URL=https://rpc.example\n", "utf8");
    writeFileSync(join(dir, ".local-secrets.env"), "CRYPTO_TOPUP_RPC_URL=https://rpc.override\n", "utf8");

    expect(parseLocalEnv(join(dir, ".env.selfhosted"))).toEqual({
      CRYPTO_TOPUP_RPC_URL: "https://rpc.override",
    });
  });
});
