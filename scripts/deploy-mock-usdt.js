#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const solc = require("solc");
const { ethers } = require("ethers");
const { loadMergedEnv } = require("./script-env.js");
const { resolveEvmTestnetMeta } = require("./evm-testnet-meta.js");

const DEFAULT_DECIMALS = 6;
const MIN_MINT_GAS_LIMIT = 100000n;
const MINT_GAS_BUFFER_NUMERATOR = 13n;
const MINT_GAS_BUFFER_DENOMINATOR = 10n;

function parseArgs(argv) {
  const args = {
    chain: "base-sepolia",
    rpcUrl: "",
    privateKey: "",
    envFile: ".env.selfhosted",
    recipient: "",
    amount: "1000",
    gasLimit: "",
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--chain") {
      args.chain = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--rpc-url") {
      args.rpcUrl = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--private-key") {
      args.privateKey = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--env-file" || arg === "--env") {
      args.envFile = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--recipient") {
      args.recipient = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--amount") {
      args.amount = argv[index + 1] || "";
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
  node scripts/deploy-mock-usdt.js [--chain base-sepolia|polygon-amoy] [--env .env.selfhosted] [--rpc-url <rpc>] [--private-key 0x...] [--recipient 0x...] [--amount 1000] [--gas-limit 1500000] [--json]

Compiles and deploys contracts/MockUSDT.sol to a supported EVM testnet, then optionally mints test tokens to a recipient.`);
}

function parseLocalEnv(envFile) {
  return loadMergedEnv(envFile);
}

function normalizePrivateKey(value) {
  const raw = String(value || "").trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(raw)) return raw;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return `0x${raw}`;
  return "";
}

function normalizeAddress(value) {
  const raw = String(value || "").trim();
  return /^0x[0-9a-fA-F]{40}$/.test(raw) ? raw : "";
}

function normalizeMintAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("--amount must be a positive number.");
  }
  return parsed;
}

function applyMintGasBuffer(estimatedGas) {
  const gas = BigInt(estimatedGas);
  const buffered = (gas * MINT_GAS_BUFFER_NUMERATOR + (MINT_GAS_BUFFER_DENOMINATOR - 1n)) / MINT_GAS_BUFFER_DENOMINATOR;
  return buffered > MIN_MINT_GAS_LIMIT ? buffered : MIN_MINT_GAS_LIMIT;
}

function compileMockUsdt() {
  const filePath = path.resolve(process.cwd(), "contracts/MockUSDT.sol");
  const source = fs.readFileSync(filePath, "utf8");
  const input = {
    language: "Solidity",
    sources: {
      "MockUSDT.sol": { content: source },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  if (output.errors) {
    const fatalErrors = output.errors.filter((item) => item.severity === "error");
    if (fatalErrors.length > 0) {
      throw new Error(fatalErrors.map((item) => item.formattedMessage || item.message).join("\n"));
    }
  }
  const contract = output.contracts?.["MockUSDT.sol"]?.MockUSDT;
  if (!contract?.abi || !contract?.evm?.bytecode?.object) {
    throw new Error("Failed to compile MockUSDT.sol");
  }
  return {
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
  };
}

async function deployMockUsdt(input) {
  const meta = resolveEvmTestnetMeta(input.chain);
  const rpcUrl = String(input.rpcUrl || meta.rpcUrl).trim();
  const privateKey = normalizePrivateKey(input.privateKey);
  if (!rpcUrl) {
    throw new Error("RPC URL is required.");
  }
  if (!privateKey) {
    throw new Error("A valid deployer private key is required.");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl, {
    chainId: meta.chainId,
    name: meta.networkName,
  });
  const wallet = new ethers.Wallet(privateKey, provider);
  const { abi, bytecode } = compileMockUsdt();
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const deployOverrides = {};
  if (input.gasLimit) {
    const gasLimit = Number(input.gasLimit);
    if (!Number.isInteger(gasLimit) || gasLimit <= 0) {
      throw new Error("--gas-limit must be a positive integer.");
    }
    deployOverrides.gasLimit = gasLimit;
  }

  const contract = await factory.deploy(deployOverrides);
  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();

  let mintTxHash = null;
  let mintGasLimit = null;
  const recipient = normalizeAddress(input.recipient);
  if (recipient) {
    const amount = normalizeMintAmount(input.amount);
    const parsedAmount = ethers.parseUnits(String(amount), DEFAULT_DECIMALS);
    try {
      const estimatedMintGas = await contract.mint.estimateGas(recipient, parsedAmount);
      mintGasLimit = applyMintGasBuffer(estimatedMintGas);
    } catch {
      mintGasLimit = MIN_MINT_GAS_LIMIT;
    }
    const tx = await contract.mint(recipient, parsedAmount, { gasLimit: mintGasLimit });
    const receipt = await tx.wait();
    mintTxHash = receipt?.hash || tx.hash;
  }

  const result = {
    chain: meta.networkName,
    chainId: meta.chainId,
    rpcUrl,
    contractAddress,
    decimals: DEFAULT_DECIMALS,
    symbol: "USDT",
    recipient: recipient || null,
    mintAmount: recipient ? normalizeMintAmount(input.amount) : null,
    mintTxHash,
    mintGasLimit: mintGasLimit ? mintGasLimit.toString() : null,
    deployerAddress: wallet.address,
  };
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const env = parseLocalEnv(args.envFile);
  const meta = resolveEvmTestnetMeta(args.chain || process.env.CRYPTO_TOPUP_CHAIN || env.CRYPTO_TOPUP_CHAIN);
  const result = await deployMockUsdt({
    chain: meta.networkName,
    rpcUrl: args.rpcUrl || process.env.CRYPTO_TOPUP_RPC_URL || env.CRYPTO_TOPUP_RPC_URL || meta.rpcUrl,
    privateKey: args.privateKey || process.env.CRYPTO_TOPUP_SIGNER_PRIVATE_KEY || env.CRYPTO_TOPUP_SIGNER_PRIVATE_KEY,
    recipient: args.recipient,
    amount: args.amount,
    gasLimit: args.gasLimit,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  process.stdout.write(`Mock USDT deployed at ${result.contractAddress}\n`);
  if (result.recipient) {
    process.stdout.write(`Minted ${result.mintAmount} USDT to ${result.recipient}\n`);
    process.stdout.write(`Mint gas limit: ${result.mintGasLimit}\n`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  compileMockUsdt,
  deployMockUsdt,
  normalizeAddress,
  normalizeMintAmount,
  normalizePrivateKey,
  parseLocalEnv,
  parseArgs,
  applyMintGasBuffer,
};
