#!/usr/bin/env node

const { randomBytes } = require("crypto");
const {
  assertOk,
  defaultRequestJson,
  loadRechargeEnv,
  normalizeEmail,
  selectSmokeAccount,
  waitForRentalConfig,
} = require("./recharge-smoke.js");
const { loadApiSecret } = require("./script-env.js");

const VALID_DURATIONS = new Set([1, 6, 8, 12, 16, 24, 48, 72]);

function parseArgs(argv) {
  const args = {
    api: process.env.ANIXOPS_API_URL || "http://127.0.0.1:8787",
    envFile: ".env.selfhosted",
    email: "",
    durationHours: 1,
    walletAmount: 10,
    protocol: "vless-reality",
    complianceProfileId: "standard",
    pollIntervalMs: 5000,
    rentalTimeoutMs: 600000,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--api") {
      args.api = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--env-file" || arg === "--env") {
      args.envFile = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--email") {
      args.email = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--duration-hours") {
      args.durationHours = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--wallet-amount") {
      args.walletAmount = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--protocol") {
      args.protocol = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--compliance-profile-id") {
      args.complianceProfileId = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--poll-interval-ms") {
      args.pollIntervalMs = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--rental-timeout-ms") {
      args.rentalTimeoutMs = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--json") {
      args.json = true;
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
  node scripts/redeem-smoke.js [--api http://127.0.0.1:8787] [--env .env.selfhosted] [--email qa@example.com] [--duration-hours 1|6|8|12|16|24|48|72] [--wallet-amount 10] [--protocol vless-reality|hysteria2] [--compliance-profile-id standard] [--poll-interval-ms 5000] [--rental-timeout-ms 600000] [--json]

Generates one duration CDK and one wallet CDK, redeems both, verifies the duration code produces a rental subscription, then verifies the wallet code credits the wallet ledger.`);
}

function normalizeDurationHours(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && VALID_DURATIONS.has(parsed) ? parsed : NaN;
}

function normalizeAmount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : NaN;
}

function formatMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function waitForSubscriptionLink({
  requestJson,
  token,
  rentalId,
  timeoutMs,
  pollIntervalMs,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await requestJson({
      method: "GET",
      path: `/api/rental/${encodeURIComponent(rentalId)}/subscription?format=universal`,
      token,
    });

    if (result.ok) {
      const subscription = result.body?.subscription;
      if (typeof subscription === "string" && subscription.length > 0) {
        return subscription;
      }
      throw new Error(result.body?.error || `Rental ${rentalId} returned an empty subscription payload.`);
    }

    if (result.status !== 202 && result.status !== 404 && result.status !== 409) {
      throw new Error(result.body?.error || `Rental subscription request failed with HTTP ${result.status}`);
    }

    await sleep(Math.max(1000, pollIntervalMs));
  }

  throw new Error(`Rental ${rentalId} did not expose a subscription link within ${timeoutMs}ms`);
}

async function destroyRental({
  requestJson,
  apiSecret,
  rentalId,
}) {
  return assertOk(await requestJson({
    method: "POST",
    path: `/api/admin/rentals/${encodeURIComponent(rentalId)}/destroy`,
    apiSecret,
  }), "destroying redeem rental");
}

async function createRedeemBatch({
  requestJson,
  apiSecret,
  body,
}) {
  return assertOk(await requestJson({
    method: "POST",
    path: "/api/admin/redeem-codes",
    apiSecret,
    body,
  }), "creating redeem code batch");
}

async function runRedeemSmoke(args, deps = {}) {
  const durationHours = normalizeDurationHours(args.durationHours);
  if (!durationHours) {
    throw new Error("--duration-hours must be one of 1, 6, 8, 12, 16, 24, 48, or 72.");
  }
  const walletAmount = normalizeAmount(args.walletAmount);
  if (!walletAmount || walletAmount < 0.01 || walletAmount > 10000) {
    throw new Error("--wallet-amount must be a number between 0.01 and 10000.");
  }
  if (!Number.isInteger(args.pollIntervalMs) || args.pollIntervalMs < 1000 || args.pollIntervalMs > 60000) {
    throw new Error("--poll-interval-ms must be an integer between 1000 and 60000.");
  }
  if (!Number.isInteger(args.rentalTimeoutMs) || args.rentalTimeoutMs < args.pollIntervalMs || args.rentalTimeoutMs > 3600000) {
    throw new Error("--rental-timeout-ms must be an integer between poll interval and 3600000.");
  }
  if (!["vless-reality", "hysteria2"].includes(args.protocol)) {
    throw new Error("--protocol must be vless-reality or hysteria2.");
  }

  const env = deps.env || loadRechargeEnv(args.envFile, {
    runtimeEnv: deps.runtimeEnv !== undefined ? deps.runtimeEnv : process.env,
    cwd: deps.cwd,
  });
  const apiSecret = deps.apiSecret || loadApiSecret(args.envFile);
  if (!apiSecret) {
    throw new Error("API_SECRET is required in the environment or env file.");
  }

  const baseUrl = args.api.replace(/\/+$/, "");
  const requestJson = deps.requestJson || ((options) => defaultRequestJson({
    baseUrl,
    apiSecret,
    ...options,
    fetchImpl: deps.fetchImpl || fetch,
  }));
  const webBaseUrl = String(deps.webBaseUrl || env.FRONTEND_URL || process.env.FRONTEND_URL || "http://web:30000")
    .trim()
    .replace(/\/+$/, "");
  const webRequestJson = deps.webRequestJson
    || (deps.requestJson
      ? deps.requestJson
      : ((options) => defaultRequestJson({
        baseUrl: webBaseUrl,
        apiSecret,
        ...options,
        fetchImpl: deps.fetchImpl || fetch,
      })));
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const candidateEmail = normalizeEmail(args.email) || `redeem-smoke.${Date.now()}.${randomBytes(3).toString("hex")}@example.com`;

  const selected = await selectSmokeAccount({
    requestJson,
    candidates: [candidateEmail],
  });
  const token = selected.auth.token;

  const durationBatch = await createRedeemBatch({
    requestJson,
    apiSecret,
    body: {
      count: 1,
      codeType: "duration",
      durationHours,
    },
  });
  const durationCode = durationBatch.codes?.[0]?.code;
  if (!durationCode) {
    throw new Error("Duration redeem code batch was missing the generated code.");
  }

  const durationValidation = assertOk(await requestJson({
    method: "POST",
    path: "/api/redeem/validate",
    body: { code: durationCode },
  }), "validating duration redeem code");
  if (durationValidation.codeType !== "duration") {
    throw new Error(`Expected a duration code but received ${durationValidation.codeType || "unknown"}.`);
  }

  const durationRedeem = assertOk(await requestJson({
    method: "POST",
    path: "/api/redeem",
    token,
    body: {
      code: durationCode,
      protocol: args.protocol,
      complianceProfileId: args.complianceProfileId,
    },
  }), "redeeming duration code");
  if (!durationRedeem.rentalId) {
    throw new Error("Duration redemption did not return a rentalId.");
  }

  const subscription = await waitForSubscriptionLink({
    requestJson: webRequestJson,
    token,
    rentalId: durationRedeem.rentalId,
    timeoutMs: args.rentalTimeoutMs,
    pollIntervalMs: args.pollIntervalMs,
    sleep,
  });
  const rentalConfig = await waitForRentalConfig({
    requestJson,
    token,
    rentalId: durationRedeem.rentalId,
    timeoutMs: args.rentalTimeoutMs,
    pollIntervalMs: args.pollIntervalMs,
    sleep,
  });
  const destroyResult = await destroyRental({
    requestJson,
    apiSecret,
    rentalId: durationRedeem.rentalId,
  });

  const walletBefore = assertOk(await requestJson({
    method: "GET",
    path: "/api/wallet",
    token,
  }), "loading wallet before wallet CDK redemption");

  const walletBatch = await createRedeemBatch({
    requestJson,
    apiSecret,
    body: {
      count: 1,
      codeType: "wallet",
      walletAmount,
    },
  });
  const walletCode = walletBatch.codes?.[0]?.code;
  if (!walletCode) {
    throw new Error("Wallet redeem code batch was missing the generated code.");
  }

  const walletValidation = assertOk(await requestJson({
    method: "POST",
    path: "/api/redeem/validate",
    body: { code: walletCode },
  }), "validating wallet redeem code");
  if (walletValidation.codeType !== "wallet") {
    throw new Error(`Expected a wallet code but received ${walletValidation.codeType || "unknown"}.`);
  }

  const walletRedeem = assertOk(await requestJson({
    method: "POST",
    path: "/api/wallet/redeem",
    token,
    body: { code: walletCode },
  }), "redeeming wallet code");
  if (walletRedeem.codeType !== "wallet") {
    throw new Error(`Expected wallet redemption but received ${walletRedeem.codeType || "unknown"}.`);
  }

  const walletAfter = assertOk(await requestJson({
    method: "GET",
    path: "/api/wallet",
    token,
  }), "loading wallet after wallet CDK redemption");
  const ledgerAfter = assertOk(await requestJson({
    method: "GET",
    path: "/api/wallet/ledger?limit=5",
    token,
  }), "loading wallet ledger after wallet CDK redemption");

  const latestLedger = Array.isArray(ledgerAfter.entries) ? ledgerAfter.entries[0] : null;
  if (!latestLedger || latestLedger.type !== "redeem_code_credit") {
    throw new Error("Expected the latest wallet ledger entry to be the redeem code credit.");
  }

  const expectedAfter = formatMoney(Number(walletBefore.balance || 0) + walletAmount);
  const actualAfter = formatMoney(Number(walletAfter.balance || 0));
  if (Math.abs(actualAfter - expectedAfter) > 0.01) {
    throw new Error(`Wallet balance after redeem was ${walletAfter.balance}, expected ${expectedAfter}.`);
  }

  return {
    ok: true,
    email: selected.email,
    duration: {
      code: durationCode,
      rentalId: durationRedeem.rentalId,
      status: durationRedeem.status || null,
      subscriptionReady: Boolean(subscription),
      configReady: Boolean(rentalConfig),
      destroyStatus: destroyResult.status || "destroyed",
    },
    wallet: {
      code: walletCode,
      amount: walletAmount,
      balanceBefore: formatMoney(Number(walletBefore.balance || 0)),
      balanceAfter: actualAfter,
    },
    env: {
      chainEnvironment: env.CHAIN_ENVIRONMENT || "unknown",
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const result = await runRedeemSmoke(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  process.stdout.write(`Redeem smoke completed for ${result.email}\n`);
  process.stdout.write(`Duration code ${result.duration.code} created rental ${result.duration.rentalId}\n`);
  process.stdout.write(`Wallet code ${result.wallet.code} credited ${result.wallet.amount}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  destroyRental,
  normalizeAmount,
  normalizeDurationHours,
  parseArgs,
  runRedeemSmoke,
  usage,
  waitForSubscriptionLink,
};
