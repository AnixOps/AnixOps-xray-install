import { Interface, JsonRpcProvider, Wallet, formatUnits, parseUnits } from "ethers";
import { loadAuditAnchorSignerPrivateKey, loadEvmChainConfig, resolveCryptoTopupNetworkLabel, resolveEvmTestnetMeta } from "./chain-config.js";
import { env } from "./config/runtime-env.js";

const ERC20_INTERFACE = new Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export type PendingEvmTopup = {
  id: string;
  address: string;
  expectedAmount: number;
  createdAt: string | null;
  expiresAt: string | null;
};

export type ObservedEvmTransfer = {
  txHash: string;
  address: string;
  amount: number;
  confirmations: number;
  blockNumber: number;
  observedAt: string | null;
};

export function matchPendingTopupsToObservedTransfers(input: {
  pendingTopups: PendingEvmTopup[];
  observedTransfers: ObservedEvmTransfer[];
  requiredConfirmations: number;
  now?: Date | string | null;
}) {
  const matchedTopupIds = new Set<string>();
  const matchedTxHashes = new Set<string>();
  const nowTime = input.now ? new Date(input.now).getTime() : Date.now();
  const matches: Array<ObservedEvmTransfer & { topupId: string }> = [];
  const ambiguous: ObservedEvmTransfer[] = [];
  const skipped: ObservedEvmTransfer[] = [];

  const pending = [...input.pendingTopups].sort((left, right) => {
    return Date.parse(left.createdAt || "") - Date.parse(right.createdAt || "");
  });
  const transfers = [...input.observedTransfers].sort((left, right) => {
    if (left.blockNumber !== right.blockNumber) {
      return left.blockNumber - right.blockNumber;
    }
    return left.txHash.localeCompare(right.txHash);
  });

  for (const transfer of transfers) {
    if (matchedTxHashes.has(transfer.txHash.toLowerCase())) {
      continue;
    }
    if (transfer.confirmations < input.requiredConfirmations) {
      skipped.push(transfer);
      continue;
    }

    const observedTime = transfer.observedAt ? Date.parse(transfer.observedAt) : Number.NaN;
    const candidates = pending.filter((topup) => {
      if (matchedTopupIds.has(topup.id)) {
        return false;
      }
      const expiresAt = topup.expiresAt ? Date.parse(topup.expiresAt) : Number.NaN;
      if (Number.isFinite(expiresAt) && expiresAt <= nowTime) {
        return false;
      }
      if (topup.address.toLowerCase() !== transfer.address.toLowerCase()) {
        return false;
      }
      if (Math.abs(Number(topup.expectedAmount) - Number(transfer.amount)) > 0.0000001) {
        return false;
      }
      if (Number.isFinite(observedTime) && topup.createdAt) {
        const createdAt = Date.parse(topup.createdAt);
        if (Number.isFinite(createdAt) && createdAt > observedTime) {
          return false;
        }
      }
      return true;
    });

    if (candidates.length !== 1) {
      (candidates.length > 1 ? ambiguous : skipped).push(transfer);
      continue;
    }

    matchedTopupIds.add(candidates[0].id);
    matchedTxHashes.add(transfer.txHash.toLowerCase());
    matches.push({
      ...transfer,
      topupId: candidates[0].id,
    });
  }

  return {
    matches,
    ambiguous,
    skipped,
  };
}

export async function scanAutoConfirmableEvmTopups(input: {
  pendingTopups: PendingEvmTopup[];
  lookbackBlocks?: number;
}) {
  const config = loadEvmChainConfig(env);
  if (!config.rpcUrl || !config.tokenAddress || !config.receiverAddress) {
    throw new Error("EVM topup verification is not configured");
  }

  const meta = resolveEvmTestnetMeta(config.chain);
  const network = resolveCryptoTopupNetworkLabel(config.chain);
  const provider = new JsonRpcProvider(config.rpcUrl, {
    chainId: meta.chainId,
    name: meta.networkName,
  });
  const currentBlock = await provider.getBlockNumber();
  const lookbackBlocks = Math.max(1, Math.min(250000, Number(input.lookbackBlocks || 10000)));
  const fromBlock = Math.max(0, currentBlock - lookbackBlocks + 1);
  const topics = ERC20_INTERFACE.encodeFilterTopics("Transfer", [null, config.receiverAddress]);
  const logs = await provider.getLogs({
    address: config.tokenAddress,
    fromBlock,
    toBlock: currentBlock,
    topics,
  });
  const blockTimestampCache = new Map<number, string | null>();

  const observedTransfers: ObservedEvmTransfer[] = [];
  for (const log of logs) {
    try {
      const parsed = ERC20_INTERFACE.parseLog({ topics: log.topics, data: log.data });
      if (!parsed) {
        continue;
      }
      const to = String(parsed.args.to || "");
      if (to.toLowerCase() !== config.receiverAddress.toLowerCase()) {
        continue;
      }

      let observedAt = blockTimestampCache.get(log.blockNumber);
      if (typeof observedAt === "undefined") {
        const block = await provider.getBlock(log.blockNumber);
        observedAt = block?.timestamp ? new Date(block.timestamp * 1000).toISOString() : null;
        blockTimestampCache.set(log.blockNumber, observedAt);
      }

      observedTransfers.push({
        txHash: log.transactionHash,
        address: to,
        amount: Math.round(Number(formatUnits(parsed.args.value, config.tokenDecimals)) * 1_000_000) / 1_000_000,
        confirmations: Math.max(0, currentBlock - log.blockNumber + 1),
        blockNumber: log.blockNumber,
        observedAt,
      });
    } catch {
      // Ignore unrelated logs that fail decoding.
    }
  }

  const matching = matchPendingTopupsToObservedTransfers({
    pendingTopups: input.pendingTopups,
    observedTransfers,
    requiredConfirmations: config.confirmationsRequired,
  });

  return {
    chain: meta.networkName,
    network,
    currentBlock,
    fromBlock,
    lookbackBlocks,
    observedTransfers,
    ...matching,
  };
}

export async function verifyEvmTopupTransaction(input: {
  txHash: string;
  expectedAmount: number;
}) {
  const config = loadEvmChainConfig(env);
  if (!config.rpcUrl || !config.tokenAddress || !config.receiverAddress) {
    throw new Error("EVM topup verification is not configured");
  }

  const meta = resolveEvmTestnetMeta(config.chain);
  const provider = new JsonRpcProvider(config.rpcUrl, {
    chainId: meta.chainId,
    name: meta.networkName,
  });
  const receipt = await provider.getTransactionReceipt(input.txHash);
  if (!receipt) {
    throw new Error("Transaction receipt not found");
  }
  if (receipt.status !== 1) {
    throw new Error("Transaction failed on-chain");
  }

  const currentBlock = await provider.getBlockNumber();
  const confirmations = Math.max(0, currentBlock - receipt.blockNumber + 1);
  let receivedAmount = 0;

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== config.tokenAddress.toLowerCase()) {
      continue;
    }
    try {
      const parsed = ERC20_INTERFACE.parseLog({ topics: log.topics, data: log.data });
      if (!parsed) {
        continue;
      }
      const to = String(parsed.args.to || "").toLowerCase();
      if (to !== config.receiverAddress.toLowerCase()) {
        continue;
      }
      receivedAmount += Number(formatUnits(parsed.args.value, config.tokenDecimals));
    } catch {
      // Ignore unrelated logs on the same transaction.
    }
  }

  return {
    confirmations,
    receivedAmount: Math.round(receivedAmount * 1_000_000) / 1_000_000,
    meetsAmount: receivedAmount + 1e-9 >= input.expectedAmount,
    chain: config.chain,
    asset: config.asset,
    receiverAddress: config.receiverAddress,
  };
}

export async function sendEvmAnchorTransaction(merkleRoot: string) {
  const config = loadEvmChainConfig(env);
  const signerPrivateKey = loadAuditAnchorSignerPrivateKey(env);
  const anchorMeta = resolveEvmTestnetMeta(env.AUDIT_ANCHOR_CHAIN || config.chain);
  const rpcUrl = env.AUDIT_ANCHOR_RPC_URL?.trim() || anchorMeta.defaultRpcUrl;
  if (!rpcUrl || !signerPrivateKey) {
    throw new Error("EVM audit anchor signing is not configured");
  }

  const provider = new JsonRpcProvider(rpcUrl, {
    chainId: anchorMeta.chainId,
    name: anchorMeta.networkName,
  });
  const wallet = new Wallet(signerPrivateKey, provider);
  const target = config.anchorTargetAddress || wallet.address;
  const balance = await provider.getBalance(wallet.address);
  const minBalance = BigInt(config.anchorMinNativeBalance || 0);
  if (balance < minBalance) {
    throw new Error("Anchor signer balance is below the configured minimum threshold");
  }

  const rootHex = merkleRoot.startsWith("0x") ? merkleRoot : `0x${merkleRoot}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(rootHex)) {
    throw new Error("Merkle root must be 32 bytes hex");
  }

  const tx = await wallet.sendTransaction({
    to: target,
    value: 0n,
    data: rootHex,
  });
  const receipt = await tx.wait(config.confirmationsRequired);
  if (!receipt) {
    throw new Error("Anchor transaction receipt not found");
  }
  const confirmations = await receipt.confirmations();

  return {
    chain: config.chain,
    asset: config.asset,
    txHash: receipt.hash,
    receipt: {
      blockNumber: receipt.blockNumber,
      status: receipt.status,
      gasUsed: receipt.gasUsed.toString(),
      to: receipt.to,
      from: receipt.from,
      confirmations,
    },
  };
}

export function buildExpectedTokenAmount(amount: number) {
  const config = loadEvmChainConfig(env);
  return parseUnits(String(amount), config.tokenDecimals).toString();
}
