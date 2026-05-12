import { z } from "zod";

const MIN_PRODUCTION_SECRET_LENGTH = 32;

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.string().default("8787"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  CHAIN_ENVIRONMENT: z.enum(["testnet", "mainnet"]).default("testnet"),
  CHAIN_TESTNET_WHITELIST_EMAILS: z.string().optional(),
  CRYPTO_TOPUP_CHAIN: z.string().optional(),
  CRYPTO_TOPUP_ASSET: z.string().optional(),
  CRYPTO_TOPUP_CONFIRMATIONS_REQUIRED: z.string().optional(),
  CRYPTO_TOPUP_RPC_URL: z.string().optional(),
  CRYPTO_TOPUP_SIGNER_PRIVATE_KEY: z.string().optional(),
  CRYPTO_TOPUP_RECEIVER_ADDRESS: z.string().optional(),
  CRYPTO_TOPUP_TOKEN_ADDRESS: z.string().optional(),
  CRYPTO_TOPUP_TOKEN_DECIMALS: z.string().optional(),
  AUDIT_ANCHOR_CHAIN: z.string().optional(),
  AUDIT_ANCHOR_RPC_URL: z.string().optional(),
  AUDIT_ANCHOR_SIGNER_PRIVATE_KEY: z.string().optional(),
  AUDIT_ANCHOR_TARGET_ADDRESS: z.string().optional(),
  AUDIT_ANCHOR_MIN_NATIVE_BALANCE: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  NEXT_PUBLIC_RELEASE_PROFILE: z.string().optional(),
  PROVISION_SERVER_URL: z.string().default("http://localhost:3001"),
  PROVISION_SERVER_TOKEN: z.string().default("dev-token"),
  API_SECRET: z.string().default("dev-secret"),
  FRONTEND_URL: z.string().default("http://localhost:30000"),
  ALLOWED_ORIGINS: z.string().optional(),
  ADMIN_EMAILS: z.string().optional(),
  NOTIFICATION_WEBHOOK_URL: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.string().optional(),
  SMTP_FROM: z.string().optional(),
});

export type ServerEnv = z.infer<typeof envSchema> & {
  allowedOrigins: string[];
  chainWhitelistEmails: string[];
};

export function parseCsv(value: string | undefined): string[] {
  return Array.from(
    new Set(
      (value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export function parseAllowedOrigins(frontendUrl: string, allowedOrigins?: string): string[] {
  const explicitOrigins = parseCsv(allowedOrigins);
  return explicitOrigins.length > 0 ? explicitOrigins : parseCsv(frontendUrl);
}

function isWeakProductionSecret(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length < MIN_PRODUCTION_SECRET_LENGTH ||
    normalized === "dev-token" ||
    normalized === "dev-secret" ||
    normalized.startsWith("change-me") ||
    normalized.startsWith("changeme")
  );
}

function collectProductionConfigIssues(parsed: z.infer<typeof envSchema>): string[] {
  if (parsed.NODE_ENV !== "production") {
    return [];
  }

  const issues: string[] = [];
  if (isWeakProductionSecret(parsed.PROVISION_SERVER_TOKEN)) {
    issues.push(`PROVISION_SERVER_TOKEN must be at least ${MIN_PRODUCTION_SECRET_LENGTH} random characters`);
  }
  if (isWeakProductionSecret(parsed.API_SECRET)) {
    issues.push(`API_SECRET must be at least ${MIN_PRODUCTION_SECRET_LENGTH} random characters`);
  }
  if (parsed.REDIS_URL.includes("change-me") || parsed.REDIS_URL.includes("anixops-redis-change-me")) {
    issues.push("REDIS_URL must not use a bundled default Redis password");
  }
  return issues;
}

export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const parsed = envSchema.parse(source);
  const productionIssues = collectProductionConfigIssues(parsed);

  if (productionIssues.length > 0) {
    throw new Error(`Unsafe production configuration: ${productionIssues.join("; ")}`);
  }

  return {
    ...parsed,
    allowedOrigins: parseAllowedOrigins(parsed.FRONTEND_URL, parsed.ALLOWED_ORIGINS),
    chainWhitelistEmails: Array.from(new Set(
      parseCsv(parsed.CHAIN_TESTNET_WHITELIST_EMAILS).map((email) => email.toLowerCase()),
    )),
  };
}
