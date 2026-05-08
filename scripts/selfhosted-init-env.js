#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseEnvFile, validateProvisionEnv, isPlaceholder } = require("./provision-env-check.js");
const { readLocalCredentialOverrides } = require("./local-secret-files.js");

const DEFAULT_OUTPUT = ".env.selfhosted";
const EXAMPLE_FILE = ".env.selfhosted.example";
const SECRET_LENGTHS = {
  PROVISION_SERVER_TOKEN: 48,
  API_SECRET: 48,
  POSTGRES_PASSWORD: 24,
  REDIS_PASSWORD: 24,
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

function normalizeProvider(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["vultr", "digitalocean", "aws"].includes(normalized) ? normalized : "";
}

function hasValue(value) {
  return String(value || "").trim().length > 0 && !isPlaceholder(value);
}

function hasProviderCredential(source, provider) {
  const normalized = normalizeProvider(provider);
  if (normalized === "vultr") {
    return hasValue(source.VULTR_API_KEY);
  }
  if (normalized === "digitalocean") {
    return hasValue(source.DIGITALOCEAN_TOKEN) || hasValue(source.DO_API_TOKEN);
  }
  if (normalized === "aws") {
    return hasValue(source.AWS_ACCESS_KEY_ID)
      && hasValue(source.AWS_SECRET_ACCESS_KEY)
      && hasValue(source.AWS_SECURITY_GROUP_ID);
  }
  return false;
}

function inferProviderFromCredentials(source = {}) {
  const matches = ["vultr", "digitalocean", "aws"].filter((provider) => hasProviderCredential(source, provider));
  return matches.length === 1 ? matches[0] : "";
}

function chooseProvider({ options = {}, existingEnv = {}, exampleEnv = {} }) {
  const requestedProvider = normalizeProvider(options.provider);
  if (requestedProvider) {
    return requestedProvider;
  }

  const existingProvider = normalizeProvider(existingEnv.CLOUD_PROVIDER);
  const localCredentialProvider = inferProviderFromCredentials(options.localCredentials || {});

  if (existingProvider) {
    const existingHasOwnCredential = hasProviderCredential(existingEnv, existingProvider);
    const mergedHasCredential = hasProviderCredential(
      {
        ...existingEnv,
        ...(options.localCredentials || {}),
      },
      existingProvider,
    );

    if (existingHasOwnCredential || mergedHasCredential || !localCredentialProvider || localCredentialProvider === existingProvider) {
      return existingProvider;
    }

    return localCredentialProvider;
  }

  return localCredentialProvider || normalizeProvider(exampleEnv.CLOUD_PROVIDER) || "vultr";
}

function parseArgs(argv) {
  const args = {
    out: DEFAULT_OUTPUT,
    provider: "",
    frontendUrl: "",
    allowedOrigins: "",
    adminEmail: "",
    vultrApiKey: "",
    digitaloceanToken: "",
    awsAccessKeyId: "",
    awsSecretAccessKey: "",
    awsRegion: "",
    awsSecurityGroupId: "",
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      args.out = argv[i + 1];
      i += 1;
    } else if (arg === "--provider") {
      args.provider = argv[i + 1];
      i += 1;
    } else if (arg === "--frontend-url") {
      args.frontendUrl = argv[i + 1];
      i += 1;
    } else if (arg === "--allowed-origins") {
      args.allowedOrigins = argv[i + 1];
      i += 1;
    } else if (arg === "--admin-email") {
      args.adminEmail = argv[i + 1];
      i += 1;
    } else if (arg === "--vultr-api-key") {
      args.vultrApiKey = argv[i + 1];
      i += 1;
    } else if (arg === "--digitalocean-token") {
      args.digitaloceanToken = argv[i + 1];
      i += 1;
    } else if (arg === "--aws-access-key-id") {
      args.awsAccessKeyId = argv[i + 1];
      i += 1;
    } else if (arg === "--aws-secret-access-key") {
      args.awsSecretAccessKey = argv[i + 1];
      i += 1;
    } else if (arg === "--aws-region") {
      args.awsRegion = argv[i + 1];
      i += 1;
    } else if (arg === "--aws-security-group-id") {
      args.awsSecurityGroupId = argv[i + 1];
      i += 1;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
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
  node scripts/selfhosted-init-env.js [--out .env.selfhosted] [--provider vultr|digitalocean|aws] [--frontend-url http://localhost:30000] [--allowed-origins http://localhost:30000] [--admin-email you@example.com] [--vultr-api-key <token>] [--digitalocean-token <token>] [--aws-access-key-id <id>] [--aws-secret-access-key <secret>] [--aws-region <region>] [--aws-security-group-id <sg>] [--dry-run]

Generates a local self-hosted env file with strong random secrets, while leaving cloud-provider credentials blank for manual fill-in.`);
}

function generateSecureValue(length) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString("hex").slice(0, length);
}

function serializeEnvFile(entries, exampleLines) {
  const lines = exampleLines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      return line;
    }
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    const value = Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : line.slice(index + 1);
    return `${key}=${value}`;
  });

  for (const [key, value] of Object.entries(entries)) {
    if (!lines.some((line) => line.startsWith(`${key}=`))) {
      lines.push(`${key}=${value}`);
    }
  }

  return `${lines.join("\n").replace(/\r?\n/g, "\n")}\n`;
}

function buildInitializedEnv({ exampleEnv, existingEnv = {}, options = {} }) {
  const provider = chooseProvider({ options, existingEnv, exampleEnv });
  const providerOverride = Boolean(normalizeProvider(options.provider));
  const previousProvider = normalizeProvider(existingEnv.CLOUD_PROVIDER) || normalizeProvider(exampleEnv.CLOUD_PROVIDER) || "vultr";
  const env = {
    ...exampleEnv,
    ...existingEnv,
    ...(options.localCredentials || {}),
    CLOUD_PROVIDER: provider,
  };
  const generatedKeys = [];
  const providerDefaults = PROVIDER_DEFAULTS[provider] || {};
  const previousDefaults = PROVIDER_DEFAULTS[previousProvider] || {};
  const providerChanged = previousProvider !== provider;

  if (!env.DIGITALOCEAN_TOKEN && env.DO_API_TOKEN) {
    env.DIGITALOCEAN_TOKEN = env.DO_API_TOKEN;
  }

  for (const [key, length] of Object.entries(SECRET_LENGTHS)) {
    if (isPlaceholder(env[key])) {
      env[key] = generateSecureValue(length);
      generatedKeys.push(key);
    }
  }

  if (options.frontendUrl) {
    env.FRONTEND_URL = options.frontendUrl;
  } else if (!env.FRONTEND_URL || isPlaceholder(env.FRONTEND_URL)) {
    env.FRONTEND_URL = exampleEnv.FRONTEND_URL || "http://localhost:30000";
  }

  if (options.allowedOrigins) {
    env.ALLOWED_ORIGINS = options.allowedOrigins;
  } else if (!env.ALLOWED_ORIGINS || isPlaceholder(env.ALLOWED_ORIGINS)) {
    env.ALLOWED_ORIGINS = env.FRONTEND_URL;
  }

  if (options.adminEmail) {
    env.ADMIN_EMAILS = options.adminEmail;
  } else if (typeof env.ADMIN_EMAILS !== "string") {
    env.ADMIN_EMAILS = "";
  }

  if (options.vultrApiKey || process.env.VULTR_API_KEY) {
    env.VULTR_API_KEY = options.vultrApiKey || process.env.VULTR_API_KEY;
  }
  if (options.digitaloceanToken || process.env.DIGITALOCEAN_TOKEN || process.env.DO_API_TOKEN) {
    env.DIGITALOCEAN_TOKEN = options.digitaloceanToken || process.env.DIGITALOCEAN_TOKEN || process.env.DO_API_TOKEN;
  }
  if (options.awsAccessKeyId || process.env.AWS_ACCESS_KEY_ID) {
    env.AWS_ACCESS_KEY_ID = options.awsAccessKeyId || process.env.AWS_ACCESS_KEY_ID;
  }
  if (options.awsSecretAccessKey || process.env.AWS_SECRET_ACCESS_KEY) {
    env.AWS_SECRET_ACCESS_KEY = options.awsSecretAccessKey || process.env.AWS_SECRET_ACCESS_KEY;
  }
  if (options.awsRegion || process.env.AWS_REGION) {
    env.AWS_REGION = options.awsRegion || process.env.AWS_REGION;
  }
  if (options.awsSecurityGroupId || process.env.AWS_SECURITY_GROUP_ID) {
    env.AWS_SECURITY_GROUP_ID = options.awsSecurityGroupId || process.env.AWS_SECURITY_GROUP_ID;
  }

  for (const [key, value] of Object.entries(providerDefaults)) {
    const baselineValue = Object.prototype.hasOwnProperty.call(existingEnv, key)
      ? String(existingEnv[key] || "")
      : String(exampleEnv[key] || "");
    const shouldReplacePreviousDefault =
      providerChanged
      && Object.prototype.hasOwnProperty.call(previousDefaults, key)
      && baselineValue === String(previousDefaults[key]);

    if (
      shouldReplacePreviousDefault
      || (
      (providerOverride && (!existingEnv[key] || isPlaceholder(existingEnv[key])))
      || !env[key]
      || isPlaceholder(env[key])
      )
    ) {
      env[key] = value;
    }
  }

  if (!("NEXT_PUBLIC_WORKER_URL" in env)) {
    env.NEXT_PUBLIC_WORKER_URL = "";
  }
  if (!("API_PROXY_TIMEOUT_MS" in env)) {
    env.API_PROXY_TIMEOUT_MS = "15000";
  }
  if (!("SMTP_SECURE" in env)) {
    env.SMTP_SECURE = "true";
  }

  return {
    env,
    generatedKeys,
    validation: validateProvisionEnv(env),
  };
}

function printSummary({ out, provider, generatedKeys, validation, dryRun }) {
  console.log(`Self-hosted env ${dryRun ? "plan" : "initialized"}`);
  console.log(`target=${out}`);
  console.log(`provider=${provider}`);
  console.log(`generated=${generatedKeys.length ? generatedKeys.join(", ") : "none"}`);
  if (validation.issues.length === 0) {
    console.log("status=ready");
  } else {
    console.log("status=partial");
    console.log("remaining_blockers:");
    validation.issues.forEach((issue) => console.log(`- ${issue}`));
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const cwd = process.cwd();
  const examplePath = path.resolve(cwd, EXAMPLE_FILE);
  if (!fs.existsSync(examplePath)) {
    throw new Error(`Example env file not found: ${EXAMPLE_FILE}`);
  }

  const outPath = path.resolve(cwd, args.out);
  const exampleText = fs.readFileSync(examplePath, "utf8");
  const exampleLines = exampleText.split(/\r?\n/);
  const exampleEnv = parseEnvFile(exampleText);
  const existingEnv = fs.existsSync(outPath) ? parseEnvFile(fs.readFileSync(outPath, "utf8")) : {};

  const result = buildInitializedEnv({
    exampleEnv,
    existingEnv,
    options: {
      localCredentials: readLocalCredentialOverrides({ cwd }),
      provider: args.provider,
      frontendUrl: args.frontendUrl,
      allowedOrigins: args.allowedOrigins,
      adminEmail: args.adminEmail,
      vultrApiKey: args.vultrApiKey,
      digitaloceanToken: args.digitaloceanToken,
      awsAccessKeyId: args.awsAccessKeyId,
      awsSecretAccessKey: args.awsSecretAccessKey,
      awsRegion: args.awsRegion,
      awsSecurityGroupId: args.awsSecurityGroupId,
    },
  });

  if (!args.dryRun) {
    const content = serializeEnvFile(result.env, exampleLines);
    fs.writeFileSync(outPath, content, "utf8");
  }

  printSummary({
    out: args.out,
    provider: result.env.CLOUD_PROVIDER,
    generatedKeys: result.generatedKeys,
    validation: result.validation,
    dryRun: args.dryRun,
  });
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
  buildInitializedEnv,
  chooseProvider,
  generateSecureValue,
  inferProviderFromCredentials,
  parseArgs,
  serializeEnvFile,
};
