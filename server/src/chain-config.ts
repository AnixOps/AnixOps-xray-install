import { Wallet } from "ethers";
import type { ServerEnv } from "./config/env.js";

export const POLYGON_AMOY_CHAIN_ID = 80002;
export const BASE_SEPOLIA_CHAIN_ID = 84532;

export type EvmTestnetMeta = {
  chain: string;
  chainId: number;
  networkName: string;
  defaultRpcUrl: string;
};

export function resolveCryptoTopupNetworkLabel(input: string | null | undefined) {
  const meta = resolveEvmTestnetMeta(input);
  return meta.chain === "polygon" ? "POLYGON" : "ERC20";
}

function normalizeHexPrivateKey(value: string | undefined) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }
  if (/^0x[0-9a-fA-F]{64}$/.test(raw)) {
    return raw;
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return `0x${raw}`;
  }
  return null;
}

function normalizeAddress(value: string | undefined) {
  const raw = String(value || "").trim();
  return /^0x[0-9a-fA-F]{40}$/.test(raw) ? raw : null;
}

function normalizePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeNonNegativeInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export type EvmChainConfig = {
  chain: string;
  chainId: number;
  networkName: string;
  asset: string;
  rpcUrl: string | null;
  confirmationsRequired: number;
  tokenAddress: string | null;
  tokenDecimals: number;
  signerPrivateKey: string | null;
  receiverAddress: string | null;
  cryptoTopupEnabled: boolean;
  auditAnchorEnabled: boolean;
  anchorTargetAddress: string | null;
  anchorMinNativeBalance: number;
};

export type EvmChainReadiness = {
  environment: "testnet" | "mainnet";
  cryptoTopup: {
    enabled: boolean;
    missingKeys: string[];
  };
  auditAnchor: {
    enabled: boolean;
    missingKeys: string[];
  };
};

export function loadEvmChainConfig(env: ServerEnv): EvmChainConfig {
  const signerPrivateKey = normalizeHexPrivateKey(env.CRYPTO_TOPUP_SIGNER_PRIVATE_KEY);
  const receiverAddress = normalizeAddress(env.CRYPTO_TOPUP_RECEIVER_ADDRESS)
    || (signerPrivateKey ? new Wallet(signerPrivateKey).address : null);
  const chainMeta = resolveEvmTestnetMeta(env.CRYPTO_TOPUP_CHAIN || env.AUDIT_ANCHOR_CHAIN || "base");

  return {
    chain: chainMeta.chain,
    chainId: chainMeta.chainId,
    networkName: chainMeta.networkName,
    asset: (env.CRYPTO_TOPUP_ASSET || "USDT").trim().toUpperCase(),
    rpcUrl: env.CRYPTO_TOPUP_RPC_URL?.trim() || chainMeta.defaultRpcUrl,
    confirmationsRequired: normalizePositiveInteger(env.CRYPTO_TOPUP_CONFIRMATIONS_REQUIRED, 12),
    tokenAddress: normalizeAddress(env.CRYPTO_TOPUP_TOKEN_ADDRESS),
    tokenDecimals: normalizePositiveInteger(env.CRYPTO_TOPUP_TOKEN_DECIMALS, 6),
    signerPrivateKey,
    receiverAddress,
    cryptoTopupEnabled: Boolean(
      env.CRYPTO_TOPUP_RPC_URL &&
      receiverAddress &&
      normalizeAddress(env.CRYPTO_TOPUP_TOKEN_ADDRESS),
    ),
    auditAnchorEnabled: Boolean(
      env.AUDIT_ANCHOR_RPC_URL &&
      normalizeHexPrivateKey(env.AUDIT_ANCHOR_SIGNER_PRIVATE_KEY) &&
      normalizeAddress(env.AUDIT_ANCHOR_TARGET_ADDRESS),
    ),
    anchorTargetAddress: normalizeAddress(env.AUDIT_ANCHOR_TARGET_ADDRESS),
    anchorMinNativeBalance: normalizeNonNegativeInteger(env.AUDIT_ANCHOR_MIN_NATIVE_BALANCE, 0),
  };
}

export function loadAuditAnchorSignerPrivateKey(env: ServerEnv) {
  return normalizeHexPrivateKey(env.AUDIT_ANCHOR_SIGNER_PRIVATE_KEY);
}

export function summarizeEvmChainReadiness(env: ServerEnv): EvmChainReadiness {
  const cryptoMissingKeys = [
    env.CRYPTO_TOPUP_CHAIN ? null : "CRYPTO_TOPUP_CHAIN",
    env.CRYPTO_TOPUP_ASSET ? null : "CRYPTO_TOPUP_ASSET",
    env.CRYPTO_TOPUP_CONFIRMATIONS_REQUIRED ? null : "CRYPTO_TOPUP_CONFIRMATIONS_REQUIRED",
    env.CRYPTO_TOPUP_RPC_URL ? null : "CRYPTO_TOPUP_RPC_URL",
    normalizeAddress(env.CRYPTO_TOPUP_RECEIVER_ADDRESS) || normalizeHexPrivateKey(env.CRYPTO_TOPUP_SIGNER_PRIVATE_KEY) ? null : "CRYPTO_TOPUP_RECEIVER_ADDRESS",
    normalizeAddress(env.CRYPTO_TOPUP_TOKEN_ADDRESS) ? null : "CRYPTO_TOPUP_TOKEN_ADDRESS",
    env.CRYPTO_TOPUP_TOKEN_DECIMALS ? null : "CRYPTO_TOPUP_TOKEN_DECIMALS",
  ].filter((item): item is string => Boolean(item));

  const anchorMissingKeys = [
    env.AUDIT_ANCHOR_CHAIN ? null : "AUDIT_ANCHOR_CHAIN",
    env.AUDIT_ANCHOR_RPC_URL ? null : "AUDIT_ANCHOR_RPC_URL",
    normalizeHexPrivateKey(env.AUDIT_ANCHOR_SIGNER_PRIVATE_KEY) ? null : "AUDIT_ANCHOR_SIGNER_PRIVATE_KEY",
    normalizeAddress(env.AUDIT_ANCHOR_TARGET_ADDRESS) ? null : "AUDIT_ANCHOR_TARGET_ADDRESS",
  ].filter((item): item is string => Boolean(item));

  return {
    environment: env.CHAIN_ENVIRONMENT,
    cryptoTopup: {
      enabled: cryptoMissingKeys.length === 0,
      missingKeys: cryptoMissingKeys,
    },
    auditAnchor: {
      enabled: anchorMissingKeys.length === 0,
      missingKeys: anchorMissingKeys,
    },
  };
}

export function resolveEvmTestnetMeta(input: string | null | undefined): EvmTestnetMeta {
  const normalized = String(input || "").trim().toLowerCase();
  const compact = normalized.replace(/[\s_]+/g, "-");
  if (normalized === "base" || normalized === "base-sepolia" || normalized === "basesepolia" || compact === "base-sepolia") {
    return {
      chain: "base",
      chainId: BASE_SEPOLIA_CHAIN_ID,
      networkName: "base-sepolia",
      defaultRpcUrl: "https://sepolia.base.org",
    };
  }
  if (normalized === "polygon" || normalized === "polygon-amoy" || normalized === "amoy" || compact === "polygon-amoy") {
    return {
      chain: "polygon",
      chainId: POLYGON_AMOY_CHAIN_ID,
      networkName: "polygon-amoy",
      defaultRpcUrl: "https://rpc-amoy.polygon.technology",
    };
  }
  return {
    chain: "base",
    chainId: BASE_SEPOLIA_CHAIN_ID,
    networkName: "base-sepolia",
    defaultRpcUrl: "https://sepolia.base.org",
  };
}
