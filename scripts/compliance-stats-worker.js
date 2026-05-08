#!/usr/bin/env node

const { loadApiSecret } = require("./script-env.js");

function parseArgs(argv) {
  const args = {
    api: process.env.ANIXOPS_API_URL || "http://127.0.0.1:8787",
    envFile: ".env.selfhosted",
    rentalId: "",
    limit: 100,
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
    } else if (arg === "--rental-id") {
      args.rentalId = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--limit") {
      args.limit = Number(argv[index + 1]);
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
  node scripts/compliance-stats-worker.js [--api http://127.0.0.1:8787] [--env .env.selfhosted] [--rental-id rental-123] [--limit 100] [--json]

Calls the internal compliance stats sync endpoint once. This is cron-friendly.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 500) {
    throw new Error("--limit must be an integer between 1 and 500.");
  }

  const apiSecret = loadApiSecret(args.envFile);
  if (!apiSecret) {
    throw new Error("API_SECRET is required in the environment or env file.");
  }

  const response = await fetch(`${args.api.replace(/\/+$/, "")}/internal/compliance/stats/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Secret": apiSecret,
    },
    body: JSON.stringify({
      rentalId: args.rentalId || null,
      limit: args.limit,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Compliance stats worker failed with HTTP ${response.status}`);
  }

  const result = {
    ok: true,
    synced: body.synced ?? 0,
    skipped: Array.isArray(body.skipped) ? body.skipped.length : 0,
  };
  process.stdout.write(`${args.json ? JSON.stringify(result) : `Compliance stats sync completed: synced=${result.synced}, skipped=${result.skipped}`}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  loadApiSecret,
  parseArgs,
};
