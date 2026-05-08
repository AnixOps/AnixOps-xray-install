#!/usr/bin/env node

let Wallet;
let resolveEvmTestnetMeta;
try {
  ({ Wallet } = require("ethers"));
  ({ resolveEvmTestnetMeta } = require("./evm-testnet-meta.js"));
} catch (error) {
  if (error && typeof error === "object" && error.code === "MODULE_NOT_FOUND") {
    console.error("Missing dependency: ethers");
    console.error("Run this script from the AnixOps project root after installing dependencies:");
    console.error("  npm install");
    console.error("  node scripts/generate-testnet-wallets.js --whitelist-emails <email>");
    process.exit(1);
  }
  throw error;
}

function parseArgs(argv) {
  const args = {
    chain: "base-sepolia",
    whitelistEmails: "",
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--chain") {
      args.chain = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--whitelist-emails") {
      args.whitelistEmails = argv[index + 1] || "";
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
  node scripts/generate-testnet-wallets.js [--chain base-sepolia|polygon-amoy] [--whitelist-emails qa1@example.com,qa2@example.com] [--json]

Generates a topup wallet and an anchor wallet for testnet use and prints an env snippet for .env.selfhosted.`);
}

function buildWalletEnvSnippet(input) {
  const whitelist = String(input.whitelistEmails || "").trim();
  const meta = resolveEvmTestnetMeta(input.chain);
  const asset = String(input.asset || "USDT").trim().toUpperCase() || "USDT";
  const confirmationsRequired = String(input.confirmationsRequired || "12").trim() || "12";
  const rpcUrl = String(input.rpcUrl || meta.rpcUrl).trim() || meta.rpcUrl;
  const tokenAddress = String(input.tokenAddress || "<fill-after-mock-usdt-deploy>").trim() || "<fill-after-mock-usdt-deploy>";
  const tokenDecimals = String(input.tokenDecimals || "6").trim() || "6";
  const anchorTargetAddress = String(input.anchorTargetAddress || input.anchor.address).trim() || input.anchor.address;
  return [
    "CHAIN_ENVIRONMENT=testnet",
    `CHAIN_TESTNET_WHITELIST_EMAILS=${whitelist}`,
    "",
    `CRYPTO_TOPUP_CHAIN=${meta.chain}`,
    `CRYPTO_TOPUP_ASSET=${asset}`,
    `CRYPTO_TOPUP_CONFIRMATIONS_REQUIRED=${confirmationsRequired}`,
    `CRYPTO_TOPUP_RPC_URL=${rpcUrl}`,
    `CRYPTO_TOPUP_SIGNER_PRIVATE_KEY=${input.topup.privateKey}`,
    `CRYPTO_TOPUP_RECEIVER_ADDRESS=${input.topup.address}`,
    `CRYPTO_TOPUP_TOKEN_ADDRESS=${tokenAddress}`,
    `CRYPTO_TOPUP_TOKEN_DECIMALS=${tokenDecimals}`,
    "",
    `AUDIT_ANCHOR_CHAIN=${meta.chain}`,
    `AUDIT_ANCHOR_RPC_URL=${rpcUrl}`,
    `AUDIT_ANCHOR_SIGNER_PRIVATE_KEY=${input.anchor.privateKey}`,
    `AUDIT_ANCHOR_TARGET_ADDRESS=${anchorTargetAddress}`,
    "AUDIT_ANCHOR_MIN_NATIVE_BALANCE=0",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const topup = Wallet.createRandom();
  const anchor = Wallet.createRandom();
  const meta = resolveEvmTestnetMeta(args.chain);
  const payload = {
    chain: meta.networkName,
    topup: {
      address: topup.address,
      privateKey: topup.privateKey,
      mnemonic: topup.mnemonic?.phrase || null,
    },
    anchor: {
      address: anchor.address,
      privateKey: anchor.privateKey,
      mnemonic: anchor.mnemonic?.phrase || null,
    },
    envSnippet: buildWalletEnvSnippet({
      chain: meta.networkName,
      whitelistEmails: args.whitelistEmails,
      topup,
      anchor,
    }),
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return;
  }

  process.stdout.write(`Generated test wallets for ${payload.chain}\n`);
  process.stdout.write(`Topup wallet: ${payload.topup.address}\n`);
  process.stdout.write(`Anchor wallet: ${payload.anchor.address}\n\n`);
  process.stdout.write("Env snippet:\n");
  process.stdout.write(`${payload.envSnippet}\n`);
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
  buildWalletEnvSnippet,
  parseArgs,
};
