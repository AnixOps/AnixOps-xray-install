import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const {
  bootstrapEvmTestnet,
  buildNextSteps,
  buildWalletRecord,
  parseArgs,
  writeBootstrapEnvFile,
} = require("./bootstrap-evm-testnet.js");

describe("bootstrap-evm-testnet helpers", () => {
  it("parses CLI arguments", () => {
    expect(parseArgs([
      "--chain", "polygon-amoy",
      "--whitelist-emails", "qa@example.com",
      "--write-env",
      "--topup-private-key", "0x" + "1".repeat(64),
      "--anchor-private-key", "0x" + "2".repeat(64),
      "--deploy-mock-usdt",
      "--deployer-private-key", "0x" + "3".repeat(64),
      "--rpc-url", "https://rpc.example",
      "--mock-amount", "250000",
      "--gas-limit", "1500000",
      "--json",
    ])).toEqual({
      chain: "polygon-amoy",
      whitelistEmails: "qa@example.com",
      envFile: ".env.selfhosted",
      writeEnv: true,
      topupPrivateKey: "0x" + "1".repeat(64),
      anchorPrivateKey: "0x" + "2".repeat(64),
      deployMockUsdt: true,
      deployerPrivateKey: "0x" + "3".repeat(64),
      rpcUrl: "https://rpc.example",
      mockAmount: "250000",
      gasLimit: "1500000",
      json: true,
    });
  });

  it("builds wallet records from provided keys", () => {
    const record = buildWalletRecord("0x" + "1".repeat(64));

    expect(record.generated).toBe(false);
    expect(record.privateKey).toBe("0x" + "1".repeat(64));
    expect(record.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("writes the bootstrap env snippet back into an env file", () => {
    const dir = mkdtempSync(join(tmpdir(), "anixops-bootstrap-env-"));
    const envFile = join(dir, ".env.selfhosted");
    const exampleFile = join(dir, ".env.selfhosted.example");
    writeFileSync(exampleFile, [
      "CHAIN_ENVIRONMENT=testnet",
      "CHAIN_TESTNET_WHITELIST_EMAILS=",
      "CRYPTO_TOPUP_CHAIN=",
      "CRYPTO_TOPUP_TOKEN_ADDRESS=",
      "AUDIT_ANCHOR_CHAIN=",
      "AUDIT_ANCHOR_TARGET_ADDRESS=",
    ].join("\n"));

    const writtenPath = writeBootstrapEnvFile({
      envFile,
      exampleFile,
      envSnippet: [
        "CHAIN_ENVIRONMENT=testnet",
        "CHAIN_TESTNET_WHITELIST_EMAILS=qa@example.com",
        "CRYPTO_TOPUP_CHAIN=base",
        "CRYPTO_TOPUP_TOKEN_ADDRESS=0x" + "4".repeat(40),
        "AUDIT_ANCHOR_CHAIN=base",
        "AUDIT_ANCHOR_TARGET_ADDRESS=0x" + "5".repeat(40),
      ].join("\n"),
    });

    expect(writtenPath).toBe(envFile);
    const output = readFileSync(envFile, "utf8");
    expect(output).toContain("CHAIN_TESTNET_WHITELIST_EMAILS=qa@example.com");
    expect(output).toContain("CRYPTO_TOPUP_CHAIN=base");
    expect(output).toContain("CRYPTO_TOPUP_TOKEN_ADDRESS=0x" + "4".repeat(40));
    expect(output).toContain("AUDIT_ANCHOR_TARGET_ADDRESS=0x" + "5".repeat(40));
  });

  it("bootstraps env output without deploying mock usdt", async () => {
    const result = await bootstrapEvmTestnet({
      chain: "base-sepolia",
      whitelistEmails: "qa@example.com",
      envFile: "missing.env",
      topupPrivateKey: "0x" + "1".repeat(64),
      anchorPrivateKey: "0x" + "2".repeat(64),
      deployMockUsdt: false,
      writeEnv: false,
      rpcUrl: "https://rpc.example",
    });

    expect(result.chain).toBe("base-sepolia");
    expect(result.mockUsdt).toBe(null);
    expect(result.writtenEnvPath).toBe(null);
    expect(result.envSnippet).toContain("CHAIN_TESTNET_WHITELIST_EMAILS=qa@example.com");
    expect(result.envSnippet).toContain("CRYPTO_TOPUP_RPC_URL=https://rpc.example");
    expect(result.envSnippet).toContain("CRYPTO_TOPUP_TOKEN_ADDRESS=<fill-after-mock-usdt-deploy>");
    expect(result.envSnippet).toContain("AUDIT_ANCHOR_TARGET_ADDRESS=" + result.anchor.address);
  });

  it("fills token address when mock usdt is deployed", async () => {
    const deployMockUsdtFn = vi.fn(async () => ({
      chain: "base-sepolia",
      chainId: 84532,
      rpcUrl: "https://rpc.example",
      contractAddress: "0x" + "4".repeat(40),
      decimals: 6,
      symbol: "USDT",
      recipient: "0x" + "5".repeat(40),
      mintAmount: 100000,
      mintTxHash: "0x" + "6".repeat(64),
      deployerAddress: "0x" + "7".repeat(40),
    }));
    const result = await bootstrapEvmTestnet({
      chain: "base-sepolia",
      whitelistEmails: "qa@example.com",
      envFile: "missing.env",
      topupPrivateKey: "0x" + "1".repeat(64),
      anchorPrivateKey: "0x" + "2".repeat(64),
      deployMockUsdt: true,
      writeEnv: false,
      deployerPrivateKey: "0x" + "3".repeat(64),
      rpcUrl: "https://rpc.example",
      mockAmount: "100000",
    }, { deployMockUsdt: deployMockUsdtFn });

    expect(deployMockUsdtFn).toHaveBeenCalledTimes(1);
    expect(result.mockUsdt?.contractAddress).toBe("0x" + "4".repeat(40));
    expect(result.envSnippet).toContain("CRYPTO_TOPUP_TOKEN_ADDRESS=0x" + "4".repeat(40));
    expect(result.nextSteps.some((step) => step.includes("remote-ops.js deploy"))).toBe(true);
  });

  it("builds follow-up steps for predeploy and postdeploy states", () => {
    const predeploy = buildNextSteps({
      meta: { networkName: "base-sepolia", gasSymbol: "ETH" },
      topup: { address: "0x" + "1".repeat(40), privateKey: "0x" + "2".repeat(64), generated: true },
      anchor: { address: "0x" + "3".repeat(40), privateKey: "0x" + "4".repeat(64), generated: false },
      mockUsdt: null,
    });
    const postdeploy = buildNextSteps({
      meta: { networkName: "base-sepolia", gasSymbol: "ETH" },
      topup: { address: "0x" + "1".repeat(40), privateKey: "0x" + "2".repeat(64), generated: false },
      anchor: { address: "0x" + "3".repeat(40), privateKey: "0x" + "4".repeat(64), generated: false },
      mockUsdt: { contractAddress: "0x" + "5".repeat(40) },
      writeEnv: true,
    });

    expect(predeploy.some((step) => step.includes("Fund"))).toBe(true);
    expect(predeploy.some((step) => step.includes("--deploy-mock-usdt"))).toBe(true);
    expect(postdeploy.some((step) => step.includes("updated local .env.selfhosted"))).toBe(true);
    expect(postdeploy.some((step) => step.includes("remote-ops.js deploy"))).toBe(true);
    expect(postdeploy.some((step) => step.includes("crypto-topup-worker.js"))).toBe(true);
    expect(postdeploy.some((step) => step.includes("verify-audit-anchor.js"))).toBe(true);
  });
});
