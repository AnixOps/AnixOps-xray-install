#!/usr/bin/env node

const { sendAlertWebhook } = require("./alert-webhook.js");
const { loadApiSecret, loadMergedEnv } = require("./script-env.js");

function parseArgs(argv) {
  const args = {
    api: process.env.ANIXOPS_API_URL || "http://127.0.0.1:8787",
    envFile: ".env.selfhosted",
    limit: 100,
    lookbackBlocks: 10000,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--api") {
      args.api = argv[index + 1];
      index += 1;
    } else if (arg === "--env-file" || arg === "--env") {
      args.envFile = argv[index + 1];
      index += 1;
    } else if (arg === "--limit") {
      args.limit = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--lookback-blocks") {
      args.lookbackBlocks = Number(argv[index + 1]);
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
  node scripts/crypto-topup-worker.js [--api http://127.0.0.1:8787] [--env .env.selfhosted] [--limit 100] [--lookback-blocks 10000] [--json]

Scans pending crypto topups for auto-confirmable EVM testnet transfers, then confirms the matched topups through the internal API. This is cron-friendly.`);
}

async function postJson(url, apiSecret, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Secret": apiSecret,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with HTTP ${response.status}`);
  }
  return payload;
}

function buildCryptoTopupAlert(result, args = {}) {
  if (!result || Number(result.ambiguous || 0) < 1) {
    return null;
  }

  return {
    source: "crypto-topup-worker",
    level: "warn",
    title: "Crypto topup auto-confirm requires operator review",
    detail: "The EVM scan worker found ambiguous matches and skipped automatic crediting.",
    facts: [
      { label: "api", value: args.api || "http://127.0.0.1:8787" },
      { label: "ambiguous", value: result.ambiguous },
      { label: "pendingTopups", value: result.pendingTopups ?? 0 },
      { label: "observedTransfers", value: result.observedTransfers ?? 0 },
      { label: "matched", value: result.matched ?? 0 },
      { label: "confirmed", value: result.confirmed ?? 0 },
    ],
  };
}

async function runWorker(args, dependencies = {}) {
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 1000) {
    throw new Error("--limit must be an integer between 1 and 1000.");
  }
  if (!Number.isInteger(args.lookbackBlocks) || args.lookbackBlocks < 1 || args.lookbackBlocks > 250000) {
    throw new Error("--lookback-blocks must be an integer between 1 and 250000.");
  }

  const apiSecret = dependencies.apiSecret || loadApiSecret(args.envFile);
  const env = dependencies.env || loadMergedEnv(args.envFile);
  const post = dependencies.postJson || postJson;
  const sendAlert = dependencies.sendAlertWebhook || sendAlertWebhook;
  if (!apiSecret) {
    throw new Error("API_SECRET is required in the environment or env file.");
  }

  const baseUrl = args.api.replace(/\/+$/, "");
  const alertWebhookUrl = process.env.CRYPTO_ALERT_WEBHOOK_URL || env.CRYPTO_ALERT_WEBHOOK_URL || "";
  try {
    const scan = await post(`${baseUrl}/internal/crypto-topups/scan`, apiSecret, {
      limit: args.limit,
      lookbackBlocks: args.lookbackBlocks,
    });
  
    const confirmed = [];
    for (const match of Array.isArray(scan.matches) ? scan.matches : []) {
      const payload = await post(`${baseUrl}/internal/crypto-topups/${encodeURIComponent(match.topupId)}/confirm`, apiSecret, {
        txHash: match.txHash,
      });
      confirmed.push({
        topupId: payload.topup?.id || match.topupId,
        txHash: payload.topup?.txHash || match.txHash,
        status: payload.topup?.status || null,
        alreadyProcessed: Boolean(payload.alreadyProcessed),
      });
    }
  
    const result = {
      ok: true,
      skipped: Boolean(scan.skipped),
      reason: scan.reason || null,
      pendingTopups: scan.pendingTopups ?? 0,
      observedTransfers: scan.observedTransfers ?? 0,
      ambiguous: scan.ambiguous ?? 0,
      matched: Array.isArray(scan.matches) ? scan.matches.length : 0,
      confirmed: confirmed.length,
      confirmations: confirmed,
    };
  
    const alertPayload = buildCryptoTopupAlert(result, { ...args, api: baseUrl });
    if (alertPayload) {
      await sendAlert(alertWebhookUrl, alertPayload).catch(() => false);
    }
 
    return result;
  } catch (error) {
    await sendAlert(alertWebhookUrl, {
      source: "crypto-topup-worker",
      level: "error",
      title: "Crypto topup worker failed",
      detail: error instanceof Error ? error.message : String(error),
      facts: [
        { label: "api", value: baseUrl },
        { label: "limit", value: args.limit },
        { label: "lookbackBlocks", value: args.lookbackBlocks },
      ],
    }).catch(() => {});
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const result = await runWorker(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  process.stdout.write(`Crypto topup worker completed: matched=${result.matched}, confirmed=${result.confirmed}, ambiguous=${result.ambiguous}, pending=${result.pendingTopups}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  buildCryptoTopupAlert,
  loadApiSecret,
  parseArgs,
  runWorker,
};
