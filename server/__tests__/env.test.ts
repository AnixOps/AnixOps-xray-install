import { describe, expect, it } from "vitest";
import { loadServerEnv, parseAllowedOrigins, parseCsv } from "../src/config/env.js";

const strongSecret = "0123456789abcdef0123456789abcdef";

function baseEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/anixops",
    REDIS_URL: "redis://:strong-redis-password@localhost:6379",
    PROVISION_SERVER_TOKEN: strongSecret,
    API_SECRET: `${strongSecret}-admin`,
    ...overrides,
  };
}

describe("server environment configuration", () => {
  it("parses comma-separated lists with trimming and deduplication", () => {
    expect(parseCsv(" https://a.example,https://b.example, https://a.example ,,")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("uses ALLOWED_ORIGINS before FRONTEND_URL for CORS", () => {
    expect(parseAllowedOrigins("https://frontend.example", "https://app.example, https://admin.example")).toEqual([
      "https://app.example",
      "https://admin.example",
    ]);
  });

  it("falls back to FRONTEND_URL when ALLOWED_ORIGINS is omitted", () => {
    expect(loadServerEnv(baseEnv({ FRONTEND_URL: "https://frontend.example" })).allowedOrigins).toEqual([
      "https://frontend.example",
    ]);
  });

  it("uses the provision server port as the default provision URL", () => {
    expect(loadServerEnv(baseEnv()).PROVISION_SERVER_URL).toBe("http://localhost:3001");
  });

  it("rejects weak production secrets", () => {
    expect(() =>
      loadServerEnv(baseEnv({
        NODE_ENV: "production",
        PROVISION_SERVER_TOKEN: "dev-token",
        API_SECRET: "change-me-admin-secret",
        REDIS_URL: "redis://:change-me-redis-password@localhost:6379",
      })),
    ).toThrow(/Unsafe production configuration/);
  });

  it("accepts production configuration with strong secrets", () => {
    const env = loadServerEnv(baseEnv({
      NODE_ENV: "production",
      FRONTEND_URL: "https://anixops.example",
      ALLOWED_ORIGINS: "https://anixops.example,https://admin.anixops.example",
      CHAIN_TESTNET_WHITELIST_EMAILS: " qa@example.com , QA@example.com ",
    }));

    expect(env.allowedOrigins).toEqual([
      "https://anixops.example",
      "https://admin.anixops.example",
    ]);
    expect(env.chainWhitelistEmails).toEqual(["qa@example.com"]);
  });
});
