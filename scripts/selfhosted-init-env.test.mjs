import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildInitializedEnv,
  chooseProvider,
  generateSecureValue,
  inferProviderFromCredentials,
  parseArgs,
  serializeEnvFile,
} = require("./selfhosted-init-env.js");

const exampleEnv = {
  FRONTEND_URL: "http://localhost:30000",
  ALLOWED_ORIGINS: "http://localhost:30000",
  NEXT_PUBLIC_WORKER_URL: "",
  API_PROXY_TIMEOUT_MS: "15000",
  PROVISION_SERVER_TOKEN: "change-me-min-32-random-chars",
  API_SECRET: "change-me-admin-secret",
  POSTGRES_PASSWORD: "change-me-postgres-password",
  REDIS_PASSWORD: "change-me-redis-password",
  ADMIN_EMAILS: "",
  CLOUD_PROVIDER: "vultr",
  VPS_REGION: "nrt",
  VPS_PLAN: "vhf-1c-1gb",
  VULTR_API_KEY: "",
};

describe("self-hosted init env helpers", () => {
  it("parses CLI arguments", () => {
    expect(parseArgs([
      "--out",
      ".env.runtime",
      "--provider",
      "aws",
      "--frontend-url",
      "https://example.com",
      "--allowed-origins",
      "https://example.com",
      "--admin-email",
      "ops@example.com",
      "--aws-access-key-id",
      "AKIAEXAMPLE",
      "--aws-secret-access-key",
      "aws-secret",
      "--aws-region",
      "us-east-1",
      "--aws-security-group-id",
      "sg-123456",
      "--dry-run",
    ])).toEqual({
      out: ".env.runtime",
      provider: "aws",
      frontendUrl: "https://example.com",
      allowedOrigins: "https://example.com",
      adminEmail: "ops@example.com",
      vultrApiKey: "",
      digitaloceanToken: "",
      awsAccessKeyId: "AKIAEXAMPLE",
      awsSecretAccessKey: "aws-secret",
      awsRegion: "us-east-1",
      awsSecurityGroupId: "sg-123456",
      dryRun: true,
    });
  });

  it("generates secure values at the requested length", () => {
    const token = generateSecureValue(48);
    expect(token).toHaveLength(48);
  });

  it("initializes missing secrets and preserves explicit existing values", () => {
    const result = buildInitializedEnv({
      exampleEnv,
      existingEnv: {
        ADMIN_EMAILS: "ops@example.com",
        FRONTEND_URL: "https://existing.example.com",
      },
      options: {},
    });

    expect(result.generatedKeys).toEqual([
      "PROVISION_SERVER_TOKEN",
      "API_SECRET",
      "POSTGRES_PASSWORD",
      "REDIS_PASSWORD",
    ]);
    expect(result.env.ADMIN_EMAILS).toBe("ops@example.com");
    expect(result.env.FRONTEND_URL).toBe("https://existing.example.com");
    expect(result.env.ALLOWED_ORIGINS).toBe("http://localhost:30000");
    expect(result.env.VPS_REGION).toBe("nrt");
    expect(result.env.VPS_PLAN).toBe("vhf-1c-1gb");
    expect(result.validation.issues).toContain("VULTR_API_KEY is empty or placeholder");
  });

  it("applies requested provider and public URLs", () => {
    const result = buildInitializedEnv({
      exampleEnv,
      options: {
        provider: "aws",
        frontendUrl: "https://panel.example.com",
        allowedOrigins: "https://panel.example.com,https://ops.example.com",
        adminEmail: "ops@example.com",
        awsAccessKeyId: "AKIATESTEXAMPLE000",
        awsSecretAccessKey: "aws-secret-value-0123456789",
        awsRegion: "ap-northeast-1",
        awsSecurityGroupId: "sg-123456",
      },
    });

    expect(result.env.CLOUD_PROVIDER).toBe("aws");
    expect(result.env.FRONTEND_URL).toBe("https://panel.example.com");
    expect(result.env.ALLOWED_ORIGINS).toBe("https://panel.example.com,https://ops.example.com");
    expect(result.env.ADMIN_EMAILS).toBe("ops@example.com");
    expect(result.env.VPS_REGION).toBe("ap-northeast-1");
    expect(result.env.VPS_PLAN).toBe("t3.micro");
    expect(result.env.AWS_REGION).toBe("ap-northeast-1");
    expect(result.env.AWS_ACCESS_KEY_ID).toBe("AKIATESTEXAMPLE000");
    expect(result.env.AWS_SECRET_ACCESS_KEY).toBe("aws-secret-value-0123456789");
    expect(result.env.AWS_SECURITY_GROUP_ID).toBe("sg-123456");
    expect(result.validation.issues).toEqual([]);
  });

  it("applies local credential file overrides when provided", () => {
    const result = buildInitializedEnv({
      exampleEnv,
      options: {
        localCredentials: {
          VULTR_API_KEY: "vultr-from-file",
          CLOUDFLARE_TOKEN: "cf-from-file",
          CLOUDFLARE_ZONE_ID: "cf-zone-id",
          SMTP_HOST: "mail.example.com",
          SMTP_PORT: "465",
          SMTP_USER: "ops@example.com",
          SMTP_PASS: "smtp-password",
          SMTP_SECURE: "true",
          SMTP_FROM: "ops@example.com",
        },
      },
    });

    expect(result.env.VULTR_API_KEY).toBe("vultr-from-file");
    expect(result.env.CLOUDFLARE_TOKEN).toBe("cf-from-file");
    expect(result.env.CLOUDFLARE_ZONE_ID).toBe("cf-zone-id");
    expect(result.env.SMTP_HOST).toBe("mail.example.com");
    expect(result.env.SMTP_USER).toBe("ops@example.com");
    expect(result.env.SMTP_PASS).toBe("smtp-password");
    expect(result.validation.issues).toEqual([]);
  });

  it("infers DigitalOcean as the provider from local credentials on first init", () => {
    const result = buildInitializedEnv({
      exampleEnv,
      options: {
        localCredentials: {
          DIGITALOCEAN_TOKEN: "do-secret-token",
        },
      },
    });

    expect(result.env.CLOUD_PROVIDER).toBe("digitalocean");
    expect(result.env.VPS_REGION).toBe("sgp1");
    expect(result.env.VPS_PLAN).toBe("s-1vcpu-1gb");
    expect(result.env.DIGITALOCEAN_TOKEN).toBe("do-secret-token");
    expect(result.validation.issues).toEqual([]);
  });

  it("switches away from the default vultr placeholder when local credentials clearly target another provider", () => {
    const result = buildInitializedEnv({
      exampleEnv,
      existingEnv: {
        CLOUD_PROVIDER: "vultr",
        VPS_REGION: "nrt",
        VPS_PLAN: "vhf-1c-1gb",
      },
      options: {
        localCredentials: {
          DIGITALOCEAN_TOKEN: "do-secret-token",
        },
      },
    });

    expect(result.env.CLOUD_PROVIDER).toBe("digitalocean");
    expect(result.env.VPS_REGION).toBe("sgp1");
    expect(result.env.VPS_PLAN).toBe("s-1vcpu-1gb");
    expect(result.validation.issues).toEqual([]);
  });

  it("keeps the existing provider when its credential is already configured", () => {
    const result = buildInitializedEnv({
      exampleEnv,
      existingEnv: {
        CLOUD_PROVIDER: "vultr",
        VULTR_API_KEY: "vultr-secret-token",
      },
      options: {
        localCredentials: {
          DIGITALOCEAN_TOKEN: "do-secret-token",
        },
      },
    });

    expect(result.env.CLOUD_PROVIDER).toBe("vultr");
    expect(result.env.VULTR_API_KEY).toBe("vultr-secret-token");
  });

  it("migrates legacy DO_API_TOKEN into DIGITALOCEAN_TOKEN", () => {
    const result = buildInitializedEnv({
      exampleEnv,
      existingEnv: {
        CLOUD_PROVIDER: "digitalocean",
        DO_API_TOKEN: "legacy-do-token",
      },
    });

    expect(result.env.DIGITALOCEAN_TOKEN).toBe("legacy-do-token");
  });

  it("infers a single provider from credentials and stays empty on ambiguous input", () => {
    expect(inferProviderFromCredentials({ DIGITALOCEAN_TOKEN: "do-secret-token" })).toBe("digitalocean");
    expect(
      inferProviderFromCredentials({
        DIGITALOCEAN_TOKEN: "do-secret-token",
        VULTR_API_KEY: "vultr-secret-token",
      }),
    ).toBe("");
  });

  it("prefers explicit CLI provider over inferred credentials", () => {
    expect(
      chooseProvider({
        options: {
          provider: "aws",
          localCredentials: {
            DIGITALOCEAN_TOKEN: "do-secret-token",
          },
        },
        existingEnv: {
          CLOUD_PROVIDER: "vultr",
        },
        exampleEnv,
      }),
    ).toBe("aws");
  });

  it("serializes env values over the example template", () => {
    const text = serializeEnvFile(
      {
        FRONTEND_URL: "https://example.com",
        PROVISION_SERVER_TOKEN: "secret",
      },
      [
        "# comment",
        "FRONTEND_URL=http://localhost:30000",
        "PROVISION_SERVER_TOKEN=change-me",
      ],
    );

    expect(text).toContain("# comment");
    expect(text).toContain("FRONTEND_URL=https://example.com");
    expect(text).toContain("PROVISION_SERVER_TOKEN=secret");
  });
});
