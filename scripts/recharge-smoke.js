#!/usr/bin/env node

const { randomBytes } = require("crypto");
const { Contract, JsonRpcProvider, Wallet, parseUnits } = require("ethers");
const { loadApiSecret, loadMergedEnv } = require("./script-env.js");
const { resolveEvmTestnetMeta } = require("./evm-testnet-meta.js");

const VALID_PROTOCOLS = new Set(["vless-reality", "hysteria2"]);
const VALID_DURATIONS = new Set([1, 6, 12, 24]);
const DEFAULT_SMOKE_EMAIL_PREFIX = "recharge-smoke";
const RENEWABLE_RENTAL_STATUSES = new Set(["provisioning", "active", "paused"]);

function parseArgs(argv) {
  const args = {
    api: process.env.ANIXOPS_API_URL || "http://127.0.0.1:8787",
    envFile: ".env.selfhosted",
    email: "",
    amount: 1,
    protocol: "vless-reality",
    durationHours: 1,
    complianceProfileId: "standard",
    confirmationMode: "auto",
    txHash: "",
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
    } else if (arg === "--amount") {
      args.amount = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--protocol") {
      args.protocol = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--duration-hours") {
      args.durationHours = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--compliance-profile-id") {
      args.complianceProfileId = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--confirmation-mode") {
      args.confirmationMode = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--tx-hash") {
      args.txHash = argv[index + 1] || "";
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
  node scripts/recharge-smoke.js [--api http://127.0.0.1:8787] [--env .env.selfhosted] [--email qa@example.com] [--amount 1] [--protocol vless-reality] [--duration-hours 1] [--compliance-profile-id standard] [--confirmation-mode auto|broadcast|synthetic] [--tx-hash 0x...] [--poll-interval-ms 5000] [--rental-timeout-ms 600000] [--json]

Creates a wallet recharge order, confirms it through the internal crypto-topup endpoint, verifies wallet ledger credit, then creates and charges a wallet rental. In testnet mode it will broadcast a tiny ERC20 transfer if the chain keys are configured.`);
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeEmail(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized) ? normalized : "";
}

function normalizeMoney(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : NaN;
}

function normalizeDurationHours(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && VALID_DURATIONS.has(parsed) ? parsed : NaN;
}

function normalizeConfirmationMode(value) {
  const mode = String(value || "auto").trim().toLowerCase();
  return ["auto", "broadcast", "synthetic"].includes(mode) ? mode : "";
}

function buildSyntheticTxHash() {
  return `0x${randomBytes(32).toString("hex")}`;
}

function loadRechargeEnv(envFile, {
  runtimeEnv = {},
  overrides = {},
  cwd = process.cwd(),
} = {}) {
  return {
    ...loadMergedEnv(envFile, { cwd }),
    ...(runtimeEnv || {}),
    ...(overrides || {}),
  };
}

async function defaultRequestJson({ baseUrl, apiSecret, method, path, token, body, fetchImpl = fetch }) {
  const headers = {};
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (apiSecret) {
    headers["X-API-Secret"] = apiSecret;
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetchImpl(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const parsed = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    body: parsed,
  };
}

function assertOk(result, context) {
  if (!result.ok) {
    const error = result.body && typeof result.body.error === "string"
      ? result.body.error
      : `Request failed with HTTP ${result.status}${context ? ` while ${context}` : ""}`;
    throw new Error(error);
  }
  return result.body || {};
}

function hasActiveRental(rentals) {
  return Array.isArray(rentals)
    && rentals.some((rental) => RENEWABLE_RENTAL_STATUSES.has(String(rental?.status || "").toLowerCase()));
}

async function selectSmokeAccount({
  requestJson,
  candidates,
}) {
  const errors = [];
  for (const candidate of candidates) {
    const email = normalizeEmail(candidate);
    if (!email) {
      continue;
    }

    const auth = assertOk(await requestJson({
      method: "POST",
      path: "/api/auth/register",
      body: { email },
    }), "registering smoke account");

    const rentalsResponse = assertOk(await requestJson({
      method: "GET",
      path: "/api/rentals",
      token: auth.token,
    }), "loading rentals for smoke account");
    if (!hasActiveRental(rentalsResponse.rentals)) {
      return {
        email,
        auth,
      };
    }

    errors.push(`${email} already has an active, paused, or provisioning rental`);
  }

  throw new Error(errors.length > 0
    ? `No available smoke account: ${errors.join("; ")}`
    : "No valid smoke account email was provided.");
}

async function confirmTopup({
  requestJson,
  apiSecret,
  topupId,
  txHash,
}) {
  return assertOk(await requestJson({
    method: "POST",
    path: `/internal/crypto-topups/${encodeURIComponent(topupId)}/confirm`,
    apiSecret,
    body: { txHash },
  }), "confirming crypto topup");
}

async function broadcastTopupTransfer({
  env,
  topup,
  requestJson,
}) {
  const chainConfig = topup.chainMode?.chain || {};
  const rpcUrl = String(env.CRYPTO_TOPUP_RPC_URL || "").trim();
  const privateKey = String(env.CRYPTO_TOPUP_SIGNER_PRIVATE_KEY || "").trim();
  const tokenAddress = String(chainConfig.tokenAddress || env.CRYPTO_TOPUP_TOKEN_ADDRESS || "").trim();
  const tokenDecimals = Number.isInteger(Number(env.CRYPTO_TOPUP_TOKEN_DECIMALS))
    ? Number(env.CRYPTO_TOPUP_TOKEN_DECIMALS)
    : 6;
  const receiverAddress = String(topup.topup.address || "").trim();

  if (!rpcUrl || !privateKey || !tokenAddress || !/^0x[0-9a-fA-F]{40}$/.test(receiverAddress)) {
    return null;
  }

  const chain = resolveEvmTestnetMeta(chainConfig.chain || env.CRYPTO_TOPUP_CHAIN || env.AUDIT_ANCHOR_CHAIN || "base-sepolia");
  const provider = new JsonRpcProvider(rpcUrl, {
    chainId: chain.chainId,
    name: chain.networkName,
  });
  const wallet = new Wallet(privateKey, provider);
  const token = new Contract(
    tokenAddress,
    ["function transfer(address to, uint256 value) returns (bool)"],
    wallet,
  );
  const transferAmount = parseUnits(String(topup.topup.expectedAmount), tokenDecimals);
  const tx = await token.transfer(receiverAddress, transferAmount);
  const receipt = await tx.wait(1).catch(() => null);

  return {
    mode: "broadcast",
    txHash: receipt?.hash || tx.hash,
    from: wallet.address,
    to: receiverAddress,
    amount: topup.topup.expectedAmount,
    tokenAddress,
    chain: chain.networkName,
  };
}

async function waitForRentalConfig({
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
      path: `/api/rental/${encodeURIComponent(rentalId)}/config`,
      token,
    });
    if (result.ok) {
      return result.body || {};
    }

    if (result.status !== 202) {
      throw new Error(result.body && typeof result.body.error === "string"
        ? result.body.error
        : `Rental config request failed with HTTP ${result.status}`);
    }

    await sleep(Math.max(1000, pollIntervalMs));
  }

  throw new Error(`Rental ${rentalId} did not become ready within ${timeoutMs}ms`);
}

async function chargeRentalWhenReady({
  requestJson,
  apiSecret,
  rentalId,
  periodStart,
  periodEnd,
  timeoutMs,
  pollIntervalMs,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    const result = await requestJson({
      method: "POST",
      path: `/internal/billing/rentals/${encodeURIComponent(rentalId)}/charge`,
      apiSecret,
      body: {
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
      },
    });

    if (result.ok) {
      return result.body || {};
    }

    const error = result.body && typeof result.body.error === "string"
      ? result.body.error
      : `Rental charge failed with HTTP ${result.status}`;
    if (result.status !== 409 || error !== "Rental is not an active wallet rental") {
      throw new Error(error);
    }

    lastError = new Error(error);
    await sleep(Math.max(1000, pollIntervalMs));
  }

  throw lastError || new Error(`Rental ${rentalId} was not ready for charging within ${timeoutMs}ms`);
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
  }), "destroying smoke rental");
}

function formatBalance(balance) {
  return Number.isFinite(balance) ? Math.round(balance * 100) / 100 : NaN;
}

async function runRechargeSmoke(args, deps = {}) {
  if (!Number.isFinite(args.amount) || args.amount < 1 || args.amount > 10000) {
    throw new Error("--amount must be a number between 1 and 10000.");
  }
  if (!Number.isInteger(args.durationHours) || !VALID_DURATIONS.has(args.durationHours)) {
    throw new Error("--duration-hours must be one of 1, 6, 12, or 24.");
  }
  const confirmationMode = normalizeConfirmationMode(args.confirmationMode);
  if (!confirmationMode) {
    throw new Error("--confirmation-mode must be auto, broadcast, or synthetic.");
  }
  if (!VALID_PROTOCOLS.has(args.protocol)) {
    throw new Error("--protocol must be vless-reality or hysteria2.");
  }
  if (!Number.isInteger(args.pollIntervalMs) || args.pollIntervalMs < 1000 || args.pollIntervalMs > 60000) {
    throw new Error("--poll-interval-ms must be an integer between 1000 and 60000.");
  }
  if (!Number.isInteger(args.rentalTimeoutMs) || args.rentalTimeoutMs < args.pollIntervalMs || args.rentalTimeoutMs > 3600000) {
    throw new Error("--rental-timeout-ms must be an integer between poll interval and 3600000.");
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
  const requestJson = deps.requestJson || ((options) => defaultRequestJson({ baseUrl, apiSecret, ...options, fetchImpl: deps.fetchImpl || fetch }));
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const topupEnv = resolveEvmTestnetMeta(env.CRYPTO_TOPUP_CHAIN || env.AUDIT_ANCHOR_CHAIN || "base-sepolia");
  const whitelistEmails = parseCsv(env.CHAIN_TESTNET_WHITELIST_EMAILS);
  const explicitEmail = normalizeEmail(args.email);
  const candidates = explicitEmail
    ? [explicitEmail]
    : whitelistEmails.length > 0
      ? whitelistEmails
      : [`${DEFAULT_SMOKE_EMAIL_PREFIX}.${Date.now()}@example.com`];

  if (env.CHAIN_ENVIRONMENT === "testnet" && !explicitEmail && whitelistEmails.length === 0) {
    throw new Error("Testnet recharge smoke requires CHAIN_TESTNET_WHITELIST_EMAILS or --email.");
  }
  if (env.CHAIN_ENVIRONMENT === "testnet" && explicitEmail && whitelistEmails.length > 0 && !whitelistEmails.includes(explicitEmail)) {
    throw new Error(`The provided email ${explicitEmail} is not in CHAIN_TESTNET_WHITELIST_EMAILS.`);
  }

  const selected = await selectSmokeAccount({
    requestJson,
    candidates,
  });
  const token = selected.auth.token;

  const walletBefore = assertOk(await requestJson({
    method: "GET",
    path: "/api/wallet",
    token,
  }), "loading wallet summary before recharge");

  const topupRequest = assertOk(await requestJson({
    method: "POST",
    path: "/api/wallet/crypto-topups",
    token,
    body: {
      amount: args.amount,
      rail: "wallet",
    },
  }), "creating crypto topup");

  if (topupRequest.chainMode?.environment === "testnet" && !topupRequest.chainMode.allowlisted) {
    throw new Error("Selected smoke account is not allowlisted for testnet chain features.");
  }

  const topup = topupRequest.topup;
  if (!topup || !topup.id) {
    throw new Error("Crypto topup response was missing the topup payload.");
  }
  if (topup.rail !== "wallet") {
    throw new Error(`Expected wallet rail but received ${topup.rail}.`);
  }

  const topupChainEnabled = Boolean(topupRequest.chainMode?.chain?.cryptoTopupEnabled);
  let confirmation = null;
  let txHash = String(args.txHash || "").trim();

  if (txHash) {
    confirmation = {
      mode: "provided",
      txHash,
    };
  } else if (confirmationMode === "synthetic") {
    txHash = buildSyntheticTxHash();
    confirmation = {
      mode: "synthetic",
      txHash,
    };
  } else if (topupChainEnabled) {
    confirmation = await broadcastTopupTransfer({
      env,
      topup: topupRequest,
      requestJson,
    });
    if (!confirmation) {
      throw new Error("On-chain recharge smoke is configured, but the broadcast prerequisites are missing.");
    } else {
      txHash = confirmation.txHash;
    }
  } else {
    txHash = buildSyntheticTxHash();
    confirmation = {
      mode: "synthetic",
      txHash,
    };
  }

  const confirmedTopup = await confirmTopup({
    requestJson,
    apiSecret,
    topupId: topup.id,
    txHash,
  });

  const walletAfterTopup = assertOk(await requestJson({
    method: "GET",
    path: "/api/wallet",
    token,
  }), "loading wallet summary after recharge");
  const ledgerAfterTopup = assertOk(await requestJson({
    method: "GET",
    path: "/api/wallet/ledger?limit=5",
    token,
  }), "loading wallet ledger after recharge");
  const latestTopupLedger = Array.isArray(ledgerAfterTopup.entries) ? ledgerAfterTopup.entries[0] : null;
  if (!latestTopupLedger || latestTopupLedger.type !== "crypto_topup") {
    throw new Error("Expected the latest wallet ledger entry to be the crypto topup credit.");
  }

  const rentalCheckout = assertOk(await requestJson({
    method: "POST",
    path: "/api/rental",
    token,
    body: {
      protocol: args.protocol,
      durationHours: args.durationHours,
      paymentMethod: "wallet",
      complianceProfileId: args.complianceProfileId,
    },
  }), "creating wallet rental");

  if (!rentalCheckout.rentalId) {
    throw new Error("Rental checkout did not return a rentalId.");
  }

  const rentalConfig = await waitForRentalConfig({
    requestJson,
    token,
    rentalId: rentalCheckout.rentalId,
    timeoutMs: args.rentalTimeoutMs,
    pollIntervalMs: args.pollIntervalMs,
    sleep,
  });
  if (!rentalConfig || typeof rentalConfig !== "object") {
    throw new Error("Rental config was not returned after provisioning.");
  }

  const chargeEnd = deps.now ? deps.now() : new Date();
  const chargeStart = new Date(chargeEnd.getTime() - args.durationHours * 60 * 60 * 1000);
  const charge = await chargeRentalWhenReady({
    requestJson,
    apiSecret,
    rentalId: rentalCheckout.rentalId,
    periodStart: chargeStart,
    periodEnd: chargeEnd,
    timeoutMs: args.rentalTimeoutMs,
    pollIntervalMs: args.pollIntervalMs,
    sleep,
  });

  const walletAfterCharge = assertOk(await requestJson({
    method: "GET",
    path: "/api/wallet",
    token,
  }), "loading wallet summary after billing charge");
  const ledgerAfterCharge = assertOk(await requestJson({
    method: "GET",
    path: "/api/wallet/ledger?limit=5",
    token,
  }), "loading wallet ledger after billing charge");
  const latestChargeLedger = Array.isArray(ledgerAfterCharge.entries) ? ledgerAfterCharge.entries[0] : null;
  if (!latestChargeLedger || latestChargeLedger.type !== "billing_charge") {
    throw new Error("Expected the latest wallet ledger entry to be the billing charge debit.");
  }

  const amount = normalizeMoney(topup.fiatAmount || topup.amount);
  const chargedAmount = normalizeMoney(charge.amount);
  const expectedAfterTopup = formatBalance(formatBalance(Number(walletBefore.balance || 0)) + amount);
  const expectedAfterCharge = formatBalance(expectedAfterTopup - chargedAmount);

  if (Math.abs(formatBalance(Number(walletAfterTopup.balance || 0)) - expectedAfterTopup) > 0.01) {
    throw new Error(`Wallet balance after topup was ${walletAfterTopup.balance}, expected ${expectedAfterTopup}.`);
  }
  if (Math.abs(formatBalance(Number(walletAfterCharge.balance || 0)) - expectedAfterCharge) > 0.01) {
    throw new Error(`Wallet balance after charge was ${walletAfterCharge.balance}, expected ${expectedAfterCharge}.`);
  }

  const cleanup = await destroyRental({
    requestJson,
    apiSecret,
    rentalId: rentalCheckout.rentalId,
  });

  return {
    ok: true,
    email: selected.email,
    chain: topupEnv.networkName,
    topup: {
      id: topup.id,
      txHash: confirmedTopup.topup?.txHash || txHash,
      expectedAmount: topup.expectedAmount,
      fiatAmount: amount,
      confirmationMode: confirmation?.mode || confirmationMode,
      broadcast: confirmation && confirmation.mode === "broadcast" ? confirmation : null,
    },
    wallet: {
      before: formatBalance(Number(walletBefore.balance || 0)),
      afterTopup: formatBalance(Number(walletAfterTopup.balance || 0)),
      afterCharge: formatBalance(Number(walletAfterCharge.balance || 0)),
    },
    rental: {
      id: rentalCheckout.rentalId,
      status: rentalCheckout.status || null,
      configReady: true,
      chargeAmount: chargedAmount,
    },
    cleanup: {
      rentalId: rentalCheckout.rentalId,
      status: cleanup.status || "destroyed",
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const result = await runRechargeSmoke(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  process.stdout.write(`Recharge smoke completed for ${result.email}\n`);
  process.stdout.write(`Topup ${result.topup.id} confirmed with ${result.topup.confirmationMode} confirmation.\n`);
  process.stdout.write(`Wallet balance ${result.wallet.before} -> ${result.wallet.afterTopup} -> ${result.wallet.afterCharge}\n`);
  process.stdout.write(`Rental ${result.rental.id} charged ${result.rental.chargeAmount}\n`);
  process.stdout.write(`Cleanup destroyed rental ${result.cleanup.rentalId}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  assertOk,
  buildSyntheticTxHash,
  confirmTopup,
  defaultRequestJson,
  hasActiveRental,
  normalizeConfirmationMode,
  normalizeDurationHours,
  normalizeEmail,
  normalizeMoney,
  parseArgs,
  parseCsv,
  loadRechargeEnv,
  runRechargeSmoke,
  selectSmokeAccount,
  waitForRentalConfig,
};
