import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const compose = readFileSync("docker-compose.selfhosted.yml", "utf8");
const exampleEnv = readFileSync(".env.selfhosted.example", "utf8");

describe("self-hosted compose wiring", () => {
  it("passes provider selection and region defaults into the provision container", () => {
    expect(compose).toContain("- CLOUD_PROVIDER=${CLOUD_PROVIDER}");
    expect(compose).toContain("- VPS_REGION=${VPS_REGION}");
    expect(compose).toContain("- VPS_PLAN=${VPS_PLAN}");
    expect(compose).toContain("- AWS_REGION=${AWS_REGION}");
  });

  it("passes chain-backed env settings into the API container", () => {
    expect(compose).toContain("- ALLOWED_ORIGINS=${ALLOWED_ORIGINS}");
    expect(compose).toContain("- CHAIN_ENVIRONMENT=${CHAIN_ENVIRONMENT}");
    expect(compose).toContain("- CHAIN_TESTNET_WHITELIST_EMAILS=${CHAIN_TESTNET_WHITELIST_EMAILS}");
    expect(compose).toContain("- CRYPTO_TOPUP_CHAIN=${CRYPTO_TOPUP_CHAIN}");
    expect(compose).toContain("- CRYPTO_TOPUP_ASSET=${CRYPTO_TOPUP_ASSET}");
    expect(compose).toContain("- CRYPTO_TOPUP_CONFIRMATIONS_REQUIRED=${CRYPTO_TOPUP_CONFIRMATIONS_REQUIRED}");
    expect(compose).toContain("- CRYPTO_TOPUP_RPC_URL=${CRYPTO_TOPUP_RPC_URL}");
    expect(compose).toContain("- CRYPTO_TOPUP_SIGNER_PRIVATE_KEY=${CRYPTO_TOPUP_SIGNER_PRIVATE_KEY}");
    expect(compose).toContain("- CRYPTO_TOPUP_RECEIVER_ADDRESS=${CRYPTO_TOPUP_RECEIVER_ADDRESS}");
    expect(compose).toContain("- CRYPTO_TOPUP_TOKEN_ADDRESS=${CRYPTO_TOPUP_TOKEN_ADDRESS}");
    expect(compose).toContain("- CRYPTO_TOPUP_TOKEN_DECIMALS=${CRYPTO_TOPUP_TOKEN_DECIMALS}");
    expect(compose).toContain("- AUDIT_ANCHOR_CHAIN=${AUDIT_ANCHOR_CHAIN}");
    expect(compose).toContain("- AUDIT_ANCHOR_RPC_URL=${AUDIT_ANCHOR_RPC_URL}");
    expect(compose).toContain("- AUDIT_ANCHOR_SIGNER_PRIVATE_KEY=${AUDIT_ANCHOR_SIGNER_PRIVATE_KEY}");
    expect(compose).toContain("- AUDIT_ANCHOR_TARGET_ADDRESS=${AUDIT_ANCHOR_TARGET_ADDRESS}");
    expect(compose).toContain("- AUDIT_ANCHOR_MIN_NATIVE_BALANCE=${AUDIT_ANCHOR_MIN_NATIVE_BALANCE}");
  });

  it("wires the self-hosted scheduler container and intervals", () => {
    expect(compose).toContain("scheduler:");
    expect(compose).toContain("dockerfile: Dockerfile.scheduler");
    expect(compose).toContain("- ANIXOPS_API_URL=http://api:8787");
    expect(compose).toContain("- BILLING_TICK_CRON=${BILLING_TICK_CRON:-*/5 * * * *}");
    expect(compose).toContain("- SCHEDULER_ENABLE_AUDIT_ANCHOR=${SCHEDULER_ENABLE_AUDIT_ANCHOR:-auto}");
    expect(compose).toContain('test: ["CMD-SHELL", "crontab -l >/dev/null 2>&1"]');
    expect(exampleEnv).toContain("SCHEDULER_ENABLE_AUDIT_ANCHOR=auto");
  });

  it("does not hard-code the PostgreSQL password in compose", () => {
    expect(compose).toContain("- DATABASE_URL=postgresql://anixops:${POSTGRES_PASSWORD}@postgres:5432/anixops");
    expect(compose).toContain("- POSTGRES_PASSWORD=${POSTGRES_PASSWORD}");
    expect(compose).not.toContain("- POSTGRES_PASSWORD=anixops");
  });

  it("includes AWS_REGION in the example self-hosted env file", () => {
    expect(exampleEnv).toContain("ADMIN_EMAILS=");
    expect(exampleEnv).toContain("DO_API_TOKEN=");
    expect(exampleEnv).toContain("AWS_REGION=");
  });
});
