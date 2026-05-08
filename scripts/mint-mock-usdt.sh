#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
cd "$ROOT_DIR"

ENV_FILE=".local-secrets.env"
CHAIN="base"
RPC_URL="https://sepolia.base.org"
PRIVATE_KEY=""
TOKEN_ADDRESS=""
RECIPIENT=""
AMOUNT="100000"
GAS_LIMIT=""
JSON="0"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/mint-mock-usdt.sh [--env-file .env.selfhosted] [--chain base-sepolia|polygon-amoy] [--rpc-url <rpc>] [--private-key 0x...] [--token-address 0x...] [--recipient 0x...] [--amount 1000000] [--gas-limit 100000] [--json]

Mints mock USDT on the configured EVM testnet.
Defaults are read from .env.selfhosted and .local-secrets.env.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --env-file|--env)
      ENV_FILE=${2:-}
      shift 2
      ;;
    --chain)
      CHAIN=${2:-}
      shift 2
      ;;
    --rpc-url)
      RPC_URL=${2:-}
      shift 2
      ;;
    --private-key)
      PRIVATE_KEY=${2:-}
      shift 2
      ;;
    --token-address)
      TOKEN_ADDRESS=${2:-}
      shift 2
      ;;
    --recipient)
      RECIPIENT=${2:-}
      shift 2
      ;;
    --amount)
      AMOUNT=${2:-}
      shift 2
      ;;
    --gas-limit)
      GAS_LIMIT=${2:-}
      shift 2
      ;;
    --json)
      JSON="1"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf '%s\n' "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

ANIXOPS_MINT_ENV_FILE="$ENV_FILE" \
ANIXOPS_MINT_CHAIN="$CHAIN" \
ANIXOPS_MINT_RPC_URL="$RPC_URL" \
ANIXOPS_MINT_PRIVATE_KEY="$PRIVATE_KEY" \
ANIXOPS_MINT_TOKEN_ADDRESS="$TOKEN_ADDRESS" \
ANIXOPS_MINT_RECIPIENT="$RECIPIENT" \
ANIXOPS_MINT_AMOUNT="$AMOUNT" \
ANIXOPS_MINT_GAS_LIMIT="$GAS_LIMIT" \
ANIXOPS_MINT_JSON="$JSON" \
node - <<'NODE'
const { ethers } = require("ethers");
const { loadMergedEnv } = require("./scripts/script-env.js");
const { resolveEvmTestnetMeta } = require("./scripts/evm-testnet-meta.js");

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
    throw new Error("Mint amount must be a positive number.");
  }
  return parsed;
}

function applyMintGasBuffer(estimatedGas) {
  const gas = BigInt(estimatedGas);
  const buffered = (gas * 13n + 9n) / 10n;
  return buffered > 100000n ? buffered : 100000n;
}

(async () => {
  const envFile = process.env.ANIXOPS_MINT_ENV_FILE || ".env.selfhosted";
  const env = loadMergedEnv(envFile);
  const chain = String(
    process.env.ANIXOPS_MINT_CHAIN ||
    env.CRYPTO_TOPUP_CHAIN ||
    env.AUDIT_ANCHOR_CHAIN ||
    "base-sepolia"
  ).trim();
  const meta = resolveEvmTestnetMeta(chain);
  const rpcUrl = String(process.env.ANIXOPS_MINT_RPC_URL || env.CRYPTO_TOPUP_RPC_URL || meta.rpcUrl).trim();
  const privateKey = normalizePrivateKey(process.env.ANIXOPS_MINT_PRIVATE_KEY || env.CRYPTO_TOPUP_SIGNER_PRIVATE_KEY);
  const tokenAddress = normalizeAddress(process.env.ANIXOPS_MINT_TOKEN_ADDRESS || env.CRYPTO_TOPUP_TOKEN_ADDRESS);
  const recipient = normalizeAddress(process.env.ANIXOPS_MINT_RECIPIENT || env.CRYPTO_TOPUP_RECEIVER_ADDRESS);
  const amount = String(process.env.ANIXOPS_MINT_AMOUNT || "1000000").trim();
  const gasLimitInput = String(process.env.ANIXOPS_MINT_GAS_LIMIT || "").trim();

  if (!rpcUrl) {
    throw new Error("Missing RPC URL. Set CRYPTO_TOPUP_RPC_URL or pass --rpc-url.");
  }
  if (!privateKey) {
    throw new Error("Missing private key. Set CRYPTO_TOPUP_SIGNER_PRIVATE_KEY or pass --private-key.");
  }
  if (!tokenAddress) {
    throw new Error("Missing token address. Set CRYPTO_TOPUP_TOKEN_ADDRESS or pass --token-address.");
  }
  if (!recipient) {
    throw new Error("Missing recipient address. Set CRYPTO_TOPUP_RECEIVER_ADDRESS or pass --recipient.");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl, {
    chainId: meta.chainId,
    name: meta.networkName,
  });
  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(
    tokenAddress,
    ["function mint(address to, uint256 value) returns (bool)"],
    wallet
  );

  const parsedAmount = ethers.parseUnits(amount, 6);
  let gasLimit;
  if (gasLimitInput) {
    const parsedGasLimit = Number(gasLimitInput);
    if (!Number.isInteger(parsedGasLimit) || parsedGasLimit <= 0) {
      throw new Error("Gas limit must be a positive integer.");
    }
    gasLimit = BigInt(parsedGasLimit);
  } else {
    try {
      const estimatedGas = await contract.mint.estimateGas(recipient, parsedAmount);
      gasLimit = applyMintGasBuffer(estimatedGas);
    } catch (error) {
      gasLimit = 100000n;
      process.stderr.write(`Warning: gas estimation failed, using ${gasLimit.toString()}\n`);
    }
  }

  const tx = await contract.mint(recipient, parsedAmount, { gasLimit });
  const receipt = await tx.wait();

  const result = {
    chain: meta.networkName,
    contractAddress: tokenAddress,
    recipient,
    amount,
    gasLimit: gasLimit.toString(),
    txHash: receipt?.hash || tx.hash,
    status: receipt?.status ?? null,
    from: wallet.address,
  };

  if (String(process.env.ANIXOPS_MINT_JSON || "0") === "1") {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  process.stdout.write(`Mock USDT minted on ${result.chain}\n`);
  process.stdout.write(`Contract: ${result.contractAddress}\n`);
  process.stdout.write(`Recipient: ${result.recipient}\n`);
  process.stdout.write(`Amount: ${result.amount}\n`);
  process.stdout.write(`Gas limit: ${result.gasLimit}\n`);
  process.stdout.write(`Tx hash: ${result.txHash}\n`);
})();
NODE
