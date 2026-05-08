#!/usr/bin/env node

const { loadApiSecret } = require("./script-env.js");

function parseArgs(argv) {
  const args = {
    api: process.env.ANIXOPS_API_URL || "http://127.0.0.1:8787",
    envFile: ".env.selfhosted",
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
  node scripts/billing-tick-worker.js [--api http://127.0.0.1:8787] [--env .env.selfhosted] [--json]

Calls the internal billing tick endpoint once. This is cron-friendly.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const apiSecret = loadApiSecret(args.envFile);
  if (!apiSecret) {
    throw new Error("API_SECRET is required in the environment or env file.");
  }

  const response = await fetch(`${args.api.replace(/\/+$/, "")}/internal/billing/tick`, {
    method: "POST",
    headers: {
      "X-API-Secret": apiSecret,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Billing tick worker failed with HTTP ${response.status}`);
  }

  const result = {
    ok: true,
    scanned: body.scanned ?? null,
    charged: body.charged ?? null,
    destroyed: body.destroyed ?? null,
    skipped: body.skipped ?? null,
  };
  process.stdout.write(`${args.json ? JSON.stringify(result) : `Billing tick completed: scanned=${result.scanned}, charged=${result.charged}, destroyed=${result.destroyed}, skipped=${result.skipped}`}\n`);
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
