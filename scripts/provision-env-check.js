#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { readLocalCredentialOverrides } = require("./local-secret-files.js");

const PROVIDER_REQUIREMENTS = {
  vultr: ["VULTR_API_KEY", "VPS_REGION", "VPS_PLAN"],
  digitalocean: ["DIGITALOCEAN_TOKEN", "VPS_REGION", "VPS_PLAN"],
  aws: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "AWS_SECURITY_GROUP_ID", "VPS_REGION", "VPS_PLAN"],
};

const PROVIDER_DEFAULTS = {
  vultr: {
    VPS_REGION: "nrt",
    VPS_PLAN: "vhf-1c-1gb",
  },
  digitalocean: {
    VPS_REGION: "sgp1",
    VPS_PLAN: "s-1vcpu-1gb",
  },
  aws: {
    VPS_REGION: "ap-northeast-1",
    VPS_PLAN: "t3.micro",
    AWS_REGION: "ap-northeast-1",
  },
};

const COMMON_REQUIREMENTS = [
  "PROVISION_SERVER_TOKEN",
  "API_SECRET",
  "POSTGRES_PASSWORD",
  "REDIS_PASSWORD",
  "FRONTEND_URL",
  "ALLOWED_ORIGINS",
];

const CHAIN_OPTIONAL_KEYS = [
  "CHAIN_TESTNET_WHITELIST_EMAILS",
  "CRYPTO_TOPUP_CHAIN",
  "CRYPTO_TOPUP_ASSET",
  "CRYPTO_TOPUP_CONFIRMATIONS_REQUIRED",
  "CRYPTO_TOPUP_RPC_URL",
  "CRYPTO_TOPUP_SIGNER_PRIVATE_KEY",
  "CRYPTO_TOPUP_RECEIVER_ADDRESS",
  "CRYPTO_TOPUP_TOKEN_ADDRESS",
  "CRYPTO_TOPUP_TOKEN_DECIMALS",
  "AUDIT_ANCHOR_CHAIN",
  "AUDIT_ANCHOR_RPC_URL",
  "AUDIT_ANCHOR_SIGNER_PRIVATE_KEY",
  "AUDIT_ANCHOR_TARGET_ADDRESS",
  "AUDIT_ANCHOR_MIN_NATIVE_BALANCE",
  "CRYPTO_ALERT_WEBHOOK_URL",
  "AUDIT_ANCHOR_ALERT_WEBHOOK_URL",
];

const CRYPTO_CHAIN_REQUIRED_KEYS = [
  "CRYPTO_TOPUP_CHAIN",
  "CRYPTO_TOPUP_ASSET",
  "CRYPTO_TOPUP_CONFIRMATIONS_REQUIRED",
  "CRYPTO_TOPUP_RPC_URL",
  "CRYPTO_TOPUP_RECEIVER_ADDRESS",
  "CRYPTO_TOPUP_TOKEN_ADDRESS",
  "CRYPTO_TOPUP_TOKEN_DECIMALS",
];

const AUDIT_ANCHOR_REQUIRED_KEYS = [
  "AUDIT_ANCHOR_CHAIN",
  "AUDIT_ANCHOR_RPC_URL",
  "AUDIT_ANCHOR_SIGNER_PRIVATE_KEY",
  "AUDIT_ANCHOR_TARGET_ADDRESS",
];

const SECRET_MIN_LENGTHS = {
  PROVISION_SERVER_TOKEN: 32,
  API_SECRET: 32,
  POSTGRES_PASSWORD: 16,
  REDIS_PASSWORD: 16,
};

function hasProviderCredential(source, provider) {
  if (provider === "vultr") {
    return !isPlaceholder(source.VULTR_API_KEY);
  }
  if (provider === "digitalocean") {
    return !isPlaceholder(source.DIGITALOCEAN_TOKEN || source.DO_API_TOKEN);
  }
  if (provider === "aws") {
    return !isPlaceholder(source.AWS_ACCESS_KEY_ID)
      && !isPlaceholder(source.AWS_SECRET_ACCESS_KEY)
      && !isPlaceholder(source.AWS_SECURITY_GROUP_ID);
  }
  return false;
}

function inferConfiguredProvider(source) {
  const matches = Object.keys(PROVIDER_REQUIREMENTS).filter((provider) => hasProviderCredential(source, provider));
  return matches.length === 1 ? matches[0] : "";
}

function applyLegacyProviderAliases(source) {
  const env = { ...source };
  if (!env.DIGITALOCEAN_TOKEN && env.DO_API_TOKEN) {
    env.DIGITALOCEAN_TOKEN = env.DO_API_TOKEN;
  }
  return env;
}

function normalizeHexPrivateKey(value) {
  const raw = String(value || "").trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(raw)) return raw;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return `0x${raw}`;
  return "";
}

function normalizeAddress(value) {
  const raw = String(value || "").trim();
  return /^0x[0-9a-fA-F]{40}$/.test(raw) ? raw : "";
}

function parseEnvFile(content) {
  const env = {};
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const index = trimmed.indexOf("=");
    if (index === -1) return;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (!quoted) {
      value = value.replace(/^#.*$/, "").replace(/\s+#.*$/, "").trim();
    }
    value = value.replace(/^['"]|['"]$/g, "");
    env[key] = value;
  });
  return env;
}

function isPlaceholder(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return (
    normalized === "" ||
    normalized.startsWith("change-me") ||
    normalized.startsWith("your-") ||
    normalized.endsWith("_")
  );
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function parseAllowedOrigins(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getCryptoChainMissingKeys(env) {
  return [
    isPlaceholder(env.CRYPTO_TOPUP_CHAIN) ? "CRYPTO_TOPUP_CHAIN" : null,
    isPlaceholder(env.CRYPTO_TOPUP_ASSET) ? "CRYPTO_TOPUP_ASSET" : null,
    isPlaceholder(env.CRYPTO_TOPUP_CONFIRMATIONS_REQUIRED) ? "CRYPTO_TOPUP_CONFIRMATIONS_REQUIRED" : null,
    isPlaceholder(env.CRYPTO_TOPUP_RPC_URL) ? "CRYPTO_TOPUP_RPC_URL" : null,
    normalizeAddress(env.CRYPTO_TOPUP_RECEIVER_ADDRESS) || normalizeHexPrivateKey(env.CRYPTO_TOPUP_SIGNER_PRIVATE_KEY)
      ? null
      : "CRYPTO_TOPUP_RECEIVER_ADDRESS",
    normalizeAddress(env.CRYPTO_TOPUP_TOKEN_ADDRESS) ? null : "CRYPTO_TOPUP_TOKEN_ADDRESS",
    isPlaceholder(env.CRYPTO_TOPUP_TOKEN_DECIMALS) ? "CRYPTO_TOPUP_TOKEN_DECIMALS" : null,
  ].filter(Boolean);
}

function getAuditAnchorMissingKeys(env) {
  return [
    isPlaceholder(env.AUDIT_ANCHOR_CHAIN) ? "AUDIT_ANCHOR_CHAIN" : null,
    isPlaceholder(env.AUDIT_ANCHOR_RPC_URL) ? "AUDIT_ANCHOR_RPC_URL" : null,
    normalizeHexPrivateKey(env.AUDIT_ANCHOR_SIGNER_PRIVATE_KEY) ? null : "AUDIT_ANCHOR_SIGNER_PRIVATE_KEY",
    normalizeAddress(env.AUDIT_ANCHOR_TARGET_ADDRESS) ? null : "AUDIT_ANCHOR_TARGET_ADDRESS",
  ].filter(Boolean);
}

function summarizeProvisionEnv(env) {
  const normalizedEnv = applyLegacyProviderAliases(env);
  const provider = (normalizedEnv.CLOUD_PROVIDER || "vultr").toLowerCase();
  const requiredKeys = [...COMMON_REQUIREMENTS, ...(PROVIDER_REQUIREMENTS[provider] || [])];
  const keys = Array.from(
    new Set([
      ...COMMON_REQUIREMENTS,
      "ADMIN_EMAILS",
      "CLOUD_PROVIDER",
      "CHAIN_ENVIRONMENT",
      "FRONTEND_URL",
      "ALLOWED_ORIGINS",
      "AWS_REGION",
      ...CHAIN_OPTIONAL_KEYS,
      ...Object.keys(PROVIDER_REQUIREMENTS).flatMap((key) => PROVIDER_REQUIREMENTS[key]),
    ]),
  );

  const entries = {};
  for (const key of keys) {
    const value = String(normalizedEnv[key] || "");
    entries[key] = {
      present: value.length > 0,
      placeholder: isPlaceholder(value),
      length: value.length,
      required: requiredKeys.includes(key) || key === "CLOUD_PROVIDER",
    };
  }

  return {
    provider,
    entries,
    chain: summarizeChainEnv(normalizedEnv),
  };
}

function summarizeChainEnv(env) {
  const chainEnvironment = String(env.CHAIN_ENVIRONMENT || "testnet").trim().toLowerCase() === "mainnet"
    ? "mainnet"
    : "testnet";
  const cryptoMissingKeys = getCryptoChainMissingKeys(env);
  const anchorMissingKeys = getAuditAnchorMissingKeys(env);
  const cryptoReady = cryptoMissingKeys.length === 0;
  const cryptoAny = CHAIN_OPTIONAL_KEYS.some((key) => !isPlaceholder(env[key]))
    || normalizeAddress(env.CRYPTO_TOPUP_RECEIVER_ADDRESS).length > 0
    || normalizeHexPrivateKey(env.CRYPTO_TOPUP_SIGNER_PRIVATE_KEY).length > 0;
  const anchorReady = anchorMissingKeys.length === 0;
  const anchorAny = AUDIT_ANCHOR_REQUIRED_KEYS.some((key) => !isPlaceholder(env[key]))
    || normalizeAddress(env.AUDIT_ANCHOR_TARGET_ADDRESS).length > 0;
  const whitelistConfigured = !isPlaceholder(env.CHAIN_TESTNET_WHITELIST_EMAILS);
  const chainAny = whitelistConfigured || cryptoAny || anchorAny || !isPlaceholder(env.CRYPTO_TOPUP_CHAIN) || !isPlaceholder(env.AUDIT_ANCHOR_CHAIN);

  return {
    enabled: chainAny,
    environment: chainEnvironment,
    whitelistConfigured,
    cryptoTopup: cryptoReady ? "ready" : cryptoAny ? "partial" : "disabled",
    cryptoTopupMissingKeys: cryptoMissingKeys,
    auditAnchor: anchorReady ? "ready" : anchorAny ? "partial" : "disabled",
    auditAnchorMissingKeys: anchorMissingKeys,
  };
}

function validateProvisionEnv(env, { allowPlaceholders = false } = {}) {
  const normalizedEnv = applyLegacyProviderAliases(env);
  const provider = (normalizedEnv.CLOUD_PROVIDER || "vultr").toLowerCase();
  const providerRequirements = PROVIDER_REQUIREMENTS[provider];
  const issues = [];

  if (!providerRequirements) {
    issues.push(`Unsupported CLOUD_PROVIDER: ${provider}`);
    return { provider, issues };
  }

  for (const key of [...COMMON_REQUIREMENTS, ...providerRequirements]) {
    if (!(key in normalizedEnv)) {
      issues.push(`Missing ${key}`);
      continue;
    }
    if (!allowPlaceholders && isPlaceholder(normalizedEnv[key])) {
      issues.push(`${key} is empty or placeholder`);
    }
  }

  if (allowPlaceholders) {
    return { provider, issues };
  }

  const chainSummary = summarizeChainEnv(normalizedEnv);
  const cryptoMissing = getCryptoChainMissingKeys(normalizedEnv);
  const anchorMissing = getAuditAnchorMissingKeys(normalizedEnv);
  const inferredProvider = inferConfiguredProvider(normalizedEnv);

  if (chainSummary.enabled && chainSummary.cryptoTopup === "partial") {
    issues.push(`Crypto chain config is partial; missing ${cryptoMissing.join(", ")}`);
  }
  if (chainSummary.enabled && chainSummary.auditAnchor === "partial") {
    issues.push(`Audit anchor config is partial; missing ${anchorMissing.join(", ")}`);
  }
  if (chainSummary.enabled && chainSummary.environment === "testnet" && !chainSummary.whitelistConfigured) {
    issues.push("CHAIN_TESTNET_WHITELIST_EMAILS should be configured when CHAIN_ENVIRONMENT=testnet");
  }

  if (
    inferredProvider
    && inferredProvider !== provider
    && !hasProviderCredential(normalizedEnv, provider)
  ) {
    issues.push(
      `CLOUD_PROVIDER is ${provider} but detected configured credentials for ${inferredProvider}; switch CLOUD_PROVIDER or fill the ${provider} credential`,
    );
  }

  const defaults = PROVIDER_DEFAULTS[provider] || {};
  for (const [key, defaultValue] of Object.entries(defaults)) {
    const value = String(normalizedEnv[key] || "");
    if (isPlaceholder(value)) {
      continue;
    }
    if (key === "VPS_REGION" || key === "VPS_PLAN" || key === "AWS_REGION") {
      if (!value) {
        issues.push(`${key} is required for provider ${provider}`);
      }
    }
    if (provider !== "vultr" && key === "VPS_PLAN" && value === PROVIDER_DEFAULTS.vultr.VPS_PLAN) {
      issues.push(`VPS_PLAN looks like a Vultr slug but CLOUD_PROVIDER is ${provider}`);
    }
    if (provider !== "vultr" && key === "VPS_REGION" && value === PROVIDER_DEFAULTS.vultr.VPS_REGION) {
      issues.push(`VPS_REGION looks like a Vultr region but CLOUD_PROVIDER is ${provider}`);
    }
  }

  for (const [key, minLength] of Object.entries(SECRET_MIN_LENGTHS)) {
    const value = String(normalizedEnv[key] || "");
    if (!isPlaceholder(value) && value.length < minLength) {
      issues.push(`${key} must be at least ${minLength} characters`);
    }
  }

  if (!isPlaceholder(normalizedEnv.FRONTEND_URL) && !isValidHttpUrl(normalizedEnv.FRONTEND_URL)) {
    issues.push("FRONTEND_URL must be a valid http(s) URL");
  }

  if (!isPlaceholder(normalizedEnv.ALLOWED_ORIGINS)) {
    const origins = parseAllowedOrigins(normalizedEnv.ALLOWED_ORIGINS);
    if (origins.length === 0) {
      issues.push("ALLOWED_ORIGINS must contain at least one origin");
    } else {
      for (const origin of origins) {
        if (!isValidHttpUrl(origin)) {
          issues.push(`ALLOWED_ORIGINS contains an invalid origin: ${origin}`);
        }
      }
      if (
        isValidHttpUrl(normalizedEnv.FRONTEND_URL) &&
        !origins.includes(new URL(normalizedEnv.FRONTEND_URL).origin) &&
        !origins.includes(normalizedEnv.FRONTEND_URL)
      ) {
        issues.push("ALLOWED_ORIGINS should include FRONTEND_URL");
      }
    }
  }

  if (provider === "aws") {
    const sg = String(normalizedEnv.AWS_SECURITY_GROUP_ID || "");
    if (!isPlaceholder(sg) && !/^sg-[a-z0-9]+$/i.test(sg)) {
      issues.push("AWS_SECURITY_GROUP_ID must look like sg-xxxxxxxx");
    }
    if (
      !isPlaceholder(normalizedEnv.AWS_REGION) &&
      !isPlaceholder(normalizedEnv.VPS_REGION) &&
      String(normalizedEnv.AWS_REGION).trim() !== String(normalizedEnv.VPS_REGION).trim()
    ) {
      issues.push("AWS_REGION should match VPS_REGION for AWS provisioning");
    }
  }

  return { provider, issues };
}

function readArgs(argv) {
  const args = { file: ".env.selfhosted", allowPlaceholders: false, summary: false, localOverrides: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--file") {
      args.file = argv[i + 1];
      i += 1;
    } else if (arg === "--allow-placeholders") {
      args.allowPlaceholders = true;
    } else if (arg === "--no-local-overrides") {
      args.localOverrides = false;
    } else if (arg === "--summary") {
      args.summary = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function usage() {
  console.log(`Usage:
  node scripts/provision-env-check.js [--file .env.selfhosted] [--allow-placeholders] [--no-local-overrides] [--summary]

Checks self-hosted/provision env shape without printing secret values.`);
}

function printSummary(summary) {
  console.log(`Provision env summary for provider: ${summary.provider}`);
  for (const [key, meta] of Object.entries(summary.entries)) {
    console.log(
      `${key}: required=${meta.required} present=${meta.present} placeholder=${meta.placeholder} length=${meta.length}`,
    );
  }
}

function loadProvisionEnv(file, { cwd = process.cwd(), localOverrides = true } = {}) {
  const resolved = path.resolve(cwd, file);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Env file not found: ${file}`);
  }

  const env = parseEnvFile(fs.readFileSync(resolved, "utf8"));
  if (!localOverrides) {
    return env;
  }

  return {
    ...env,
    ...readLocalCredentialOverrides({ cwd }),
  };
}

function main() {
  const args = readArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const env = loadProvisionEnv(args.file, { cwd: process.cwd(), localOverrides: args.localOverrides });
  const result = validateProvisionEnv(env, { allowPlaceholders: args.allowPlaceholders });
  if (args.summary) {
    printSummary(summarizeProvisionEnv(env));
  }
  if (result.issues.length > 0) {
    console.error(`Provision env check failed for provider: ${result.provider}`);
    result.issues.forEach((issue) => console.error(`- ${issue}`));
    process.exit(1);
  }
  console.log(`Provision env check passed for provider: ${result.provider}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  isPlaceholder,
  loadProvisionEnv,
  parseAllowedOrigins,
  parseEnvFile,
  readArgs,
  summarizeProvisionEnv,
  validateProvisionEnv,
};
