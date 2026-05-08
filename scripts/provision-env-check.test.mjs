import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  isPlaceholder,
  loadProvisionEnv,
  parseAllowedOrigins,
  parseEnvFile,
  readArgs,
  summarizeProvisionEnv,
  validateProvisionEnv,
} = require("./provision-env-check.js");

const baseEnv = {
  PROVISION_SERVER_TOKEN: "strong-provision-token-0123456789",
  API_SECRET: "strong-api-secret-0123456789-abcdef",
  POSTGRES_PASSWORD: "strong-postgres-password",
  REDIS_PASSWORD: "strong-redis-password",
  FRONTEND_URL: "http://localhost:30000",
  ALLOWED_ORIGINS: "http://localhost:30000",
  VPS_REGION: "nrt",
  VPS_PLAN: "vhf-1c-1gb",
};

describe("provision env check", () => {
  it("parses CLI flags including local override control", () => {
    expect(readArgs(["--file", ".env.prod", "--allow-placeholders", "--no-local-overrides", "--summary"])).toEqual({
      file: ".env.prod",
      allowPlaceholders: true,
      summary: true,
      localOverrides: false,
    });
  });

  it("parses dotenv style files", () => {
    expect(parseEnvFile("A=1\n# comment\nB='two'\n")).toEqual({ A: "1", B: "two" });
  });

  it("loads env files with local secret overrides by default", () => {
    const dir = mkdtempSync(join(tmpdir(), "anixops-provision-env-"));
    try {
      writeFileSync(join(dir, ".env.selfhosted"), "CLOUD_PROVIDER=vultr\nVULTR_API_KEY=\n", "utf8");
      writeFileSync(join(dir, ".local-secrets.env"), "VULTR_API_KEY=vultr-from-local-secrets\n", "utf8");

      expect(loadProvisionEnv(".env.selfhosted", { cwd: dir })).toEqual({
        CLOUD_PROVIDER: "vultr",
        VULTR_API_KEY: "vultr-from-local-secrets",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can load env files without local secret overrides", () => {
    const dir = mkdtempSync(join(tmpdir(), "anixops-provision-env-"));
    try {
      writeFileSync(join(dir, ".env.selfhosted"), "CLOUD_PROVIDER=vultr\nVULTR_API_KEY=\n", "utf8");
      writeFileSync(join(dir, ".local-secrets.env"), "VULTR_API_KEY=vultr-from-local-secrets\n", "utf8");

      expect(loadProvisionEnv(".env.selfhosted", { cwd: dir, localOverrides: false })).toEqual({
        CLOUD_PROVIDER: "vultr",
        VULTR_API_KEY: "",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("strips inline comments from unquoted dotenv values", () => {
    expect(parseEnvFile("AWS_SECURITY_GROUP_ID=  # comment\nC=\"value # kept\"\n")).toEqual({
      AWS_SECURITY_GROUP_ID: "",
      C: "value # kept",
    });
  });

  it("detects placeholder values", () => {
    expect(isPlaceholder("change-me-token")).toBe(true);
    expect(isPlaceholder("your-secret")).toBe(true);
    expect(isPlaceholder("")).toBe(true);
    expect(isPlaceholder("real-secret")).toBe(false);
  });

  it("parses comma-separated allowed origins", () => {
    expect(parseAllowedOrigins("http://a.test, https://b.test ,")).toEqual([
      "http://a.test",
      "https://b.test",
    ]);
  });

  it("requires Vultr token by default", () => {
    const result = validateProvisionEnv({ ...baseEnv, CLOUD_PROVIDER: "vultr" });

    expect(result.provider).toBe("vultr");
    expect(result.issues).toContain("Missing VULTR_API_KEY");
  });

  it("requires DigitalOcean token for digitalocean provider", () => {
    const result = validateProvisionEnv(
      { ...baseEnv, CLOUD_PROVIDER: "digitalocean", DIGITALOCEAN_TOKEN: "" },
    );

    expect(result.issues).toContain("DIGITALOCEAN_TOKEN is empty or placeholder");
  });

  it("suggests switching provider when only another provider credential is configured", () => {
    const result = validateProvisionEnv(
      {
        ...baseEnv,
        CLOUD_PROVIDER: "vultr",
        DIGITALOCEAN_TOKEN: "do-real-token",
      },
    );

    expect(result.issues).toContain("Missing VULTR_API_KEY");
    expect(
      result.issues.some((issue) => issue.includes("detected configured credentials for digitalocean")),
    ).toBe(true);
  });

  it("accepts legacy DO_API_TOKEN as a compatibility alias", () => {
    const result = validateProvisionEnv(
      {
        ...baseEnv,
        CLOUD_PROVIDER: "digitalocean",
        VPS_REGION: "sgp1",
        VPS_PLAN: "s-1vcpu-1gb",
        DO_API_TOKEN: "do-real-token",
      },
    );

    expect(result.issues).toEqual([]);
  });

  it("accepts complete AWS configuration", () => {
    const result = validateProvisionEnv({
      ...baseEnv,
      CLOUD_PROVIDER: "aws",
      VPS_REGION: "ap-northeast-1",
      VPS_PLAN: "t3.micro",
      AWS_ACCESS_KEY_ID: "AKIATESTEXAMPLE000",
      AWS_SECRET_ACCESS_KEY: "aws-secret-value-0123456789",
      AWS_REGION: "ap-northeast-1",
      AWS_SECURITY_GROUP_ID: "sg-123456",
    });

    expect(result.issues).toEqual([]);
  });

  it("rejects weak production secrets and malformed URLs", () => {
    const result = validateProvisionEnv({
      CLOUD_PROVIDER: "vultr",
      VULTR_API_KEY: "vultr-token",
      PROVISION_SERVER_TOKEN: "too-short",
      API_SECRET: "short-secret",
      POSTGRES_PASSWORD: "small",
      REDIS_PASSWORD: "short",
      FRONTEND_URL: "not-a-url",
      ALLOWED_ORIGINS: "notaurl",
    });

    expect(result.issues).toContain("PROVISION_SERVER_TOKEN must be at least 32 characters");
    expect(result.issues).toContain("API_SECRET must be at least 32 characters");
    expect(result.issues).toContain("POSTGRES_PASSWORD must be at least 16 characters");
    expect(result.issues).toContain("REDIS_PASSWORD must be at least 16 characters");
    expect(result.issues).toContain("FRONTEND_URL must be a valid http(s) URL");
    expect(result.issues).toContain("ALLOWED_ORIGINS contains an invalid origin: notaurl");
  });

  it("rejects provider-region and plan mismatches", () => {
    const result = validateProvisionEnv({
      ...baseEnv,
      CLOUD_PROVIDER: "aws",
      VPS_REGION: "nrt",
      VPS_PLAN: "vhf-1c-1gb",
      AWS_ACCESS_KEY_ID: "AKIATESTEXAMPLE000",
      AWS_SECRET_ACCESS_KEY: "aws-secret-value-0123456789",
      AWS_REGION: "us-east-1",
      AWS_SECURITY_GROUP_ID: "sg-123456",
    });

    expect(result.issues).toContain("VPS_PLAN looks like a Vultr slug but CLOUD_PROVIDER is aws");
    expect(result.issues).toContain("VPS_REGION looks like a Vultr region but CLOUD_PROVIDER is aws");
    expect(result.issues).toContain("AWS_REGION should match VPS_REGION for AWS provisioning");
  });

  it("requires allowed origins to include the frontend URL", () => {
    const result = validateProvisionEnv({
      ...baseEnv,
      CLOUD_PROVIDER: "vultr",
      VULTR_API_KEY: "vultr-token",
      ALLOWED_ORIGINS: "http://example.com",
    });

    expect(result.issues).toContain("ALLOWED_ORIGINS should include FRONTEND_URL");
  });

  it("allows placeholders when explicitly requested", () => {
    const result = validateProvisionEnv(
      {
        ...baseEnv,
        CLOUD_PROVIDER: "vultr",
        VULTR_API_KEY: "",
      },
      { allowPlaceholders: true },
    );

    expect(result.issues).toEqual([]);
  });

  it("flags partial crypto or anchor chain configuration", () => {
    const result = validateProvisionEnv({
      ...baseEnv,
      CLOUD_PROVIDER: "vultr",
      VULTR_API_KEY: "vultr-token",
      CHAIN_ENVIRONMENT: "testnet",
      CHAIN_TESTNET_WHITELIST_EMAILS: "qa@example.com",
      CRYPTO_TOPUP_RPC_URL: "https://rpc.example",
      AUDIT_ANCHOR_RPC_URL: "https://rpc.example",
    });

    expect(result.issues.some((issue) => issue.includes("Crypto chain config is partial"))).toBe(true);
    expect(result.issues.some((issue) => issue.includes("Audit anchor config is partial"))).toBe(true);
  });

  it("summarizes chain readiness without exposing secrets", () => {
    const summary = summarizeProvisionEnv({
      ...baseEnv,
      CLOUD_PROVIDER: "vultr",
      VULTR_API_KEY: "secret-token",
      CHAIN_ENVIRONMENT: "testnet",
      CHAIN_TESTNET_WHITELIST_EMAILS: "qa@example.com",
      CRYPTO_TOPUP_CHAIN: "polygon",
      CRYPTO_TOPUP_ASSET: "USDT",
      CRYPTO_TOPUP_CONFIRMATIONS_REQUIRED: "12",
      CRYPTO_TOPUP_RPC_URL: "https://rpc.example",
      CRYPTO_TOPUP_SIGNER_PRIVATE_KEY: "0x" + "1".repeat(64),
      CRYPTO_TOPUP_TOKEN_ADDRESS: "0x" + "2".repeat(40),
      CRYPTO_TOPUP_TOKEN_DECIMALS: "6",
      AUDIT_ANCHOR_CHAIN: "polygon",
      AUDIT_ANCHOR_RPC_URL: "https://rpc.example",
      AUDIT_ANCHOR_SIGNER_PRIVATE_KEY: "0x" + "3".repeat(64),
      AUDIT_ANCHOR_TARGET_ADDRESS: "0x" + "4".repeat(40),
    });

    expect(summary.chain).toEqual({
      enabled: true,
      environment: "testnet",
      whitelistConfigured: true,
      cryptoTopup: "ready",
      cryptoTopupMissingKeys: [],
      auditAnchor: "ready",
      auditAnchorMissingKeys: [],
    });
  });

  it("accepts crypto topup readiness when only receiver address is provided", () => {
    const result = validateProvisionEnv({
      ...baseEnv,
      CLOUD_PROVIDER: "vultr",
      VULTR_API_KEY: "secret-token",
      CHAIN_ENVIRONMENT: "testnet",
      CHAIN_TESTNET_WHITELIST_EMAILS: "qa@example.com",
      CRYPTO_TOPUP_CHAIN: "base",
      CRYPTO_TOPUP_ASSET: "USDT",
      CRYPTO_TOPUP_CONFIRMATIONS_REQUIRED: "12",
      CRYPTO_TOPUP_RPC_URL: "https://rpc.example",
      CRYPTO_TOPUP_RECEIVER_ADDRESS: "0x" + "1".repeat(40),
      CRYPTO_TOPUP_TOKEN_ADDRESS: "0x" + "2".repeat(40),
      CRYPTO_TOPUP_TOKEN_DECIMALS: "6",
    });

    expect(result.issues).toEqual([]);
  });

  it("requires an anchor target address for audit anchor readiness", () => {
    const result = validateProvisionEnv({
      ...baseEnv,
      CLOUD_PROVIDER: "vultr",
      VULTR_API_KEY: "secret-token",
      CHAIN_ENVIRONMENT: "testnet",
      CHAIN_TESTNET_WHITELIST_EMAILS: "qa@example.com",
      AUDIT_ANCHOR_CHAIN: "base",
      AUDIT_ANCHOR_RPC_URL: "https://rpc.example",
      AUDIT_ANCHOR_SIGNER_PRIVATE_KEY: "0x" + "3".repeat(64),
    });

    expect(result.issues.some((issue) => issue.includes("AUDIT_ANCHOR_TARGET_ADDRESS"))).toBe(true);
  });

  it("summarizes env metadata without exposing values", () => {
    const summary = summarizeProvisionEnv({
      ...baseEnv,
      ADMIN_EMAILS: "ops@example.com",
      CLOUD_PROVIDER: "vultr",
      VULTR_API_KEY: "secret-token",
    });

    expect(summary.provider).toBe("vultr");
    expect(summary.entries.PROVISION_SERVER_TOKEN.present).toBe(true);
    expect(summary.entries.PROVISION_SERVER_TOKEN.length).toBe(baseEnv.PROVISION_SERVER_TOKEN.length);
    expect(summary.entries.PROVISION_SERVER_TOKEN.required).toBe(true);
    expect(summary.entries.ADMIN_EMAILS.present).toBe(true);
    expect(summary.entries.VULTR_API_KEY.required).toBe(true);
  });
});
