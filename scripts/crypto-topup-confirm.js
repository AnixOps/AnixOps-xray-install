#!/usr/bin/env node

const { loadApiSecret } = require("./script-env.js");

function parseArgs(argv) {
  const args = {
    api: process.env.ANIXOPS_API_URL || "http://127.0.0.1:8787",
    envFile: ".env.selfhosted",
    topupId: "",
    txHash: "",
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
    } else if (arg === "--topup-id") {
      args.topupId = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--tx-hash") {
      args.txHash = argv[index + 1] || "";
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
  node scripts/crypto-topup-confirm.js --topup-id <id> --tx-hash <hash> [--api http://127.0.0.1:8787] [--env .env.selfhosted] [--json]

Confirms a crypto topup through the internal API. When EVM testnet config exists on the server, the server verifies the transaction receipt before crediting the wallet.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  if (!args.topupId || !args.txHash) {
    throw new Error("--topup-id and --tx-hash are required.");
  }

  const apiSecret = loadApiSecret(args.envFile);
  if (!apiSecret) {
    throw new Error("API_SECRET is required in the environment or env file.");
  }

  const response = await fetch(`${args.api.replace(/\/+$/, "")}/internal/crypto-topups/${encodeURIComponent(args.topupId)}/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Secret": apiSecret,
    },
    body: JSON.stringify({
      txHash: args.txHash,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Crypto topup confirm failed with HTTP ${response.status}`);
  }

  const result = {
    ok: true,
    topupId: body.topup?.id || args.topupId,
    status: body.topup?.status || null,
    txHash: body.topup?.txHash || args.txHash,
    alreadyProcessed: Boolean(body.alreadyProcessed),
  };
  process.stdout.write(`${args.json ? JSON.stringify(result) : `Confirmed crypto topup ${result.topupId} with status ${result.status}.`}\n`);
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
