#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

let Wallet;
let resolveEvmTestnetMeta;
let buildWalletEnvSnippet;
let deployMockUsdt;
let normalizePrivateKey;
let parseLocalEnv;
let parseEnvFile;
let serializeEnvFile;
try {
  ({ Wallet } = require("ethers"));
  ({ resolveEvmTestnetMeta } = require("./evm-testnet-meta.js"));
  ({ buildWalletEnvSnippet } = require("./generate-testnet-wallets.js"));
  ({ deployMockUsdt, normalizePrivateKey, parseLocalEnv } = require("./deploy-mock-usdt.js"));
  ({ parseEnvFile } = require("./provision-env-check.js"));
  ({ serializeEnvFile } = require("./selfhosted-init-env.js"));
} catch (error) {
  if (error && typeof error === "object" && error.code === "MODULE_NOT_FOUND") {
    console.error("Missing dependency for EVM testnet bootstrap.");
    console.error("Run this script from the AnixOps project root after installing dependencies:");
    console.error("  npm install");
    process.exit(1);
  }
  throw error;
}

const DEFAULT_EXAMPLE_FILE = ".env.selfhosted.example";

function parseArgs(argv) {
  const args = {
    chain: "base-sepolia",
    whitelistEmails: "",
    envFile: ".env.selfhosted",
    writeEnv: false,
    topupPrivateKey: "",
    anchorPrivateKey: "",
    deployMockUsdt: false,
    deployerPrivateKey: "",
    rpcUrl: "",
    mockAmount: "100000",
    gasLimit: "",
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
    } else if (arg === "--env-file" || arg === "--env") {
      args.envFile = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--write-env") {
      args.writeEnv = true;
    } else if (arg === "--topup-private-key") {
      args.topupPrivateKey = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--anchor-private-key") {
      args.anchorPrivateKey = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--deploy-mock-usdt") {
      args.deployMockUsdt = true;
    } else if (arg === "--deployer-private-key") {
      args.deployerPrivateKey = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--rpc-url") {
      args.rpcUrl = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--mock-amount") {
      args.mockAmount = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--gas-limit") {
      args.gasLimit = argv[index + 1] || "";
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
  node scripts/bootstrap-evm-testnet.js [--chain base-sepolia|polygon-amoy] [--whitelist-emails qa1@example.com,qa2@example.com] [--env .env.selfhosted] [--write-env] [--topup-private-key 0x...] [--anchor-private-key 0x...] [--deploy-mock-usdt] [--deployer-private-key 0x...] [--rpc-url <rpc>] [--mock-amount 100000] [--gas-limit 1500000] [--json]

Generates or reuses testnet wallets, optionally deploys MockUSDT, and prints a ready-to-paste self-hosted env snippet.`);
}

function buildWalletRecord(privateKey) {
  const normalized = normalizePrivateKey(privateKey);
  const wallet = normalized ? new Wallet(normalized) : Wallet.createRandom();
  return {
    wallet,
    generated: !normalized,
    address: wallet.address,
    privateKey: wallet.privateKey,
    mnemonic: wallet.mnemonic?.phrase || null,
  };
}

function serializeWalletRecord(record) {
  return {
    generated: Boolean(record.generated),
    address: record.address,
    privateKey: record.privateKey,
    mnemonic: record.mnemonic,
  };
}

function writeBootstrapEnvFile(input) {
  const envPath = path.resolve(process.cwd(), input.envFile || ".env.selfhosted");
  const examplePath = path.resolve(process.cwd(), input.exampleFile || DEFAULT_EXAMPLE_FILE);
  const templateText = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, "utf8")
    : fs.readFileSync(examplePath, "utf8");
  const templateLines = templateText.split(/\r?\n/);
  const envEntries = parseEnvFile(input.envSnippet);
  const content = serializeEnvFile(envEntries, templateLines);
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, content, "utf8");
  return envPath;
}

function buildNextSteps(input) {
  const steps = [];
  if (input.topup.generated || input.anchor.generated) {
    steps.push("Back up the generated test wallet private keys or mnemonics before funding them.");
  }
  if (!input.mockUsdt) {
    steps.push(`Fund ${input.topup.address} and ${input.anchor.address} with ${input.meta.gasSymbol || "test gas"} on ${input.meta.networkName}.`);
    steps.push(`Run node scripts/bootstrap-evm-testnet.js --chain ${input.meta.networkName} --whitelist-emails <qa-email> --topup-private-key <topup-private-key> --anchor-private-key <anchor-private-key> --deploy-mock-usdt --deployer-private-key <funded-key> --json to fill the token address automatically.`);
  } else {
    steps.push(input.writeEnv
      ? "Review the updated local .env.selfhosted file, then sync it to the remote host."
      : "Paste the env snippet into the remote .env.selfhosted file.");
    steps.push("Run node scripts/remote-ops.js deploy, then node scripts/remote-ops.js health --strict and node scripts/remote-ops.js smoke.");
    steps.push("Create the first crypto topup order with a whitelist email, send the exact expectedAmount of mock USDT, then run node scripts/recharge-smoke.js --confirmation-mode auto or --confirmation-mode synthetic for a full recharge verification. Use node scripts/crypto-topup-worker.js --json or node scripts/crypto-topup-confirm.js when you only need topup settlement.");
    steps.push("Run node scripts/audit-anchor-smoke.js --confirmation-mode synthetic for a closed-loop audit anchor smoke, or --confirmation-mode auto when anchor RPC/signing is configured.");
  }
  return steps;
}

async function bootstrapEvmTestnet(input, deps = {}) {
  const deployMockUsdtImpl = deps.deployMockUsdt || deployMockUsdt;
  const env = parseLocalEnv(input.envFile);
  const meta = resolveEvmTestnetMeta(input.chain || env.CRYPTO_TOPUP_CHAIN || env.AUDIT_ANCHOR_CHAIN || "base-sepolia");
  const rpcUrl = String(input.rpcUrl || env.CRYPTO_TOPUP_RPC_URL || meta.rpcUrl).trim() || meta.rpcUrl;
  const topup = buildWalletRecord(input.topupPrivateKey);
  const anchor = buildWalletRecord(input.anchorPrivateKey);

  let mockUsdt = null;
  if (input.deployMockUsdt) {
    const deployerPrivateKey = normalizePrivateKey(input.deployerPrivateKey || topup.privateKey);
    if (!deployerPrivateKey) {
      throw new Error("A valid deployer private key is required when --deploy-mock-usdt is used.");
    }
    mockUsdt = await deployMockUsdtImpl({
      chain: meta.networkName,
      rpcUrl,
      privateKey: deployerPrivateKey,
      recipient: topup.address,
      amount: input.mockAmount,
      gasLimit: input.gasLimit,
    });
  }

  const envSnippet = buildWalletEnvSnippet({
    chain: meta.networkName,
    whitelistEmails: input.whitelistEmails,
    rpcUrl,
    tokenAddress: mockUsdt?.contractAddress || env.CRYPTO_TOPUP_TOKEN_ADDRESS || "<fill-after-mock-usdt-deploy>",
    topup,
    anchor,
  });

  const writtenEnvPath = input.writeEnv
    ? writeBootstrapEnvFile({
      envFile: input.envFile,
      envSnippet,
    })
    : null;

  return {
    chain: meta.networkName,
    rpcUrl,
    topup: serializeWalletRecord(topup),
    anchor: serializeWalletRecord(anchor),
    mockUsdt,
    envSnippet,
    writtenEnvPath,
    nextSteps: buildNextSteps({
      meta,
      topup,
      anchor,
      mockUsdt,
      writeEnv: input.writeEnv,
    }),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const result = await bootstrapEvmTestnet(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  process.stdout.write(`Bootstrapped ${result.chain}\n`);
  process.stdout.write(`Topup wallet: ${result.topup.address}${result.topup.generated ? " (generated)" : " (reused)"}\n`);
  process.stdout.write(`Anchor wallet: ${result.anchor.address}${result.anchor.generated ? " (generated)" : " (reused)"}\n`);
  if (result.writtenEnvPath) {
    process.stdout.write(`Updated env file: ${result.writtenEnvPath}\n`);
  }
  if (result.mockUsdt) {
    process.stdout.write(`Mock USDT: ${result.mockUsdt.contractAddress}\n`);
    if (result.mockUsdt.mintTxHash) {
      process.stdout.write(`Mock mint tx: ${result.mockUsdt.mintTxHash}\n`);
    }
  } else {
    process.stdout.write("Mock USDT: not deployed in this run\n");
  }
  process.stdout.write("\nEnv snippet:\n");
  process.stdout.write(`${result.envSnippet}\n\n`);
  process.stdout.write("Next steps:\n");
  result.nextSteps.forEach((step, index) => {
    process.stdout.write(`${index + 1}. ${step}\n`);
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  bootstrapEvmTestnet,
  buildNextSteps,
  buildWalletRecord,
  parseArgs,
  writeBootstrapEnvFile,
};
