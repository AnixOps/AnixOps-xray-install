#!/usr/bin/env node

const { loadMergedEnv, parseEnvFile } = require("./script-env.js");

function parseArgs(argv) {
  const args = {
    batchId: "",
    api: process.env.ANIXOPS_API_URL || "http://127.0.0.1:8787",
    envFile: ".env.selfhosted",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--api") {
      args.api = argv[i + 1];
      i += 1;
    } else if (arg === "--env-file" || arg === "--env") {
      args.envFile = argv[i + 1];
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (!args.batchId) {
      args.batchId = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function usage() {
  console.log(`Usage:
  node scripts/verify-audit-anchor.js <batch-id> [--api http://127.0.0.1:8787] [--env .env.selfhosted]

Verifies an audit anchor batch through the internal API without printing secret values.`);
}

async function verifyAuditAnchor({
  baseUrl,
  apiSecret,
  batchId,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(`${baseUrl}/internal/audit/anchor/${encodeURIComponent(batchId)}/verify`, {
    headers: { "X-API-Secret": apiSecret },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok !== true) {
    const error = new Error(body.error || "Audit anchor verification failed");
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.batchId) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const fileEnv = loadMergedEnv(args.envFile);
  const apiSecret = process.env.API_SECRET || fileEnv.API_SECRET;
  if (!apiSecret) {
    throw new Error("API_SECRET is required in the environment or env file.");
  }

  const baseUrl = args.api.replace(/\/+$/, "");
  try {
    const body = await verifyAuditAnchor({
      baseUrl,
      apiSecret,
      batchId: args.batchId,
    });
    console.log(JSON.stringify({
      ok: true,
      batchId: body.batchId,
      eventCount: body.eventCount,
      merkleRoot: body.merkleRoot,
      status: body.status,
      chain: body.chain,
      txHash: body.txHash,
    }, null, 2));
  } catch (error) {
    const body = error && typeof error === "object" && "body" in error ? error.body : {};
    console.error(JSON.stringify({
      ok: false,
      status: error && typeof error === "object" && "status" in error ? error.status : 500,
      batchId: args.batchId,
      merkleOk: body.merkleOk,
      hashesOk: body.hashesOk,
      eventCount: body.eventCount,
      expectedEventCount: body.expectedEventCount,
      error: body.error || "Audit anchor verification failed",
    }, null, 2));
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = { parseArgs, parseEnvFile, verifyAuditAnchor };
