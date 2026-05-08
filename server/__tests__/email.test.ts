import { describe, expect, it } from "vitest";
import { buildMagicLink, getMissingSmtpKeys, isSmtpConfigured } from "../src/auth/email.js";
import type { ServerEnv } from "../src/config/env.js";

function env(overrides: Partial<ServerEnv> = {}): ServerEnv {
  return {
    NODE_ENV: "production",
    PORT: "8787",
    DATABASE_URL: "postgresql://user:pass@localhost:5432/anixops",
    REDIS_URL: "redis://:strong-redis-password@localhost:6379",
    PROVISION_SERVER_URL: "http://provision:3001",
    PROVISION_SERVER_TOKEN: "0123456789abcdef0123456789abcdef",
    API_SECRET: "abcdef0123456789abcdef0123456789",
    FRONTEND_URL: "https://app.example/",
    allowedOrigins: ["https://app.example"],
    ...overrides,
  };
}

describe("magic-link email helpers", () => {
  it("detects incomplete SMTP configuration", () => {
    expect(getMissingSmtpKeys(env({ SMTP_PORT: "465" }))).toEqual(["SMTP_HOST", "SMTP_USER", "SMTP_PASS"]);
    expect(isSmtpConfigured(env({ SMTP_PORT: "465" }))).toBe(false);
  });

  it("requires a valid SMTP port", () => {
    expect(isSmtpConfigured(env({
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "invalid",
      SMTP_USER: "mailer@example.com",
      SMTP_PASS: "secret",
    }))).toBe(false);
  });

  it("accepts complete SMTP configuration", () => {
    expect(isSmtpConfigured(env({
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "465",
      SMTP_USER: "mailer@example.com",
      SMTP_PASS: "secret",
    }))).toBe(true);
  });

  it("builds a normalized callback link", () => {
    expect(buildMagicLink("https://app.example/", "token with spaces")).toBe(
      "https://app.example/auth/callback?token=token%20with%20spaces",
    );
  });
});
