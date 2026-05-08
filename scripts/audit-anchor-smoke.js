#!/usr/bin/env node

const { randomBytes } = require("crypto");
const {
  getJson,
  loadApiSecret,
  loadMergedEnv,
  requestJson,
  runWorker,
} = require("./audit-anchor-worker.js");
const { verifyAuditAnchor } = require("./verify-audit-anchor.js");

const AUDIT_MUTATION_PATH = "/api/admin/compliance/profiles";
const AUDIT_MUTATION_PROFILE_ID = "audit-anchor-smoke";
const VALID_CONFIRMATION_MODES = new Set(["auto", "manual", "synthetic"]);

function parseArgs(argv) {
  const args = {
    api: process.env.ANIXOPS_API_URL || "http://127.0.0.1:8787",
    envFile: ".env.selfhosted",
    limit: 1000,
    chain: "",
    txHash: "",
    provider: "",
    region: "",
    plan: "",
    confirmationMode: "synthetic",
    finalizeAttempts: 3,
    finalizeRetryDelayMs: 1000,
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
    } else if (arg === "--limit") {
      args.limit = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--chain") {
      args.chain = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--tx-hash") {
      args.txHash = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--provider") {
      args.provider = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--region") {
      args.region = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--plan") {
      args.plan = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--confirmation-mode") {
      args.confirmationMode = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--finalize-attempts") {
      args.finalizeAttempts = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--finalize-retry-delay-ms") {
      args.finalizeRetryDelayMs = Number(argv[index + 1]);
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
  node scripts/audit-anchor-smoke.js [--api http://127.0.0.1:8787] [--env .env.selfhosted] [--limit 1000] [--chain base-sepolia|polygon-amoy] [--tx-hash 0xabc] [--provider vultr] [--region iad] [--plan starter] [--confirmation-mode synthetic|auto|manual] [--finalize-attempts 3] [--finalize-retry-delay-ms 1000] [--json]

Triggers a low-impact admin POST by upserting a stable compliance profile, anchors the resulting audit events, and verifies the batch through the verify endpoint. Use --confirmation-mode synthetic for a closed-loop smoke without chain keys, or --confirmation-mode auto when anchor RPC/signing is configured.`);
}

function normalizeConfirmationMode(value) {
  const mode = String(value || "synthetic").trim().toLowerCase();
  return VALID_CONFIRMATION_MODES.has(mode) ? mode : "";
}

function normalizeHexTxHash(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^0x[0-9a-fA-F]{64}$/.test(raw)) return raw;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return `0x${raw}`;
  return "";
}

function buildSyntheticTxHash() {
  return `0x${randomBytes(32).toString("hex")}`;
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

async function ensureNoPendingAuditAnchorBatch({
  baseUrl,
  apiSecret,
  getJsonImpl = getJson,
}) {
  const pendingResult = await getJsonImpl(`${baseUrl}/internal/audit/anchor/pending`, apiSecret);
  if (pendingResult.ok && pendingResult.body?.batch) {
    throw new Error(`Pending audit anchor batch ${pendingResult.body.batch.id} already exists. Anchor it before running the smoke.`);
  }
  if (pendingResult.status !== 404 || pendingResult.body?.error !== "No pending audit anchor batches") {
    throw new Error(pendingResult.body?.error || `Audit anchor pending lookup failed with HTTP ${pendingResult.status}`);
  }
}

function buildWorkerArgs(args, confirmationMode) {
  const workerArgs = {
    api: args.api,
    envFile: args.envFile,
    limit: args.limit,
    chain: args.chain || "",
    txHash: "",
    finalizeAttempts: args.finalizeAttempts,
    finalizeRetryDelayMs: args.finalizeRetryDelayMs,
    json: false,
  };

  const rawTxHash = String(args.txHash || "").trim();
  const providedTxHash = normalizeHexTxHash(rawTxHash);

  if (confirmationMode === "auto") {
    if (rawTxHash) {
      throw new Error("--tx-hash cannot be combined with --confirmation-mode auto.");
    }
    return workerArgs;
  }

  if (rawTxHash && !providedTxHash) {
    throw new Error("--tx-hash must be a 32-byte hex string.");
  }
  if (confirmationMode === "manual" && !providedTxHash) {
    throw new Error("--confirmation-mode manual requires --tx-hash 0x...");
  }

  workerArgs.txHash = providedTxHash || buildSyntheticTxHash();
  return workerArgs;
}

async function runAuditAnchorSmoke(args, dependencies = {}) {
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 10000) {
    throw new Error("--limit must be an integer between 1 and 10000.");
  }
  if (!Number.isInteger(args.finalizeAttempts) || args.finalizeAttempts < 1 || args.finalizeAttempts > 10) {
    throw new Error("--finalize-attempts must be an integer between 1 and 10.");
  }
  if (!Number.isInteger(args.finalizeRetryDelayMs) || args.finalizeRetryDelayMs < 0 || args.finalizeRetryDelayMs > 60000) {
    throw new Error("--finalize-retry-delay-ms must be an integer between 0 and 60000.");
  }

  const confirmationMode = normalizeConfirmationMode(args.confirmationMode);
  if (!confirmationMode) {
    throw new Error("--confirmation-mode must be synthetic, auto, or manual.");
  }

  const env = dependencies.env || loadMergedEnv(args.envFile, {
    runtimeEnv: dependencies.runtimeEnv !== undefined ? dependencies.runtimeEnv : process.env,
    cwd: dependencies.cwd,
  });
  const apiSecret = dependencies.apiSecret || loadApiSecret(args.envFile);
  if (!apiSecret) {
    throw new Error("API_SECRET is required in the environment or env file.");
  }

  const baseUrl = args.api.replace(/\/+$/, "");
  const request = dependencies.requestJson || requestJson;
  const get = dependencies.getJson || getJson;
  const worker = dependencies.runWorker || runWorker;
  const verify = dependencies.verifyAuditAnchor || verifyAuditAnchor;
  const sleep = dependencies.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const triggerBody = {};
  triggerBody.id = AUDIT_MUTATION_PROFILE_ID;
  triggerBody.name = "Audit Anchor Smoke";
  triggerBody.mode = "standard";
  triggerBody.version = "audit-anchor-smoke.v1";
  triggerBody.description = "Idempotent smoke profile used to generate anchorable admin audit events.";
  triggerBody.allowedPorts = [80, 443];
  triggerBody.allowedCidrs = ["0.0.0.0/0"];
  triggerBody.blockedProtocols = [];
  triggerBody.isDefault = false;

  await ensureNoPendingAuditAnchorBatch({
    baseUrl,
    apiSecret,
    getJsonImpl: get,
  });

  const mutationResponse = await request(`${baseUrl}${AUDIT_MUTATION_PATH}`, apiSecret, triggerBody);
  const mutation = assertOk(mutationResponse, "triggering admin audit mutation");
  const workerArgs = buildWorkerArgs(args, confirmationMode);
  const workerResult = await worker(workerArgs, {
    apiSecret,
    env,
    requestJson: request,
    getJson: get,
    sleep,
    sendAlertWebhook: dependencies.sendAlertWebhook,
    broadcastEvmAnchorTransaction: dependencies.broadcastEvmAnchorTransaction,
    sendEvmAnchorTransaction: dependencies.sendEvmAnchorTransaction,
    loadAnchorTransactionReceipt: dependencies.loadAnchorTransactionReceipt,
  });

  if (workerResult.skipped) {
    throw new Error(workerResult.reason || "Audit anchor worker skipped after the admin mutation.");
  }
  if (!workerResult.batchId) {
    throw new Error("Audit anchor worker did not return a batch id.");
  }

  const verification = await verify({
    baseUrl,
    apiSecret,
    batchId: workerResult.batchId,
    fetchImpl: dependencies.fetchImpl || fetch,
  });

  return {
    ok: true,
    confirmationMode,
    mutation: {
      path: AUDIT_MUTATION_PATH,
      status: mutationResponse.status,
      profileId: mutation.profile?.id || null,
      mode: mutation.profile?.mode || null,
      version: mutation.profile?.version || null,
    },
    worker: workerResult,
    verification,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const result = await runAuditAnchorSmoke(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  process.stdout.write(`Audit anchor smoke anchored batch ${result.worker.batchId} with ${result.worker.eventCount} events.\n`);
  process.stdout.write(`Verification passed for batch ${result.verification.batchId} (${result.verification.merkleRoot}).\n`);
  process.stdout.write(`Admin mutation ${result.mutation.path} returned ${result.mutation.status}.\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  AUDIT_MUTATION_PATH,
  assertOk,
  buildSyntheticTxHash,
  buildWorkerArgs,
  ensureNoPendingAuditAnchorBatch,
  normalizeConfirmationMode,
  normalizeHexTxHash,
  parseArgs,
  runAuditAnchorSmoke,
};
