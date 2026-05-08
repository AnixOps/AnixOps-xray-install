#!/usr/bin/env node

const { sendAlertWebhook } = require("./alert-webhook.js");
const { JsonRpcProvider, Wallet } = require("ethers");
const { resolveEvmTestnetMeta } = require("./evm-testnet-meta.js");
const { loadApiSecret, loadMergedEnv } = require("./script-env.js");

function parseArgs(argv) {
  const args = {
    api: process.env.ANIXOPS_API_URL || "http://127.0.0.1:8787",
    envFile: ".env.selfhosted",
    limit: 1000,
    chain: "",
    txHash: "",
    finalizeAttempts: 3,
    finalizeRetryDelayMs: 1000,
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
    } else if (arg === "--chain") {
      args.chain = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--tx-hash") {
      args.txHash = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--finalize-attempts") {
      args.finalizeAttempts = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--finalize-retry-delay-ms") {
      args.finalizeRetryDelayMs = Number(argv[index + 1]);
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
  node scripts/audit-anchor-worker.js [--api http://127.0.0.1:8787] [--env .env.selfhosted] [--limit 1000] [--chain base-sepolia|polygon-amoy] [--tx-hash 0xabc] [--finalize-attempts 3] [--finalize-retry-delay-ms 1000] [--json]

Creates one audit anchor batch through the internal API. This is cron-friendly and exits 0 when there are no unanchored events.`);
}

function normalizeHexPrivateKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^0x[0-9a-fA-F]{64}$/.test(raw)) return raw;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return `0x${raw}`;
  return "";
}

function resolveChainMeta(env, cliChain = "") {
  return resolveEvmTestnetMeta(cliChain || env.AUDIT_ANCHOR_CHAIN || "base");
}

function hasAnchorSendConfig(env = {}) {
  const rpcUrl = String(process.env.AUDIT_ANCHOR_RPC_URL || env.AUDIT_ANCHOR_RPC_URL || "").trim();
  const privateKey = normalizeHexPrivateKey(process.env.AUDIT_ANCHOR_SIGNER_PRIVATE_KEY || env.AUDIT_ANCHOR_SIGNER_PRIVATE_KEY);
  return Boolean(rpcUrl && privateKey);
}

async function requestJson(url, apiSecret, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Secret": apiSecret,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    body: payload,
  };
}

async function getJson(url, apiSecret) {
  const response = await fetch(url, {
    headers: {
      "X-API-Secret": apiSecret,
    },
  });
  const payload = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    body: payload,
  };
}

function formatAnchorReceipt(chain, txHash, receipt) {
  return {
    chain,
    txHash,
    receipt: {
      blockNumber: receipt.blockNumber,
      status: receipt.status,
      gasUsed: receipt.gasUsed.toString(),
      to: receipt.to,
      from: receipt.from,
    },
  };
}

async function broadcastEvmAnchorTransaction(env, merkleRoot, cliChain = "") {
  const chainMeta = resolveChainMeta(env, cliChain);
  const rpcUrl = String(process.env.AUDIT_ANCHOR_RPC_URL || env.AUDIT_ANCHOR_RPC_URL || "").trim();
  const privateKey = normalizeHexPrivateKey(process.env.AUDIT_ANCHOR_SIGNER_PRIVATE_KEY || env.AUDIT_ANCHOR_SIGNER_PRIVATE_KEY);
  const targetAddress = String(process.env.AUDIT_ANCHOR_TARGET_ADDRESS || env.AUDIT_ANCHOR_TARGET_ADDRESS || "").trim();

  if (!rpcUrl || !privateKey) {
    return null;
  }

  const provider = new JsonRpcProvider(rpcUrl, {
    chainId: chainMeta.chainId,
    name: chainMeta.networkName,
  });
  const wallet = new Wallet(privateKey, provider);
  const to = /^0x[0-9a-fA-F]{40}$/.test(targetAddress) ? targetAddress : wallet.address;
  const rootHex = String(merkleRoot || "").startsWith("0x") ? String(merkleRoot) : `0x${String(merkleRoot || "")}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(rootHex)) {
    throw new Error("Merkle root must be a 32-byte hex string.");
  }

  const tx = await wallet.sendTransaction({
    to,
    value: 0n,
    data: rootHex,
  });

  return {
    chain: chainMeta.networkName,
    txHash: tx.hash,
    async waitForReceipt(confirmations = 1) {
      const receipt = await tx.wait(confirmations);
      if (!receipt) {
        throw new Error("Anchor transaction receipt not found.");
      }
      return formatAnchorReceipt(chainMeta.networkName, tx.hash, receipt);
    },
  };
}

async function sendEvmAnchorTransaction(env, merkleRoot, cliChain = "") {
  const handle = await broadcastEvmAnchorTransaction(env, merkleRoot, cliChain);
  if (!handle) {
    return null;
  }
  return handle.waitForReceipt(1);
}

async function loadAnchorTransactionReceipt(env, txHash, cliChain = "") {
  const chainMeta = resolveChainMeta(env, cliChain);
  const rpcUrl = String(process.env.AUDIT_ANCHOR_RPC_URL || env.AUDIT_ANCHOR_RPC_URL || "").trim();
  if (!rpcUrl) {
    throw new Error("AUDIT_ANCHOR_RPC_URL is required to recover a submitted anchor transaction.");
  }

  const provider = new JsonRpcProvider(rpcUrl, {
    chainId: chainMeta.chainId,
    name: chainMeta.networkName,
  });
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    return null;
  }
  if (receipt.status !== 1) {
    throw new Error("Submitted anchor transaction failed on-chain.");
  }
  return formatAnchorReceipt(chainMeta.networkName, txHash, receipt);
}

function buildAuditAnchorAlert(error, state = {}, args = {}) {
  const code = typeof error === "object" && error && "code" in error ? error.code : "";
  let level = "error";
  let title = "Audit anchor worker failed";
  let detail = error instanceof Error ? error.message : String(error || "Unknown error");

  if (code === "AUDIT_ANCHOR_PENDING") {
    level = "warn";
    title = "Audit anchor batch requires operator action";
    detail = "A batch was created but no chain transaction was sent. Configure AUDIT_ANCHOR_RPC_URL and AUDIT_ANCHOR_SIGNER_PRIVATE_KEY, or pass --tx-hash to finalize manually.";
  } else if (code === "AUDIT_ANCHOR_SUBMISSION_INDOUBT") {
    level = "warn";
    title = "Audit anchor batch needs txHash-based recovery";
    detail = "A prior submission attempt may already have broadcast a transaction. Inspect explorer or alert history, then rerun with --tx-hash <existing-tx-hash> to finalize without sending a duplicate transaction.";
  } else if (code === "AUDIT_ANCHOR_RECEIPT_PENDING") {
    level = "warn";
    title = "Audit anchor transaction is still waiting for receipt";
    detail = "A transaction hash is already recorded for this batch, but the RPC provider is not returning a receipt yet.";
  } else if (state.stage === "recover-pending") {
    title = "Audit anchor pending-batch recovery failed";
  } else if (state.stage === "mark-submitting") {
    title = "Audit anchor submission lock failed";
  } else if (state.stage === "mark-submitted") {
    title = "Audit anchor submitted-tx persistence failed";
  } else if (state.stage === "recover-receipt") {
    title = "Audit anchor receipt recovery failed";
  } else if (state.stage === "create") {
    title = "Audit anchor batch creation failed";
  } else if (state.stage === "chain-send") {
    title = "Audit anchor chain transaction failed";
  } else if (state.stage === "finalize") {
    title = "Audit anchor finalize failed";
  }

  return {
    source: "audit-anchor-worker",
    level,
    title,
    detail,
    facts: [
      { label: "api", value: state.baseUrl || args.api || "http://127.0.0.1:8787" },
      state.stage ? { label: "stage", value: state.stage } : null,
      state.batch?.id ? { label: "batchId", value: state.batch.id } : null,
      state.batch?.eventCount !== undefined ? { label: "eventCount", value: state.batch.eventCount } : null,
      state.batch?.merkleRoot ? { label: "merkleRoot", value: state.batch.merkleRoot } : null,
      state.chainResult?.chain ? { label: "chain", value: state.chainResult.chain } : null,
      state.chainResult?.txHash ? { label: "txHash", value: state.chainResult.txHash } : null,
      args.chain ? { label: "requestedChain", value: args.chain } : null,
      args.txHash ? { label: "manualTxHash", value: args.txHash } : null,
    ].filter(Boolean),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableFinalizeFailure(result) {
  if (!result) {
    return true;
  }
  if (result.ok && result.body?.batch) {
    return false;
  }
  return Number(result.status || 0) >= 500;
}

async function finalizeWithRetries(input, dependencies = {}) {
  const request = dependencies.requestJson || requestJson;
  const wait = dependencies.sleep || sleep;
  const attempts = Math.max(1, Math.min(10, Number(input.attempts || 1)));
  const retryDelayMs = Math.max(0, Math.min(60000, Number(input.retryDelayMs || 0)));
  let lastResult = null;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await request(
        `${input.baseUrl}/internal/audit/anchor/${encodeURIComponent(input.batchId)}/finalize`,
        input.apiSecret,
        input.chainResult,
      );
      if (result.ok && result.body?.batch) {
        return result.body.batch;
      }
      lastResult = result;
      lastError = new Error(result.body?.error || `Audit anchor finalize failed with HTTP ${result.status}`);
      lastError.retriable = isRetriableFinalizeFailure(result);
      if (!lastError.retriable || attempt >= attempts) {
        throw lastError;
      }
    } catch (error) {
      lastError = error;
      if (error?.retriable === false || attempt >= attempts) {
        throw error;
      }
    }

    if (retryDelayMs > 0) {
      await wait(retryDelayMs);
    }
  }

  throw lastError || new Error(lastResult?.body?.error || "Audit anchor finalize failed");
}

async function runWorker(args, dependencies = {}) {
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 10000) {
    throw new Error("--limit must be an integer between 1 and 10000.");
  }
  const finalizeAttempts = Number.isInteger(args.finalizeAttempts) ? args.finalizeAttempts : 3;
  const finalizeRetryDelayMs = Number.isInteger(args.finalizeRetryDelayMs) ? args.finalizeRetryDelayMs : 1000;
  if (!Number.isInteger(finalizeAttempts) || finalizeAttempts < 1 || finalizeAttempts > 10) {
    throw new Error("--finalize-attempts must be an integer between 1 and 10.");
  }
  if (!Number.isInteger(finalizeRetryDelayMs) || finalizeRetryDelayMs < 0 || finalizeRetryDelayMs > 60000) {
    throw new Error("--finalize-retry-delay-ms must be an integer between 0 and 60000.");
  }

  const apiSecret = dependencies.apiSecret || loadApiSecret(args.envFile);
  const env = dependencies.env || loadMergedEnv(args.envFile);
  const request = dependencies.requestJson || requestJson;
  const get = dependencies.getJson || getJson;
  const loadReceipt = dependencies.loadAnchorTransactionReceipt || loadAnchorTransactionReceipt;
  const broadcastTx = dependencies.broadcastEvmAnchorTransaction
    || (typeof dependencies.sendEvmAnchorTransaction === "function"
      ? async (runtimeEnv, merkleRoot, cliChain) => {
          const finalResult = await dependencies.sendEvmAnchorTransaction(runtimeEnv, merkleRoot, cliChain);
          if (!finalResult) {
            return null;
          }
          return {
            chain: finalResult.chain,
            txHash: finalResult.txHash,
            async waitForReceipt() {
              return finalResult;
            },
          };
        }
      : broadcastEvmAnchorTransaction);
  const sendAlert = dependencies.sendAlertWebhook || sendAlertWebhook;
  const wait = dependencies.sleep || sleep;
  const canAutoSend = typeof dependencies.sendEvmAnchorTransaction === "function"
    || typeof dependencies.broadcastEvmAnchorTransaction === "function"
    || hasAnchorSendConfig(env);
  if (!apiSecret) {
    throw new Error("API_SECRET is required in the environment or env file.");
  }

  const baseUrl = args.api.replace(/\/+$/, "");
  const alertWebhookUrl = process.env.AUDIT_ANCHOR_ALERT_WEBHOOK_URL || env.AUDIT_ANCHOR_ALERT_WEBHOOK_URL || "";
  const state = {
    baseUrl,
    stage: "create",
    batch: null,
    chainResult: null,
  };

  try {
    state.stage = "recover-pending";
    const pendingResult = await get(`${baseUrl}/internal/audit/anchor/pending`, apiSecret);
    let batch = null;

    if (pendingResult.ok && pendingResult.body?.batch) {
      batch = pendingResult.body.batch;
    } else if (pendingResult.status !== 404 || pendingResult.body?.error !== "No pending audit anchor batches") {
      throw new Error(pendingResult.body?.error || `Audit anchor pending recovery failed with HTTP ${pendingResult.status}`);
    }

    if (!batch) {
      state.stage = "create";
      const createResult = await request(`${baseUrl}/internal/audit/anchor`, apiSecret, {
        limit: args.limit,
        chain: null,
        txHash: null,
      });
      const body = createResult.body;

      if (createResult.status === 409 && body.error === "No unanchored audit events") {
        return { ok: true, skipped: true, reason: body.error };
      }

      if (!createResult.ok || !body.batch) {
        throw new Error(body.error || `Audit anchor worker failed with HTTP ${createResult.status}`);
      }
      batch = body.batch;
    }
    state.batch = batch;

    let finalizedBatch = batch;
    let chainResult = null;
    if (args.txHash) {
      chainResult = {
        chain: args.chain || resolveChainMeta(env).networkName,
        txHash: args.txHash,
        receipt: null,
      };
    } else {
      if (batch.txHash && batch.chain) {
        state.stage = "recover-receipt";
        const recovered = await loadReceipt(env, batch.txHash, args.chain || batch.chain);
        if (!recovered) {
          return {
            ok: true,
            skipped: true,
            reason: "Pending anchor transaction is still waiting for receipt",
            batchId: batch.id,
            txHash: batch.txHash,
          };
        }
        chainResult = recovered;
      }
      if (!chainResult && batch.submissionStartedAt) {
        const error = new Error("Audit anchor batch may already have been submitted on-chain. Rerun with --tx-hash <existing-tx-hash> after confirming the transaction.");
        error.code = "AUDIT_ANCHOR_SUBMISSION_INDOUBT";
        throw error;
      }
      if (!chainResult && !canAutoSend) {
        const error = new Error("Audit anchor batch created but no chain transaction was sent.");
        error.code = "AUDIT_ANCHOR_PENDING";
        throw error;
      }
      if (!chainResult) {
        state.stage = "mark-submitting";
        const markSubmittingResult = await request(
          `${baseUrl}/internal/audit/anchor/${encodeURIComponent(batch.id)}/mark-submitting`,
          apiSecret,
          {},
        );
        if (!markSubmittingResult.ok || !markSubmittingResult.body?.batch) {
          throw new Error(markSubmittingResult.body?.error || `Audit anchor mark-submitting failed with HTTP ${markSubmittingResult.status}`);
        }
        batch = markSubmittingResult.body.batch;
        state.batch = batch;
        state.stage = "chain-send";
        const txHandle = await broadcastTx(env, batch.merkleRoot, args.chain);
        if (!txHandle) {
          const error = new Error("Audit anchor batch created but no chain transaction was sent.");
          error.code = "AUDIT_ANCHOR_PENDING";
          throw error;
        }
        state.stage = "mark-submitted";
        const markSubmittedResult = await request(
          `${baseUrl}/internal/audit/anchor/${encodeURIComponent(batch.id)}/mark-submitted`,
          apiSecret,
          {
            chain: txHandle.chain,
            txHash: txHandle.txHash,
          },
        );
        if (!markSubmittedResult.ok || !markSubmittedResult.body?.batch) {
          throw new Error(markSubmittedResult.body?.error || `Audit anchor mark-submitted failed with HTTP ${markSubmittedResult.status}`);
        }
        batch = markSubmittedResult.body.batch;
        state.batch = batch;
        state.stage = "chain-send";
        chainResult = await txHandle.waitForReceipt(1);
      }
    }

    state.chainResult = chainResult;
    state.stage = "finalize";
    finalizedBatch = await finalizeWithRetries({
      baseUrl,
      apiSecret,
      batchId: batch.id,
      chainResult,
      attempts: finalizeAttempts,
      retryDelayMs: finalizeRetryDelayMs,
    }, {
      requestJson: request,
      sleep: wait,
    });

    return {
      ok: true,
      batchId: finalizedBatch.id,
      eventCount: finalizedBatch.eventCount,
      merkleRoot: finalizedBatch.merkleRoot,
      status: finalizedBatch.status,
      chain: finalizedBatch.chain || null,
      txHash: finalizedBatch.txHash || null,
    };
  } catch (error) {
    await sendAlert(alertWebhookUrl, buildAuditAnchorAlert(error, state, args)).catch(() => false);
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
  if (result.skipped) {
    process.stdout.write(`${args.json ? JSON.stringify(result) : "No unanchored audit events."}\n`);
    return;
  }
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  process.stdout.write(`Anchored batch ${result.batchId} with ${result.eventCount} events.\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  buildAuditAnchorAlert,
  finalizeWithRetries,
  getJson,
  hasAnchorSendConfig,
  isRetriableFinalizeFailure,
  loadApiSecret,
  loadMergedEnv,
  parseArgs,
  requestJson,
  runWorker,
  sleep,
  sendEvmAnchorTransaction,
};
