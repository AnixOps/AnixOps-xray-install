import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import Stripe from "stripe";
import {
  db,
  rentals,
  users,
  payments,
  redeemCodes,
  auditLog,
  auditAnchorBatches,
  provisionAttempts,
  billingTicks,
  topups,
  walletLedger,
  probeNodes,
  probeRuns,
  probeResults,
  cryptoTopups,
  complianceStats,
} from "./db/index.js";
import { eq, and, or, sql, desc, asc, inArray } from "drizzle-orm";
import { redis, getCache, setCache, deleteCache } from "./lib/redis.js";
import { addProvisionJob, createProvisionWorker, provisionQueue } from "./lib/queue.js";
import { createHash, randomUUID } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";
import { env } from "./config/runtime-env.js";
import { isChainFeatureAllowed, normalizeEmail } from "./chain-mode.js";
import { loadEvmChainConfig, resolveCryptoTopupNetworkLabel, summarizeEvmChainReadiness } from "./chain-config.js";
import { scanAutoConfirmableEvmTopups, verifyEvmTopupTransaction } from "./evm-chain.js";
import { checkProvisionServerHealth, runHealthChecks } from "./health.js";
import { buildAdminEmailSet, isAdminEmail } from "./auth/admin.js";
import { createMagicLinkMailer, sendMagicLinkEmail } from "./auth/email.js";
import { hasExhaustedAttempts } from "./lib/job-attempts.js";
import { buildRentalProgressPayload } from "./rental-progress.js";
import { buildCatalogPlans, buildCatalogRegions, getCatalogRegionPool, getCatalogRuntimeConfig } from "./catalog.js";
import { buildRentalQuote, getRentalPrice, isValidRentalDuration } from "./pricing.js";
import {
  buildLegacyWalletLedger,
  buildWalletLedger,
  buildWalletSummary,
  buildWalletSummaryFromBalance,
  normalizeTopupAmount,
} from "./wallet.js";
import { buildRentalBillingSummary } from "./rental-billing.js";
import { buildProbeRunSummaries, buildRentalProbePayload } from "./probe-observability.js";
import { buildBillingMetrics, buildProbeMetrics, buildProvisioningMetrics } from "./admin-metrics.js";
import { ensureAdminUserSchema } from "./admin-users.js";
import { getManagedProbeConfig, startManagedProbeRun, syncManagedProbeRun } from "./managed-probes.js";
import { ensureProbeSchema } from "./probe-service.js";
import { ensureRentalPlacementSchema } from "./rental-placement.js";
import {
  applyRegionOverrides,
  buildAdminCapacityPayload,
  buildAdminProvidersPayload,
  buildProviderRegionOverride,
  filterPlansForAvailableRegions,
  getProviderRegionOverrideKey,
  isSupportedProvider,
  normalizeProviderId,
  normalizeProviderRegionOverride,
  type ProviderRegionOverride,
} from "./admin-providers.js";
import {
  buildAdminCreditIdempotencyKey,
  buildAdminFreezeUpdate,
  buildAdminRefundIdempotencyKey,
  normalizeAdminCreditAmount,
  normalizeAdminReason,
} from "./lib/admin-users.js";
import { normalizeProbeNodeStatus, normalizeProbePolicy, summarizeProbeResults } from "./lib/probe-service.js";
import {
  ensureProvisionAttemptSchema,
  finishProvisionAttempt,
  getProvisionAttemptNo,
  getProvisionMaxAttempts,
  calculateProvisionAttemptCloudCost,
  startProvisionAttempt,
  summarizeProvisionAttemptStageLogs,
} from "./provision-attempts.js";
import {
  attachStripeSessionToTopup,
  completeWalletTopup,
  createWalletLedgerEntry,
  createWalletTopup,
  ensureWalletSchema,
  getLatestLedgerBalance,
  getWalletTopup,
  listWalletLedgerEntries,
} from "./wallet-ledger.js";
import { buildBillingTickIdempotencyKey, calculateBillingChargeAmount, ensureBillingTickSchema } from "./billing-ticks.js";
import {
  appendAuditEvent,
  createAuditAnchorBatch,
  ensureAuditEventSchema,
  finalizeAuditAnchorBatch,
  formatAuditEvent,
  formatAuditAnchorReceipt,
  getPendingAuditAnchorBatch,
  markAuditAnchorBatchSubmitted,
  listAuditEvents,
  markAuditAnchorBatchSubmitting,
  verifyAuditAnchorBatch,
} from "./audit-events.js";
import {
  bindInviteCode,
  ensureReferralSchema,
  getReferralConsoleData,
  releaseHeldReferralRewards,
  rewardReferralForTrigger,
} from "./referrals.js";
import {
  listKnownCryptoTopupTxHashes,
  listPendingCryptoTopups,
  completeCryptoTopup,
  createCryptoTopup,
  ensureCryptoTopupSchema,
  formatCryptoTopup,
  getCryptoTopupForUser,
} from "./crypto-topups.js";
import {
  buildCompliancePolicyPayload,
  createOrUpdateComplianceProfile,
  ensureComplianceSchema,
  listComplianceProfiles,
  resolveComplianceProfile,
  validateProtocolForCompliance,
} from "./compliance.js";
import { STRICT_COMPLIANCE_PROFILE_ID, isProtocolAllowedForRelease } from "./release-profile.js";
import {
  ensureComplianceStatsSchema,
  formatComplianceStat,
  getComplianceStatByRentalId,
  listActiveRestrictedRentals,
  listComplianceStatsForRentals,
  upsertComplianceStat,
} from "./compliance-stats.js";

const STALE_PROVISIONING_MINUTES = 5;

// Stripe setup
const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" }) : null;
const versions = JSON.parse(readFileSync(resolve(process.cwd(), "../versions.json"), "utf-8")) as { frontend: string; backend: string; commit?: string };
const mailer = createMagicLinkMailer(env);

type Variables = {
  userId: string;
  traceId: string;
};

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_TTL_SECONDS = RATE_LIMIT_WINDOW_SECONDS * 2;

const adminEmails = buildAdminEmailSet(env.ADMIN_EMAILS);

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function shortHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function getRateLimitSource(c: { req: { header: (name: string) => string | undefined } }) {
  const auth = c.req.header("Authorization");
  if (auth?.startsWith("Bearer ")) {
    return `session:${shortHash(auth.slice(7))}`;
  }

  const apiSecret = c.req.header("X-API-Secret");
  if (apiSecret) {
    return `admin-secret:${shortHash(apiSecret)}`;
  }

  const forwardedFor = c.req.header("cf-connecting-ip")
    || c.req.header("x-real-ip")
    || c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
  return `ip:${forwardedFor}`;
}

function getRateLimitMax(path: string, source: string) {
  if (path === "/api/auth/me") {
    return 240;
  }
  if (path.startsWith("/api/admin/")) {
    return 300;
  }
  if (source.startsWith("session:")) {
    return 120;
  }
  if (path === "/api/auth/request-link") {
    return 30;
  }
  return 60;
}

type ProvisionQueueJobLike = {
  id?: string;
  name: string;
  data: unknown;
  failedReason?: string;
  finishedOn?: number;
  processedOn?: number;
  timestamp?: number;
  delay?: number;
  stacktrace?: string[] | null;
  attemptsMade: number;
  opts: {
    attempts?: number;
  };
  getState: () => Promise<string>;
};

type ProvisionStageStatus = "started" | "ok" | "failed" | "info" | "warn";

type ProvisionStageLog = {
  stage: string;
  status: ProvisionStageStatus;
  message: string;
  timestamp: string;
  meta?: Record<string, unknown>;
};

type ProvisionServerResponse = {
  rentalId?: string;
  vpsId?: string;
  ip?: string;
  config?: Record<string, unknown>;
  status?: string;
  debug?: {
    stageLogs?: ProvisionStageLog[];
  };
  stageLogs?: ProvisionStageLog[];
  stage?: string;
  detail?: string;
  error?: string;
  provider?: string;
  region?: string;
  plan?: string;
  rejectPackets?: number;
  rejectBytes?: number;
};

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function getProvisionJobRentalId(data: unknown) {
  const rentalId = toRecord(data).rentalId;
  return typeof rentalId === "string" ? rentalId : null;
}

function truncate(value: string, max = 500) {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function toHttpStatus(value: unknown): 400 | 401 | 402 | 403 | 404 | 409 | 500 | 503 {
  if (value === 401 || value === 402 || value === 403 || value === 404 || value === 409 || value === 500 || value === 503) {
    return value;
  }
  return 400;
}

function getTraceId(c: { get: (key: "traceId") => string | undefined; req: { header: (name: string) => string | undefined } }) {
  return c.get("traceId") || c.req.header("X-Trace-Id") || randomUUID();
}

async function recordStructuredAudit(c: {
  get: (key: "traceId" | "userId") => string | undefined;
  req: { header: (name: string) => string | undefined };
}, input: {
  eventType: string;
  actorType?: string;
  actorUserId?: string | null;
  rentalId?: string | null;
  payload?: unknown;
}) {
  try {
    await appendAuditEvent({
      traceId: getTraceId(c),
      actorType: input.actorType || (input.actorUserId || c.get("userId") ? "user" : "system"),
      actorUserId: input.actorUserId ?? c.get("userId") ?? null,
      rentalId: input.rentalId || null,
      eventType: input.eventType,
      payload: input.payload || {},
    });
  } catch (error) {
    console.error("Failed to append structured audit event:", getErrorMessage(error));
  }
}

function asProvisionStageLog(value: unknown): ProvisionStageLog | null {
  const record = toRecord(value);
  const stage = typeof record.stage === "string" ? record.stage : "";
  const message = typeof record.message === "string" ? record.message : "";
  const status = typeof record.status === "string" ? record.status : "info";
  const timestamp = typeof record.timestamp === "string" ? record.timestamp : new Date().toISOString();
  if (!stage || !message) {
    return null;
  }

  return {
    stage,
    status: ["started", "ok", "failed", "info", "warn"].includes(status)
      ? status as ProvisionStageStatus
      : "info",
    message,
    timestamp,
    meta: typeof record.meta === "object" && record.meta && !Array.isArray(record.meta)
      ? record.meta as Record<string, unknown>
      : undefined,
  };
}

function getProvisionStageLogs(body: ProvisionServerResponse) {
  const rawLogs = Array.isArray(body.debug?.stageLogs)
    ? body.debug.stageLogs
    : Array.isArray(body.stageLogs)
      ? body.stageLogs
      : [];
  return rawLogs.map(asProvisionStageLog).filter((log): log is ProvisionStageLog => Boolean(log));
}

function isValidProviderRegionId(value: string) {
  return /^[A-Za-z0-9._-]{1,80}$/.test(value);
}

function buildStageAuditDetail(log: ProvisionStageLog) {
  return truncate(JSON.stringify({
    stage: log.stage,
    status: log.status,
    message: log.message,
    timestamp: log.timestamp,
    meta: log.meta || {},
  }));
}

function parseStageAuditEntry(entry: {
  id: number;
  rentalId: string | null;
  action: string;
  detail: string | null;
  createdAt: Date | null;
}) {
  const fallback = {
    id: entry.id,
    rentalId: entry.rentalId,
    stage: "unknown",
    status: "info" as ProvisionStageStatus,
    message: entry.detail || "",
    meta: {} as Record<string, unknown>,
    createdAt: entry.createdAt,
  };

  if (!entry.detail) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(entry.detail) as Record<string, unknown>;
    const log = asProvisionStageLog(parsed);
    if (!log) {
      return fallback;
    }
    return {
      id: entry.id,
      rentalId: entry.rentalId,
      stage: log.stage,
      status: log.status,
      message: log.message,
      meta: log.meta || {},
      createdAt: entry.createdAt,
    };
  } catch {
    return fallback;
  }
}

async function insertProvisionStageAudit(rentalId: string, log: ProvisionStageLog) {
  await db.insert(auditLog).values({
    rentalId,
    action: "provision_stage",
    detail: buildStageAuditDetail(log),
  });
  await ensureRentalPlacementSchema();
  await db.update(rentals)
    .set({
      lastStage: log.stage,
      failedReason: log.status === "failed" ? log.message : undefined,
      updatedAt: new Date(),
    })
    .where(eq(rentals.id, rentalId));
}

async function insertProvisionStageAudits(rentalId: string, logs: ProvisionStageLog[]) {
  for (const log of logs) {
    await insertProvisionStageAudit(rentalId, log);
  }
}

async function readProvisionServerResponse(res: Response): Promise<ProvisionServerResponse> {
  const text = await res.text();
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as ProvisionServerResponse;
  } catch {
    return { error: truncate(text, 240) };
  }
}

function buildProvisionFailureMessage(status: number, body: ProvisionServerResponse) {
  const stage = body.stage ? ` stage=${body.stage}` : "";
  const detail = body.detail || body.error || "unknown provision error";
  return `Provision failed: ${status}${stage}: ${truncate(detail, 240)}`;
}

function sanitizeProvisionJobData(data: unknown) {
  const record = toRecord(data);
  const sanitized: Record<string, unknown> = {};
  for (const key of ["rentalId", "protocol", "durationHours", "action", "vpsId", "ip", "provider", "region", "plan", "autoRecovery"]) {
    if (record[key] !== undefined) {
      sanitized[key] = record[key];
    }
  }
  return sanitized;
}

function normalizeRegionList(value: unknown) {
  return Array.isArray(value)
    ? value
      .map((item) => typeof item === "string" ? item.trim() : "")
      .filter(isValidProviderRegionId)
    : [];
}

function orderRegionPool(regionPool: string[], preferredRegion: string) {
  const ordered = preferredRegion && isValidProviderRegionId(preferredRegion)
    ? [preferredRegion, ...regionPool]
    : regionPool;
  return [...new Set(ordered.filter(isValidProviderRegionId))];
}

function selectProvisionRegion(input: {
  preferredRegion: string;
  attemptNo: number;
  autoRecovery: boolean;
  excludedRegions?: string[];
}) {
  const pool = orderRegionPool(
    getCatalogRegionPool(process.env, input.preferredRegion),
    input.preferredRegion,
  );
  if (!input.autoRecovery) {
    return pool[0] || input.preferredRegion;
  }

  const excluded = new Set(input.excludedRegions || []);
  const available = pool.filter((region) => !excluded.has(region));
  const rotationPool = available.length > 0 ? available : pool;
  const index = Math.max(0, input.attemptNo - 1) % Math.max(1, rotationPool.length);
  return rotationPool[index] || input.preferredRegion;
}

function getUserStatus(input: { status: string; lastStage?: string | null }) {
  const stage = input.lastStage || "";
  if (input.status === "active") return "ready";
  if (input.status === "paused") return "paused";
  if (["failed", "released", "expired"].includes(input.status)) return "failed";
  if (input.status === "destroying") return "disconnecting";
  if (input.status === "destroyed") return "disconnected";
  if (stage.startsWith("stage2.5-") || stage.includes("probe")) return "optimizing";
  if (stage.startsWith("stage3-") || stage.startsWith("stage4-0") || stage.startsWith("stage4-1") || stage.startsWith("stage4-2")) {
    return "configuring";
  }
  return "preparing";
}

function getUserStatusMessage(userStatus: string, isZh = false) {
  const messages: Record<string, { zh: string; en: string }> = {
    preparing: { zh: "正在准备专属线路", en: "Preparing your private route" },
    optimizing: { zh: "正在自动优化线路", en: "Optimizing route automatically" },
    configuring: { zh: "正在生成连接配置", en: "Preparing connection profile" },
    ready: { zh: "节点已就绪", en: "Node is ready" },
    paused: { zh: "连接已暂停", en: "Connection is paused" },
    failed: { zh: "当前线路暂不可用，请稍后重试", en: "The route is temporarily unavailable. Please retry later." },
    disconnecting: { zh: "正在断开并清理资源", en: "Disconnecting and cleaning resources" },
    disconnected: { zh: "连接已断开", en: "Connection is disconnected" },
  };
  return messages[userStatus]?.[isZh ? "zh" : "en"] || messages.preparing[isZh ? "zh" : "en"];
}

function getPublicRentalStatusPayload(rental: {
  id: string;
  status: string;
  lastStage?: string | null;
  region?: string | null;
  attemptCount?: number | null;
}) {
  const userStatus = getUserStatus({ status: rental.status, lastStage: rental.lastStage });
  return {
    rentalId: rental.id,
    status: rental.status,
    userStatus,
    userMessage: getUserStatusMessage(userStatus),
    region: rental.region || null,
    regionMode: "auto",
    attemptCount: rental.attemptCount || 0,
  };
}

function toIso(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function formatPublicRentalDetails(rental: {
  id: string;
  protocol: string;
  status: string;
  provider?: string | null;
  region?: string | null;
  plan?: string | null;
  attemptCount?: number | null;
  lastStage?: string | null;
  ip?: string | null;
  vpsId?: string | null;
  durationHours: number;
  pricePerHour?: number | null;
  totalPrice?: number | null;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  complianceProfileId?: string | null;
  compliancePolicyVersion?: string | null;
  complianceEnforcedAt?: Date | string | null;
  startedAt?: Date | string | null;
  expiresAt?: Date | string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}, remainingMinutes: number) {
  const userStatus = getUserStatus({ status: rental.status, lastStage: rental.lastStage });
  const startedAt = toIso(rental.startedAt);
  const expiresAt = toIso(rental.expiresAt);
  return {
    id: rental.id,
    protocol: rental.protocol,
    status: rental.status,
    userStatus,
    userMessage: getUserStatusMessage(userStatus),
    provider: rental.provider || null,
    region: rental.region || null,
    regionMode: "auto",
    plan: rental.plan || null,
    attemptCount: rental.attemptCount || 0,
    ip: rental.ip || null,
    vpsId: rental.vpsId || null,
    vps_id: rental.vpsId || null,
    durationHours: rental.durationHours,
    duration_hours: rental.durationHours,
    pricePerHour: rental.pricePerHour ?? null,
    price_per_hour: rental.pricePerHour ?? null,
    totalPrice: rental.totalPrice ?? null,
    total_price: rental.totalPrice ?? null,
    paymentMethod: rental.paymentMethod || null,
    payment_method: rental.paymentMethod || null,
    paymentStatus: rental.paymentStatus || null,
    payment_status: rental.paymentStatus || null,
    complianceProfileId: rental.complianceProfileId || null,
    compliancePolicyVersion: rental.compliancePolicyVersion || null,
    complianceEnforcedAt: toIso(rental.complianceEnforcedAt),
    startedAt,
    started_at: startedAt,
    expiresAt,
    expires_at: expiresAt,
    createdAt: toIso(rental.createdAt),
    updatedAt: toIso(rental.updatedAt),
    remainingMinutes,
  };
}

async function serializeProvisionQueueJob(job: ProvisionQueueJobLike) {
  let state = "unknown";
  try {
    state = await job.getState();
  } catch {
    // Best-effort debug metadata only.
  }

  return {
    id: job.id ? String(job.id) : "",
    name: job.name,
    state,
    data: sanitizeProvisionJobData(job.data),
    rentalId: getProvisionJobRentalId(job.data),
    failedReason: job.failedReason || null,
    attemptsMade: job.attemptsMade,
    attempts: job.opts.attempts ?? null,
    timestamp: job.timestamp ?? null,
    processedOn: job.processedOn ?? null,
    finishedOn: job.finishedOn ?? null,
    delay: job.delay ?? 0,
    stacktrace: job.stacktrace?.slice(0, 3) || [],
  };
}

function getSerializedJobTime(job: Awaited<ReturnType<typeof serializeProvisionQueueJob>>) {
  return job.finishedOn ?? job.processedOn ?? job.timestamp ?? 0;
}

function maskEmail(email: string | null | undefined) {
  if (!email) {
    return null;
  }

  const [local, domain] = email.split("@");
  if (!domain) {
    return email.length <= 4 ? "***" : `${email.slice(0, 2)}***${email.slice(-2)}`;
  }

  const maskedLocal = local.length <= 2
    ? `${local.slice(0, 1)}***`
    : `${local.slice(0, 2)}***${local.slice(-1)}`;
  return `${maskedLocal}@${domain}`;
}

async function removePendingProvisionJobs(rentalId: string) {
  const jobs = await provisionQueue.getJobs(["waiting", "delayed"], 0, 200, false);
  let removed = 0;

  for (const job of jobs) {
    const data = toRecord(job.data);
    if (data.rentalId !== rentalId || data.action === "destroy") {
      continue;
    }

    await job.remove();
    removed += 1;
  }

  return removed;
}

async function releaseFailedProvisioningRental(
  rentalId: string,
  reason: string,
  status: "expired" | "failed" | "released" = "expired",
) {
  const updated = await db.update(rentals)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(rentals.id, rentalId), eq(rentals.status, "provisioning")))
    .returning({ id: rentals.id });

  if (updated.length === 0) {
    return false;
  }

  await db.insert(auditLog).values({
    rentalId,
    action: status === "failed" ? "rental_provision_failed" : "rental_provision_released",
    detail: reason.slice(0, 500),
  });
  await deleteCache(`rental:${rentalId}:config`);
  return true;
}

function buildProvisionUrl(path: string) {
  return `${env.PROVISION_SERVER_URL.replace(/\/+$/, "")}${path}`;
}

function getProvisionServerTimeoutMs(path: string) {
  const envName = path === "/api/provision"
    ? "PROVISION_SERVER_PROVISION_TIMEOUT_MS"
    : path === "/api/destroy"
      ? "PROVISION_SERVER_DESTROY_TIMEOUT_MS"
      : "PROVISION_SERVER_TIMEOUT_MS";
  const fallback = path === "/api/provision" ? 15 * 60_000 : path === "/api/destroy" ? 5 * 60_000 : 60_000;
  const parsed = Number(process.env[envName] || process.env.PROVISION_SERVER_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function postProvisionServer(path: string, body: Record<string, unknown>) {
  const url = buildProvisionUrl(path);
  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.PROVISION_SERVER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(getProvisionServerTimeoutMs(path)),
    });
  } catch (error) {
    throw new Error(`Provision server request failed: ${path} via ${env.PROVISION_SERVER_URL}: ${getErrorMessage(error)}`);
  }
}

async function syncComplianceStatsForRental(rentalId: string) {
  await ensureComplianceStatsSchema();
  const rental = await db.select({
    id: rentals.id,
    ip: rentals.ip,
    complianceProfileId: rentals.complianceProfileId,
    compliancePolicyVersion: rentals.compliancePolicyVersion,
  }).from(rentals).where(eq(rentals.id, rentalId)).limit(1);

  if (rental.length === 0) {
    return { ok: false as const, status: 404, error: "Rental not found" };
  }
  if (!rental[0].ip || !rental[0].complianceProfileId) {
    return { ok: false as const, status: 409, error: "Rental is not compliance-tracked yet" };
  }

  try {
    const res = await postProvisionServer("/api/compliance-stats", {
      rentalId,
      ip: rental[0].ip,
    });
    const body = await readProvisionServerResponse(res);
    if (!res.ok) {
      return {
        ok: false as const,
        status: 502,
        error: body.detail || body.error || `Compliance stats sync failed with HTTP ${res.status}`,
      };
    }

    const stat = await upsertComplianceStat({
      rentalId,
      complianceProfileId: rental[0].complianceProfileId,
      policyVersion: rental[0].compliancePolicyVersion,
      rejectPackets: body.rejectPackets,
      rejectBytes: body.rejectBytes,
      sourceIp: rental[0].ip,
      detail: typeof body.detail === "string" ? body.detail : typeof body.status === "string" ? body.status : null,
      lastSyncedAt: new Date(),
    });

    return { ok: true as const, stat };
  } catch (error) {
    return {
      ok: false as const,
      status: 502,
      error: getErrorMessage(error),
    };
  }
}

async function completeWalletTopupFromStripeSession(session: Stripe.Checkout.Session) {
  const topupId = session.metadata?.topupId;
  const userId = session.metadata?.userId;
  if (!topupId || !userId) {
    throw new Error("Wallet topup session is missing metadata");
  }

  const amount = Number(session.amount_total || 0) / 100;
  const currency = (session.currency || session.metadata?.currency || "usd").toLowerCase();
  const result = await completeWalletTopup({
    topupId,
    userId,
    stripeSessionId: session.id,
    amount,
    currency,
  });
  if (!result.alreadyProcessed) {
    try {
      await rewardReferralForTrigger({
        inviteeId: userId,
        triggerType: "wallet_topup",
        triggerId: topupId,
        triggerAmount: amount,
        currency,
      });
      await appendAuditEvent({
        traceId: `stripe:${session.id}`,
        actorType: "system",
        actorUserId: userId,
        eventType: "wallet_topup_completed",
        payload: { topupId, amount, currency, stripeSessionId: session.id },
      });
    } catch (error) {
      console.error("Wallet topup side effects failed:", getErrorMessage(error));
    }
  }
  await setCache(`stripe:${session.id}`, `topup:${topupId}`, 3600);
  return result;
}

async function getWalletAvailableBalance(userId: string) {
  const ledgerBalance = await getLatestLedgerBalance(userId);
  if (ledgerBalance) {
    return ledgerBalance.balance;
  }

  const user = await db.select({ balance: users.balance })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return Number(user[0]?.balance || 0);
}

async function getUserEmailById(userId: string) {
  const user = await db.select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return normalizeEmail(user[0]?.email || null);
}

async function getChainAccessBlock(userId: string) {
  const email = await getUserEmailById(userId);
  const access = isChainFeatureAllowed({
    chainEnvironment: env.CHAIN_ENVIRONMENT,
    whitelistEmails: env.chainWhitelistEmails,
    email,
  });
  if (access.allowed) {
    return null;
  }
  return {
    error: "This chain-backed feature is restricted to the testnet allowlist",
    code: "CHAIN_TESTNET_ALLOWLIST_REQUIRED",
    chainEnvironment: env.CHAIN_ENVIRONMENT,
    allowlistedOnly: access.allowlistedOnly,
    email,
  };
}

function buildChainModePayload(input: {
  email: string | null;
  access: ReturnType<typeof isChainFeatureAllowed>;
}) {
  const chainConfig = loadEvmChainConfig(env);
  return {
    environment: env.CHAIN_ENVIRONMENT,
    allowlistedOnly: input.access.allowlistedOnly,
    allowlisted: input.access.allowed,
    whitelistSize: env.chainWhitelistEmails.length,
    email: input.email,
    chain: {
      cryptoTopupEnabled: chainConfig.cryptoTopupEnabled,
      auditAnchorEnabled: chainConfig.auditAnchorEnabled,
      chain: chainConfig.chain,
      networkName: chainConfig.networkName,
      asset: chainConfig.asset,
      confirmationsRequired: chainConfig.confirmationsRequired,
      receiverAddress: chainConfig.receiverAddress,
      tokenAddress: chainConfig.tokenAddress,
    },
  };
}

async function getUserFreezeBlock(userId: string) {
  await ensureAdminUserSchema();
  const user = await db.select({
    isFrozen: users.isFrozen,
    freezeReason: users.freezeReason,
  })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (user[0]?.isFrozen) {
    return {
      error: "User account is frozen",
      code: "USER_FROZEN",
      reason: user[0].freezeReason || null,
    };
  }

  return null;
}

let ensureRedeemCodeModeSchemaPromise: Promise<void> | null = null;
async function ensureRedeemCodeModeSchema() {
  if (!ensureRedeemCodeModeSchemaPromise) {
    ensureRedeemCodeModeSchemaPromise = (async () => {
      await db.execute(sql`ALTER TABLE redeem_codes ADD COLUMN IF NOT EXISTS code_type TEXT NOT NULL DEFAULT 'duration'`);
      await db.execute(sql`ALTER TABLE redeem_codes ADD COLUMN IF NOT EXISTS wallet_amount REAL`);
    })();
  }
  return ensureRedeemCodeModeSchemaPromise;
}

let ensurePaymentMethodSchemaPromise: Promise<void> | null = null;
async function ensurePaymentMethodSchema() {
  if (!ensurePaymentMethodSchemaPromise) {
    ensurePaymentMethodSchemaPromise = (async () => {
      await db.execute(sql`
        DO $$
        DECLARE
          constraint_name text;
        BEGIN
          FOR constraint_name IN
            SELECT conname
            FROM pg_constraint
            WHERE conrelid = 'payments'::regclass
              AND contype = 'c'
              AND pg_get_constraintdef(oid) ILIKE '%method%'
          LOOP
            EXECUTE format('ALTER TABLE payments DROP CONSTRAINT IF EXISTS %I', constraint_name);
          END LOOP;
        END $$;
      `);
      await db.execute(sql`
        ALTER TABLE payments
        ADD CONSTRAINT payments_method_check CHECK (method IN ('stripe', 'free_trial', 'redeem_code', 'wallet', 'x402'))
      `);
    })();
  }
  return ensurePaymentMethodSchemaPromise;
}

function getRedeemCodeWalletCredit(durationHours: number) {
  const tier = getRentalPrice(durationHours);
  if (tier) {
    return tier.totalPrice;
  }
  return Math.round(durationHours * 0.4 * 100) / 100;
}

// Hono app
const app = new Hono<{ Variables: Variables }>();

// Middleware
app.use("*", cors({ origin: env.allowedOrigins }));

app.use("*", async (c, next) => {
  const incomingTrace = c.req.header("X-Trace-Id");
  const traceId = incomingTrace && /^[A-Za-z0-9._:-]{8,120}$/.test(incomingTrace)
    ? incomingTrace
    : randomUUID();
  c.set("traceId", traceId);
  await next();
  c.header("X-Trace-Id", traceId);

  if (!["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
    return;
  }
  if (["/api/payment/webhook", "/api/wallet/topups/webhook"].includes(c.req.path)) {
    return;
  }
  await recordStructuredAudit(c, {
    eventType: "http_mutation",
    actorType: c.get("userId") ? "user" : "system",
    payload: {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
    },
  });
});

// Rate limiting middleware
app.use("*", async (c, next) => {
  const path = c.req.path;
  if (path === "/api/payment/webhook" || path === "/api/wallet/topups/webhook" || path === "/health") {
    return next();
  }

  const source = getRateLimitSource(c);
  const maxRequests = getRateLimitMax(path, source);
  const key = `ratelimit:${source}:${Math.floor(Date.now() / (RATE_LIMIT_WINDOW_SECONDS * 1000))}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, RATE_LIMIT_TTL_SECONDS);
  }
  if (count > maxRequests) {
    return c.json({
      error: "Rate limit exceeded",
      retryAfterSeconds: RATE_LIMIT_WINDOW_SECONDS,
      limit: maxRequests,
    }, 429, { "Retry-After": String(RATE_LIMIT_WINDOW_SECONDS) });
  }
  await next();
});

// Auth middleware
const verifyAuth: MiddlewareHandler<{ Variables: Variables }> = async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized: missing token" }, 401);
  }

  const token = auth.slice(7);
  const userId = await redis.get(`session:${token}`);
  if (!userId) {
    return c.json({ error: "Unauthorized: invalid or expired token" }, 401);
  }

  // Refresh TTL
  await redis.expire(`session:${token}`, 86400 * 30);
  c.set("userId", userId);
  await next();
};

function verifyInternalSecret(c: { req: { header: (name: string) => string | undefined } }) {
  return c.req.header("X-API-Secret") === env.API_SECRET;
}

function verifyProbeServiceRequest(c: { req: { header: (name: string) => string | undefined } }) {
  if (verifyInternalSecret(c)) {
    return true;
  }

  const token = process.env.PROBE_SERVICE_TOKEN
    || process.env.MAINLAND_PROBE_TOKEN
    || env.PROVISION_SERVER_TOKEN;
  const auth = c.req.header("Authorization");
  return Boolean(token && auth === `Bearer ${token}`);
}

function isValidProbeId(value: string) {
  return /^[A-Za-z0-9._:-]{1,160}$/.test(value);
}

// Validation helpers
function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

type NormalizedProvisionedConfig =
  | {
    protocol: "vless-reality";
    ip: string;
    port: number;
    uuid: string;
    serverName: string;
    publicKey: string;
    shortId: string;
  }
  | {
    protocol: "hysteria2";
    ip: string;
    port: number | string;
    password: string;
    insecure: boolean;
    obfs?: string;
    domain?: string;
    sni?: string;
    pinSHA256?: string;
  };

function normalizeProvisionConfigString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeProvisionConfigPortNumber(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65535) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 && String(parsed) === trimmed) {
      return parsed;
    }
  }

  return null;
}

function normalizeProvisionHysteria2PortSpec(value: unknown): number | string | null {
  if (typeof value === "number") {
    return normalizeProvisionConfigPortNumber(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (/^\d+$/.test(normalized)) {
    const port = Number(normalized);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
  }

  const rangeMatch = normalized.match(/^(\d+)-(\d+)$/);
  if (!rangeMatch) {
    return null;
  }

  const start = Number(rangeMatch[1]);
  const end = Number(rangeMatch[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 65535 || start > end) {
    return null;
  }

  return `${start}-${end}`;
}

function normalizeProvisionConfigBoolean(value: unknown, fallback = true) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }

  return fallback;
}

function normalizeProvisionPinSHA256(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const stripped = normalized.replace(/^sha256\//, "").replace(/[:-]/g, "");
  return /^[0-9a-f]{64}$/.test(stripped) ? stripped : null;
}

function normalizeProvisionedConfig(rawConfig: unknown): { ok: true; config: NormalizedProvisionedConfig } | { ok: false; error: string } {
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    return { ok: false, error: "Deployment is not ready yet." };
  }

  const record = rawConfig as Record<string, unknown>;
  const protocol = normalizeProvisionConfigString(record.protocol);
  const ip = normalizeProvisionConfigString(record.ip);

  if (!protocol || !ip) {
    return { ok: false, error: "Deployment is not ready yet." };
  }

  if (protocol === "vless-reality") {
    const port = normalizeProvisionConfigPortNumber(record.port);
    const uuid = normalizeProvisionConfigString(record.uuid);
    const serverName = normalizeProvisionConfigString(record.serverName);
    const publicKey = normalizeProvisionConfigString(record.publicKey);
    const shortId = normalizeProvisionConfigString(record.shortId);

    if (port === null || !uuid || !serverName || !publicKey || !shortId) {
      return { ok: false, error: "Deployment is not ready yet." };
    }

    return {
      ok: true,
      config: {
        protocol,
        ip,
        port,
        uuid,
        serverName,
        publicKey,
        shortId,
      },
    };
  }

  if (protocol === "hysteria2") {
    const port = normalizeProvisionHysteria2PortSpec(record.port);
    const password = normalizeProvisionConfigString(record.password);
    if (!password || port === null) {
      return { ok: false, error: "Deployment is not ready yet." };
    }

    const obfs = normalizeProvisionConfigString(record.obfs) || undefined;
    const domain = normalizeProvisionConfigString(record.domain) || undefined;
    const sni = normalizeProvisionConfigString(record.sni) || domain || undefined;
    const pinSHA256 = normalizeProvisionPinSHA256(record.pinSHA256) || undefined;
    return {
      ok: true,
      config: {
        protocol,
        ip,
        port,
        password,
        insecure: normalizeProvisionConfigBoolean(record.insecure, true),
        ...(obfs ? { obfs } : {}),
        ...(domain ? { domain } : {}),
        ...(sni ? { sni } : {}),
        ...(pinSHA256 ? { pinSHA256 } : {}),
      },
    };
  }

  return { ok: false, error: "Deployment is not ready yet." };
}

async function issueSession(userId: string): Promise<string> {
  const token = randomUUID();
  await redis.setex(`session:${token}`, 86400 * 30, userId);
  await redis.setex(`magic-session:${token}`, 86400 * 30, userId);
  return token;
}

async function sendMagicLink(email: string, token: string, returnTo = ""): Promise<void> {
  await sendMagicLinkEmail({ mailer, env, email, token, returnTo });
}

// ============================================================
// Health
// ============================================================
app.get("/health", async (c) => {
  const missing: string[] = [];
  if (!env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!env.REDIS_URL) missing.push("REDIS_URL");
  if (!env.PROVISION_SERVER_URL) missing.push("PROVISION_SERVER_URL");
  const checks = await runHealthChecks([
    { name: "database", check: () => db.execute(sql`select 1`) },
    { name: "redis", check: () => redis.ping() },
    { name: "provision", check: () => checkProvisionServerHealth(env.PROVISION_SERVER_URL) },
  ]);
  const failed = checks.filter((check) => !check.ok);

  if (missing.length > 0 || failed.length > 0) {
    return c.json({ status: "degraded", missing, checks, version: versions.backend }, 503);
  }
  return c.json({ status: "ok", checks, version: versions.backend, timestamp: new Date().toISOString() });
});

async function readCatalogRegionOverrides(config = getCatalogRuntimeConfig()): Promise<Record<string, ProviderRegionOverride | null>> {
  const key = getProviderRegionOverrideKey(config.provider, config.region);
  const raw = await getCache<unknown>(key);
  return { [key]: normalizeProviderRegionOverride(raw) };
}

// ============================================================
// Catalog
// ============================================================
app.get("/api/catalog/regions", async (c) => {
  const config = getCatalogRuntimeConfig();
  const provider = c.req.query("provider");
  const protocol = c.req.query("protocol");
  const overrides = await readCatalogRegionOverrides(config);
  let regions = applyRegionOverrides(buildCatalogRegions(config), overrides);

  if (provider) {
    regions = regions.filter((region) => region.provider === provider.toLowerCase());
  }
  if (protocol) {
    regions = regions.filter((region) => region.protocols.includes(protocol as "vless-reality" | "hysteria2"));
  }

  return c.json({ regions });
});

app.get("/api/catalog/plans", async (c) => {
  const config = getCatalogRuntimeConfig();
  const provider = c.req.query("provider");
  const region = c.req.query("region");
  const overrides = await readCatalogRegionOverrides(config);
  let plans = filterPlansForAvailableRegions(buildCatalogPlans(config), overrides);

  if (provider) {
    plans = plans.filter((plan) => plan.provider === provider.toLowerCase());
  }
  if (region) {
    plans = plans.filter((plan) => plan.region === region);
  }

  return c.json({ plans });
});

app.get("/api/compliance/profiles", async (c) => {
  const profiles = await listComplianceProfiles();
  return c.json({ profiles });
});

// ============================================================
// Auth
// ============================================================
app.post("/api/auth/request-link", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email : "";
  const returnTo = typeof body?.returnTo === "string" ? body.returnTo : "";
  if (!email || !validateEmail(email)) {
    return c.json({ error: "Invalid email format" }, 400);
  }

  if (!mailer) {
    return c.json({
      error: "Email sign-in is temporarily unavailable because SMTP is not configured.",
      code: "AUTH_EMAIL_NOT_CONFIGURED",
    }, 503);
  }

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const userId = existing[0]?.id || randomUUID();

  if (existing.length === 0) {
    await db.insert(users).values({ id: userId, email, balance: 0 });
  }

  const magicToken = randomUUID();
  await redis.setex(`magic:${magicToken}`, 900, userId);
  try {
    await sendMagicLink(email, magicToken, returnTo);
  } catch (error) {
    await redis.del(`magic:${magicToken}`);
    console.error("Failed to send magic link:", getErrorMessage(error));
    return c.json({
      error: "Email sign-in is temporarily unavailable. Please try again later.",
      code: "AUTH_EMAIL_DELIVERY_FAILED",
    }, 502);
  }

  return c.json({ sent: true });
});

app.post("/api/auth/verify", async (c) => {
  const { token } = await c.req.json();
  if (!token || typeof token !== "string") {
    return c.json({ error: "Invalid token" }, 400);
  }

  const userId = await redis.get(`magic:${token}`);
  if (!userId) {
    return c.json({ error: "Magic link is invalid or expired" }, 401);
  }

  await redis.del(`magic:${token}`);

  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (user.length === 0) {
    return c.json({ error: "User not found" }, 404);
  }

  const sessionToken = await issueSession(userId);
  return c.json({
    userId,
    token: sessionToken,
    email: user[0].email,
    isAdmin: isAdminEmail(user[0].email, adminEmails),
  });
});

app.get("/api/auth/me", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (user.length === 0) {
    return c.json({ error: "User not found" }, 404);
  }
  return c.json({
    userId: user[0].id,
    email: user[0].email,
    isAdmin: isAdminEmail(user[0].email, adminEmails),
  });
});

// ============================================================
// Wallet
// ============================================================
app.get("/api/wallet", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const user = await db.select({
    id: users.id,
    balance: users.balance,
  }).from(users).where(eq(users.id, userId)).limit(1);

  if (user.length === 0) {
    return c.json({ error: "User not found" }, 404);
  }

  const ledgerBalance = await getLatestLedgerBalance(userId);
  const email = await getUserEmailById(userId);
  const chainAccess = isChainFeatureAllowed({
    chainEnvironment: env.CHAIN_ENVIRONMENT,
    whitelistEmails: env.chainWhitelistEmails,
    email,
  });
  const chainMode = buildChainModePayload({ email, access: chainAccess });
  if (ledgerBalance) {
    return c.json({
      ...buildWalletSummaryFromBalance({
        userId,
        balance: ledgerBalance.balance,
        currency: ledgerBalance.currency,
        source: "wallet-ledger",
      }),
      chainMode,
    });
  }

  return c.json({
    ...buildWalletSummary(user[0]),
    chainMode,
  });
});

app.get("/api/wallet/ledger", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const limitParam = Number(c.req.query("limit") || 50);
  const limit = Number.isFinite(limitParam) ? Math.min(100, Math.max(1, Math.floor(limitParam))) : 50;
  const ledgerRows = await listWalletLedgerEntries(userId, limit);
  if (ledgerRows.length > 0) {
    return c.json(buildWalletLedger(ledgerRows));
  }

  const userPayments = await db.select({
    id: payments.id,
    rentalId: payments.rentalId,
    amount: payments.amount,
    currency: payments.currency,
    method: payments.method,
    status: payments.status,
    createdAt: payments.createdAt,
  })
    .from(payments)
    .where(eq(payments.userId, userId))
    .orderBy(desc(payments.createdAt))
    .limit(limit);

  return c.json(buildLegacyWalletLedger(userPayments));
});

app.post("/api/wallet/topups/checkout", verifyAuth, async (c) => {
  if (!stripe) {
    return c.json({
      error: "Wallet topups are temporarily unavailable because Stripe is not configured.",
      code: "STRIPE_NOT_CONFIGURED",
    }, 503);
  }

  const userId = c.get("userId");
  const freezeBlock = await getUserFreezeBlock(userId);
  if (freezeBlock) {
    return c.json(freezeBlock, 403);
  }

  const body = await c.req.json().catch(() => ({})) as { amount?: unknown; currency?: string; provider?: string };
  const amount = normalizeTopupAmount(body.amount);
  const currency = (body.currency || "usd").toLowerCase();
  const provider = body.provider || "stripe";

  if (provider !== "stripe") {
    return c.json({ error: "Unsupported topup provider" }, 400);
  }
  if (currency !== "usd") {
    return c.json({ error: "Unsupported topup currency" }, 400);
  }
  if (!amount || amount < 1 || amount > 500) {
    return c.json({ error: "Topup amount must be between 1 and 500 USD" }, 400);
  }

  const user = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  if (user.length === 0) {
    return c.json({ error: "User not found" }, 404);
  }

  const topupId = randomUUID();
  await createWalletTopup({ id: topupId, userId, amount, currency, provider: "stripe" });
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    customer_email: user[0].email || undefined,
    line_items: [
      {
        price_data: {
          currency,
          product_data: {
            name: "AnixOps wallet topup",
            description: "Prepaid balance for node rentals",
          },
          unit_amount: Math.round(amount * 100),
        },
        quantity: 1,
      },
    ],
    success_url: `${env.FRONTEND_URL}/payments?topup_id=${encodeURIComponent(topupId)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.FRONTEND_URL}/payments?topup_id=${encodeURIComponent(topupId)}&cancelled=1`,
    metadata: {
      type: "wallet_topup",
      topupId,
      userId,
      amount: String(amount),
      currency,
    },
  });

  if (!session.url) {
    return c.json({ error: "Stripe did not return a checkout URL" }, 502);
  }

  await attachStripeSessionToTopup(topupId, userId, session.id);
  return c.json({
    topupId,
    checkoutUrl: session.url,
    sessionId: session.id,
    amount,
    currency,
    status: "pending",
  });
});

app.get("/api/wallet/topups/:id", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const topupId = c.req.param("id");
  const topup = await getWalletTopup(userId, topupId);
  if (!topup) {
    return c.json({ error: "Topup not found" }, 404);
  }

  return c.json({
    topup: {
      id: topup.id,
      amount: topup.amount,
      currency: topup.currency || "usd",
      provider: topup.provider,
      status: topup.status,
      stripeSessionId: topup.stripeSessionId,
      createdAt: topup.createdAt,
      completedAt: topup.completedAt,
    },
  });
});

app.post("/api/wallet/crypto-topups", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const freezeBlock = await getUserFreezeBlock(userId);
  if (freezeBlock) {
    return c.json(freezeBlock, 403);
  }
  const chainAccessBlock = await getChainAccessBlock(userId);
  if (chainAccessBlock) {
    return c.json(chainAccessBlock, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const bodyRecord = toRecord(body);
  const chainConfig = loadEvmChainConfig(env);
  const usePinnedTestnetChain = env.CHAIN_ENVIRONMENT === "testnet";
  const result = await createCryptoTopup({
    userId,
    fiatAmount: bodyRecord.fiatAmount ?? bodyRecord.amount,
    asset: usePinnedTestnetChain ? chainConfig.asset : bodyRecord.asset,
    network: usePinnedTestnetChain ? resolveCryptoTopupNetworkLabel(chainConfig.chain) : bodyRecord.network,
    rail: bodyRecord.rail,
    receiverAddress: chainConfig.receiverAddress,
    uniqueExpectedAmount: usePinnedTestnetChain && chainConfig.cryptoTopupEnabled,
  });
  if (!result.ok) {
    return c.json({ error: result.error }, toHttpStatus(result.status));
  }
  const email = await getUserEmailById(userId);
  const chainAccess = isChainFeatureAllowed({
    chainEnvironment: env.CHAIN_ENVIRONMENT,
    whitelistEmails: env.chainWhitelistEmails,
    email,
  });

  await recordStructuredAudit(c, {
    eventType: "crypto_topup_created",
    payload: {
      topupId: result.topup.id,
      asset: result.topup.asset,
      network: result.topup.network,
      rail: result.topup.rail,
      fiatAmount: result.topup.fiatAmount,
      currency: result.topup.currency,
    },
  });

  return c.json({
    topup: result.topup,
    chainMode: buildChainModePayload({ email, access: chainAccess }),
  });
});

app.get("/api/wallet/crypto-topups/:id", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const topup = await getCryptoTopupForUser(userId, c.req.param("id"));
  if (!topup) {
    return c.json({ error: "Crypto topup not found" }, 404);
  }
  return c.json({ topup });
});

app.post("/api/wallet/redeem", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const freezeBlock = await getUserFreezeBlock(userId);
  if (freezeBlock) {
    return c.json(freezeBlock, 403);
  }

  const { code } = await c.req.json().catch(() => ({})) as { code?: string };

  if (!code || typeof code !== "string" || code.length < 6 || code.length > 50) {
    return c.json({ error: "Invalid code format" }, 400);
  }

  await ensureRedeemCodeModeSchema();
  const codeRecord = await db.select().from(redeemCodes)
    .where(and(
      eq(redeemCodes.code, code),
      sql`${redeemCodes.usedBy} IS NULL`,
      or(sql`${redeemCodes.expiresAt} IS NULL`, sql`${redeemCodes.expiresAt} > NOW()`)
    )).limit(1);

  if (codeRecord.length === 0) {
    return c.json({ error: "Invalid, expired, or already used code" }, 400);
  }

  const claimed = await db.update(redeemCodes)
    .set({ usedBy: userId, usedAt: new Date() })
    .where(and(eq(redeemCodes.id, codeRecord[0].id), sql`${redeemCodes.usedBy} IS NULL`))
    .returning();
  if (claimed.length === 0) {
    return c.json({ error: "Invalid, expired, or already used code" }, 400);
  }

  const amount = claimed[0].codeType === "wallet" && Number(claimed[0].walletAmount || 0) > 0
    ? Math.round(Number(claimed[0].walletAmount) * 100) / 100
    : getRedeemCodeWalletCredit(claimed[0].durationHours);
  const ledger = await createWalletLedgerEntry({
    userId,
    type: "redeem_code_credit",
    amount,
    currency: "usd",
    idempotencyKey: `redeem:${claimed[0].id}:${userId}`,
  });

  await db.insert(auditLog).values({
    rentalId: null,
    action: "wallet_redeem_credited",
    detail: JSON.stringify({
      codeId: claimed[0].id,
      userId,
      codeType: claimed[0].codeType,
      durationHours: claimed[0].durationHours,
      amount,
      alreadyProcessed: ledger.alreadyProcessed,
    }).slice(0, 500),
  });
  await recordStructuredAudit(c, {
    eventType: "wallet_redeem_credited",
    payload: {
      codeId: claimed[0].id,
      codeType: claimed[0].codeType,
      amount,
      ledgerEntryId: ledger.ledger?.id || null,
      alreadyProcessed: ledger.alreadyProcessed,
    },
  });

  return c.json({
    balanceDelta: amount,
    currency: "usd",
    codeType: claimed[0].codeType,
    durationHours: claimed[0].durationHours,
    ledgerEntryId: ledger.ledger?.id || null,
    source: "wallet_ledger",
  });
});

app.post("/internal/crypto-topups/:id/confirm", async (c) => {
  if (!verifyInternalSecret(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const bodyRecord = toRecord(body);
  const chainConfig = loadEvmChainConfig(env);
  let receivedAmount = bodyRecord.receivedAmount;
  let confirmations = bodyRecord.confirmations;
  if (chainConfig.cryptoTopupEnabled && typeof bodyRecord.txHash === "string" && bodyRecord.txHash.trim()) {
    try {
      const topupRow = await db.select()
        .from(cryptoTopups)
        .where(eq(cryptoTopups.id, c.req.param("id")))
        .limit(1);
      if (topupRow.length === 0) {
        return c.json({ error: "Crypto topup not found" }, 404);
      }
      const verification = await verifyEvmTopupTransaction({
        txHash: bodyRecord.txHash.trim(),
        expectedAmount: Number(topupRow[0].expectedAmount || 0),
      });
      receivedAmount = verification.receivedAmount;
      confirmations = verification.confirmations;
    } catch (error) {
      return c.json({ error: getErrorMessage(error) }, 409);
    }
  }
  const result = await completeCryptoTopup({
    topupId: c.req.param("id"),
    txHash: typeof bodyRecord.txHash === "string" ? bodyRecord.txHash : "",
    receivedAmount,
    confirmations,
  });
  if (!result.ok) {
    return c.json({ error: result.error }, toHttpStatus(result.status));
  }

  if (!result.alreadyProcessed) {
    await rewardReferralForTrigger({
      inviteeId: result.topup.userId,
      triggerType: "crypto_topup",
      triggerId: result.topup.id,
      triggerAmount: result.topup.fiatAmount,
      currency: result.topup.currency,
    });
  }
  await appendAuditEvent({
    traceId: getTraceId(c),
    actorType: "system",
    actorUserId: result.topup.userId,
    eventType: "crypto_topup_completed",
    payload: {
      topupId: result.topup.id,
      asset: result.topup.asset,
      network: result.topup.network,
      fiatAmount: result.topup.fiatAmount,
      txHash: result.topup.txHash,
      alreadyProcessed: result.alreadyProcessed,
    },
  });

  return c.json({ topup: result.topup, alreadyProcessed: Boolean(result.alreadyProcessed) });
});

app.post("/internal/crypto-topups/scan", async (c) => {
  if (!verifyInternalSecret(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const chainConfig = loadEvmChainConfig(env);
  const network = resolveCryptoTopupNetworkLabel(chainConfig.chain);
  const body = await c.req.json().catch(() => ({}));
  const bodyRecord = toRecord(body);
  const limit = Number.isFinite(Number(bodyRecord.limit)) ? Math.min(1000, Math.max(1, Number(bodyRecord.limit))) : 100;
  const lookbackBlocks = Number.isFinite(Number(bodyRecord.lookbackBlocks))
    ? Math.min(250000, Math.max(1, Number(bodyRecord.lookbackBlocks)))
    : 10000;

  if (!chainConfig.cryptoTopupEnabled || !chainConfig.receiverAddress || !chainConfig.tokenAddress) {
    return c.json({
      ok: true,
      skipped: true,
      reason: "EVM topup verification is not configured",
      matches: [],
      ambiguous: 0,
      observedTransfers: 0,
      pendingTopups: 0,
      knownTxHashes: 0,
    });
  }

  const pendingTopups = await listPendingCryptoTopups({
    asset: chainConfig.asset,
    network,
    address: chainConfig.receiverAddress,
    limit,
  });

  if (pendingTopups.length === 0) {
    return c.json({
      ok: true,
      skipped: true,
      reason: "No pending crypto topups",
      matches: [],
      ambiguous: 0,
      observedTransfers: 0,
      pendingTopups: 0,
      knownTxHashes: 0,
    });
  }

  const scan = await scanAutoConfirmableEvmTopups({
    pendingTopups: pendingTopups.map((topup) => ({
      id: topup.id,
      address: topup.address,
      expectedAmount: topup.expectedAmount,
      createdAt: topup.createdAt,
      expiresAt: topup.expiresAt,
    })),
    lookbackBlocks,
  });
  const knownTxHashes = await listKnownCryptoTopupTxHashes({
    network,
    txHashes: scan.matches.map((match) => match.txHash),
  });
  const knownTxHashSet = new Set(knownTxHashes.map((value) => value.toLowerCase()));

  return c.json({
    ok: true,
    skipped: false,
    reason: null,
    chain: scan.chain,
    network: scan.network,
    currentBlock: scan.currentBlock,
    fromBlock: scan.fromBlock,
    lookbackBlocks: scan.lookbackBlocks,
    pendingTopups: pendingTopups.length,
    observedTransfers: scan.observedTransfers.length,
    ambiguous: scan.ambiguous.length,
    knownTxHashes: knownTxHashes.length,
    matches: scan.matches
      .filter((match) => !knownTxHashSet.has(match.txHash.toLowerCase()))
      .map((match) => ({
        topupId: match.topupId,
        txHash: match.txHash,
        amount: match.amount,
        confirmations: match.confirmations,
        observedAt: match.observedAt,
      })),
  });
});

app.post("/internal/audit/anchor", async (c) => {
  if (!verifyInternalSecret(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const bodyRecord = toRecord(body);
  const result = await createAuditAnchorBatch({
    limit: Number(bodyRecord.limit || 1000),
    chain: typeof bodyRecord.chain === "string" ? bodyRecord.chain : null,
    txHash: typeof bodyRecord.txHash === "string" ? bodyRecord.txHash : null,
    receipt: bodyRecord.receipt,
  });
  if (!result.ok) {
    return c.json({ error: result.error }, toHttpStatus(result.status));
  }
  await appendAuditEvent({
    traceId: getTraceId(c),
    actorType: "system",
    eventType: "audit_anchor_batch_created",
    payload: {
      batchId: result.batch.id,
      eventCount: result.batch.eventCount,
      merkleRoot: result.batch.merkleRoot,
      status: result.batch.status,
    },
  });
  return c.json({ batch: result.batch });
});

app.get("/internal/audit/anchor/pending", async (c) => {
  if (!verifyInternalSecret(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const result = await getPendingAuditAnchorBatch();
  if (!result.ok) {
    return c.json({ error: result.error }, toHttpStatus(result.status));
  }
  return c.json({ batch: result.batch });
});

app.post("/internal/audit/anchor/:id/mark-submitting", async (c) => {
  if (!verifyInternalSecret(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const result = await markAuditAnchorBatchSubmitting(c.req.param("id"));
  if (!result.ok) {
    return c.json({ error: result.error }, toHttpStatus(result.status));
  }
  return c.json({ batch: result.batch });
});

app.post("/internal/audit/anchor/:id/mark-submitted", async (c) => {
  if (!verifyInternalSecret(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const bodyRecord = toRecord(body);
  const chain = typeof bodyRecord.chain === "string" ? bodyRecord.chain.trim() : "";
  const txHash = typeof bodyRecord.txHash === "string" ? bodyRecord.txHash.trim() : "";
  if (!chain || !txHash) {
    return c.json({ error: "Missing chain or txHash" }, 400);
  }

  const result = await markAuditAnchorBatchSubmitted({
    batchId: c.req.param("id"),
    chain,
    txHash,
  });
  if (!result.ok) {
    return c.json({ error: result.error }, toHttpStatus(result.status));
  }
  return c.json({ batch: result.batch });
});

app.post("/internal/audit/anchor/:id/finalize", async (c) => {
  if (!verifyInternalSecret(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const bodyRecord = toRecord(body);
  const chain = typeof bodyRecord.chain === "string" ? bodyRecord.chain.trim() : "";
  const txHash = typeof bodyRecord.txHash === "string" ? bodyRecord.txHash.trim() : "";
  if (!chain || !txHash) {
    return c.json({ error: "Missing chain or txHash" }, 400);
  }

  const result = await finalizeAuditAnchorBatch({
    batchId: c.req.param("id"),
    chain,
    txHash,
    receipt: bodyRecord.receipt,
  });
  if (!result.ok) {
    return c.json({ error: result.error }, toHttpStatus(result.status));
  }
  await appendAuditEvent({
    traceId: getTraceId(c),
    actorType: "system",
    eventType: "audit_anchor_batch_created",
    payload: {
      batchId: result.batch.id,
      eventCount: result.batch.eventCount,
      merkleRoot: result.batch.merkleRoot,
      status: result.batch.status,
      chain: result.batch.chain,
      txHash: result.batch.txHash,
    },
  });
  return c.json({ batch: result.batch });
});

app.get("/internal/audit/anchor/:id/verify", async (c) => {
  if (!verifyInternalSecret(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const result = await verifyAuditAnchorBatch(c.req.param("id"));
  if (!result.ok && "error" in result) {
    return c.json({ error: result.error }, toHttpStatus(result.status));
  }
  if (!result.ok) {
    return c.json(result, 409);
  }
  return c.json(result);
});

app.post("/internal/compliance/stats/sync", async (c) => {
  if (!verifyInternalSecret(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const bodyRecord = toRecord(body);
  const rentalId = typeof bodyRecord.rentalId === "string" && bodyRecord.rentalId.trim()
    ? bodyRecord.rentalId.trim()
    : "";

  if (rentalId) {
    const result = await syncComplianceStatsForRental(rentalId);
    if (!result.ok) {
      return c.json({ error: result.error }, toHttpStatus(result.status));
    }
    return c.json({ synced: 1, stats: [formatComplianceStat(result.stat)] });
  }

  const limit = Number.isFinite(Number(bodyRecord.limit)) ? Math.min(500, Math.max(1, Number(bodyRecord.limit))) : 100;
  const rentalsToSync = await listActiveRestrictedRentals(limit);
  const synced = [];
  const skipped = [];
  for (const rental of rentalsToSync) {
    const result = await syncComplianceStatsForRental(rental.rentalId);
    if (result.ok) {
      synced.push(formatComplianceStat(result.stat));
    } else {
      skipped.push({ rentalId: rental.rentalId, error: result.error });
    }
  }

  return c.json({
    synced: synced.length,
    skipped,
    stats: synced,
  });
});

app.post("/api/auth/register", async (c) => {
  const { email } = await c.req.json();
  if (!email || !validateEmail(email)) {
    return c.json({ error: "Invalid email format" }, 400);
  }

  // Check if user exists
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    const token = await issueSession(existing[0].id);
    return c.json({
      userId: existing[0].id,
      token,
      email,
      exists: true,
      isAdmin: isAdminEmail(existing[0].email, adminEmails),
    });
  }

  const userId = randomUUID();
  await db.insert(users).values({ id: userId, email, balance: 0 });

  const token = await issueSession(userId);

  return c.json({ userId, token, email, isAdmin: isAdminEmail(email, adminEmails) });
});

app.post("/api/auth/login", async (c) => {
  const { email } = await c.req.json();
  if (!email) {
    return c.json({ error: "Invalid email" }, 400);
  }

  const user = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (user.length === 0) {
    return c.json({ error: "User not found" }, 404);
  }

  const token = await issueSession(user[0].id);

  return c.json({
    userId: user[0].id,
    token,
    email: user[0].email,
    isAdmin: isAdminEmail(user[0].email, adminEmails),
  });
});

// ============================================================
// Rentals
// ============================================================
app.post("/api/rental/quote", verifyAuth, async (c) => {
  const quoteId = randomUUID();
  const catalog = getCatalogRuntimeConfig();
  const body = await c.req.json();
  const quote = buildRentalQuote(body, {
    quoteId,
    provider: catalog.provider,
    defaultRegion: catalog.region,
    defaultPlan: catalog.plan,
  });

  if (!quote.ok) {
    return c.json({ error: quote.error }, 400);
  }
  if (!isProtocolAllowedForRelease(quote.quote.protocol)) {
    return c.json({ error: "Invalid protocol" }, 400);
  }

  const profileResult = await resolveComplianceProfile(toRecord(body).complianceProfileId);
  if (!profileResult.ok) {
    return c.json({ error: profileResult.error }, toHttpStatus(profileResult.status));
  }
  const complianceCheck = validateProtocolForCompliance(quote.quote.protocol, profileResult.profile);
  if (!complianceCheck.ok) {
    return c.json({ error: complianceCheck.error }, 409);
  }

  return c.json({
    ...quote.quote,
    complianceProfile: buildCompliancePolicyPayload(profileResult.profile),
  });
});

app.post("/api/rental/quick-connect", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const freezeBlock = await getUserFreezeBlock(userId);
  if (freezeBlock) {
    return c.json(freezeBlock, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const bodyRecord = toRecord(body);
  const rawDurationHours = Number(bodyRecord.durationHours || 1);
  const durationHours = Number.isFinite(rawDurationHours) ? rawDurationHours : 1;
  if (!isValidRentalDuration(durationHours)) {
    return c.json({ error: "Invalid duration" }, 400);
  }

  const protocol = "vless-reality";
  const tier = getRentalPrice(durationHours);
  if (!tier) {
    return c.json({ error: "Invalid duration" }, 400);
  }

  const activeRental = await db.select({ id: rentals.id }).from(rentals)
    .where(and(
      eq(rentals.userId, userId),
      or(eq(rentals.status, "provisioning"), eq(rentals.status, "active"), eq(rentals.status, "paused"))
    ))
    .limit(1);
  if (activeRental.length > 0) {
    return c.json({
      error: "An existing connection is already running or being prepared.",
      code: "ACTIVE_RENTAL_EXISTS",
      rentalId: activeRental[0].id,
    }, 409);
  }

  const available = await getWalletAvailableBalance(userId);
  const minimumBalance = Math.max(0.01, Math.round((tier.pricePerHour / 12) * 100) / 100);
  if (available < minimumBalance) {
    return c.json({
      error: "Wallet balance is too low to start a one-click connection.",
      code: "WALLET_BALANCE_LOW",
      balance: available,
      required: minimumBalance,
    }, 402);
  }

  const complianceResult = await resolveComplianceProfile(STRICT_COMPLIANCE_PROFILE_ID);
  if (!complianceResult.ok) {
    return c.json({ error: complianceResult.error }, toHttpStatus(complianceResult.status));
  }
  const complianceCheck = validateProtocolForCompliance(protocol, complianceResult.profile);
  if (!complianceCheck.ok) {
    return c.json({ error: complianceCheck.error }, 409);
  }

  const runtimeCatalog = getCatalogRuntimeConfig();
  const requestedRegion = typeof bodyRecord.regionPreference === "string" && isValidProviderRegionId(bodyRecord.regionPreference.trim())
    ? bodyRecord.regionPreference.trim()
    : runtimeCatalog.region;
  const region = selectProvisionRegion({
    preferredRegion: requestedRegion,
    attemptNo: 1,
    autoRecovery: true,
    excludedRegions: normalizeRegionList(bodyRecord.excludedRegions),
  });
  const rentalId = randomUUID();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + durationHours);

  await Promise.all([ensureRentalPlacementSchema(), ensureComplianceSchema()]);
  await db.insert(rentals).values({
    id: rentalId,
    userId,
    protocol,
    status: "provisioning",
    provider: runtimeCatalog.provider,
    region,
    plan: runtimeCatalog.plan,
    durationHours,
    pricePerHour: tier.pricePerHour,
    totalPrice: tier.totalPrice,
    paymentMethod: "wallet",
    paymentStatus: "paid",
    complianceProfileId: complianceResult.profile.id,
    compliancePolicyVersion: complianceResult.profile.version,
    complianceEnforcedAt: new Date(),
    expiresAt,
  });

  const paymentId = randomUUID();
  await db.insert(payments).values({
    id: paymentId,
    rentalId,
    userId,
    amount: tier.totalPrice,
    currency: "usd",
    method: "wallet",
    status: "completed",
  });
  await db.insert(auditLog).values({
    rentalId,
    action: "quick_connect_created",
    detail: JSON.stringify({
      protocol,
      durationHours,
      provider: runtimeCatalog.provider,
      region,
      plan: runtimeCatalog.plan,
      compliance: `${complianceResult.profile.id}@${complianceResult.profile.version}`,
      autoRecovery: true,
    }).slice(0, 500),
  });
  await recordStructuredAudit(c, {
    eventType: "quick_connect_created",
    rentalId,
    payload: {
      protocol,
      durationHours,
      provider: runtimeCatalog.provider,
      region,
      plan: runtimeCatalog.plan,
      complianceProfileId: complianceResult.profile.id,
      compliancePolicyVersion: complianceResult.profile.version,
      autoRecovery: true,
    },
  });

  await addProvisionJob({
    rentalId,
    protocol,
    durationHours,
    provider: runtimeCatalog.provider,
    region,
    plan: runtimeCatalog.plan,
    autoRecovery: true,
  });

  return c.json({
    ...getPublicRentalStatusPayload({
      id: rentalId,
      status: "provisioning",
      region,
      attemptCount: 0,
    }),
    totalPrice: tier.totalPrice,
    billingMode: "wallet_tick",
    pollUrl: `/api/rental/${rentalId}/progress`,
  });
});

app.post("/api/rental", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const freezeBlock = await getUserFreezeBlock(userId);
  if (freezeBlock) {
    return c.json(freezeBlock, 403);
  }

  const body = await c.req.json();
  const bodyRecord = toRecord(body);
  const protocol = typeof bodyRecord.protocol === "string" ? bodyRecord.protocol.trim() : "";
  const paymentMethod = typeof bodyRecord.paymentMethod === "string" ? bodyRecord.paymentMethod.trim() : "";
  const complianceProfileId = typeof bodyRecord.complianceProfileId === "string" ? bodyRecord.complianceProfileId : undefined;
  const rawDurationHours = Number(bodyRecord.durationHours);
  const durationHours = Number.isFinite(rawDurationHours) ? rawDurationHours : null;

  if (!isProtocolAllowedForRelease(protocol)) {
    return c.json({ error: "Invalid protocol" }, 400);
  }
  if (!protocol || durationHours === null || paymentMethod !== "wallet") {
    return c.json({
      error: "Rental checkout now accepts wallet balance only. Use the wallet topup page for Stripe, wallet, or X402 recharge.",
    }, 400);
  }

  if (!isValidRentalDuration(durationHours)) {
    return c.json({ error: "Invalid duration" }, 400);
  }

  const tier = getRentalPrice(durationHours);
  if (!tier) {
    return c.json({ error: "Invalid duration" }, 400);
  }

  const complianceResult = await resolveComplianceProfile(complianceProfileId);
  if (!complianceResult.ok) {
    return c.json({ error: complianceResult.error }, toHttpStatus(complianceResult.status));
  }
  const complianceCheck = validateProtocolForCompliance(protocol, complianceResult.profile);
  if (!complianceCheck.ok) {
    return c.json({ error: complianceCheck.error }, 409);
  }

  const activeRental = await db.select({ id: rentals.id }).from(rentals)
    .where(and(
      eq(rentals.userId, userId),
      or(eq(rentals.status, "provisioning"), eq(rentals.status, "active"), eq(rentals.status, "paused"))
    ))
    .limit(1);
  if (activeRental.length > 0) {
    return c.json({ error: "Existing rental is active, paused, or still provisioning. Destroy or finish it before creating another." }, 409);
  }

  const available = await getWalletAvailableBalance(userId);
  const minimumBalance = Math.max(0.01, Math.round((tier.pricePerHour / 12) * 100) / 100);
  if (available < minimumBalance) {
    return c.json({
      error: "Insufficient wallet balance",
      code: "WALLET_BALANCE_LOW",
      balance: available,
      required: minimumBalance,
    }, 402);
  }

  const rentalId = randomUUID();
  const catalog = getCatalogRuntimeConfig();
  const region = selectProvisionRegion({
    preferredRegion: catalog.region,
    attemptNo: 1,
    autoRecovery: true,
  });

  // Calculate expiration
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + durationHours);

  await Promise.all([ensureRentalPlacementSchema(), ensureComplianceSchema()]);
  await db.insert(rentals).values({
    id: rentalId,
    userId,
    protocol,
    status: "provisioning",
    provider: catalog.provider,
    region,
    plan: catalog.plan,
    durationHours,
    pricePerHour: tier.pricePerHour,
    totalPrice: tier.totalPrice,
    paymentMethod: "wallet",
    paymentStatus: "paid",
    complianceProfileId: complianceResult.profile.id,
    compliancePolicyVersion: complianceResult.profile.version,
    complianceEnforcedAt: new Date(),
    expiresAt,
  });

  // Record the payment method used to create this rental.
  const paymentId = randomUUID();
  await db.insert(payments).values({
    id: paymentId,
    rentalId,
    userId,
    amount: tier.totalPrice,
    currency: "usd",
    method: "wallet",
    status: "completed",
  });

  // Audit log
  await db.insert(auditLog).values({
    rentalId,
    action: "rental_created",
    detail: `protocol=${protocol}, duration=${durationHours}h, method=wallet, compliance=${complianceResult.profile.id}@${complianceResult.profile.version}`,
  });
  await recordStructuredAudit(c, {
    eventType: "rental_created",
    rentalId,
    payload: {
      protocol,
      durationHours,
      paymentMethod: "wallet",
      complianceProfileId: complianceResult.profile.id,
      compliancePolicyVersion: complianceResult.profile.version,
    },
  });

  // Queue provision
  await addProvisionJob({
    rentalId,
    protocol,
    durationHours,
    provider: catalog.provider,
    region,
    plan: catalog.plan,
    autoRecovery: true,
  });

  return c.json({
    rentalId,
    totalPrice: tier.totalPrice,
    status: "provisioning",
    billingMode: "wallet_tick",
  });
});

app.get("/api/payments", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const userPayments = await db.select({
    id: payments.id,
    rental_id: payments.rentalId,
    user_id: payments.userId,
    amount: payments.amount,
    currency: payments.currency,
    method: payments.method,
    status: payments.status,
    created_at: payments.createdAt,
    updated_at: payments.updatedAt,
    rental: {
      id: rentals.id,
      protocol: rentals.protocol,
      status: rentals.status,
      ip: rentals.ip,
      vps_id: rentals.vpsId,
      duration_hours: rentals.durationHours,
      started_at: rentals.startedAt,
      expires_at: rentals.expiresAt,
      updated_at: rentals.updatedAt,
    },
  })
    .from(payments)
    .leftJoin(rentals, eq(payments.rentalId, rentals.id))
    .where(eq(payments.userId, userId))
    .orderBy(desc(payments.createdAt));
  return c.json({ payments: userPayments });
});

app.get("/api/rentals", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const userRentals = await db.select().from(rentals).where(eq(rentals.userId, userId)).orderBy(desc(rentals.createdAt));

  const now = new Date();
  const results = userRentals.map((r) => {
    let remainingMinutes = 0;
    if (r.expiresAt && r.status === "active") {
      const remainingMs = r.expiresAt.getTime() - now.getTime();
      remainingMinutes = Math.max(0, Math.floor(remainingMs / 60000));
    }
    return { ...r, remainingMinutes };
  });

  return c.json({ rentals: results });
});

app.get("/api/rental/:id", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const rentalId = c.req.param("id");

  const rental = await db.select().from(rentals).where(and(eq(rentals.id, rentalId), eq(rentals.userId, userId))).limit(1);

  if (rental.length === 0) {
    return c.json({ error: "Rental not found" }, 404);
  }

  const now = new Date();
  const expiresAt = rental[0].expiresAt;
  const remainingMs = expiresAt ? expiresAt.getTime() - now.getTime() : 0;
  const remainingMinutes = Math.max(0, Math.floor(remainingMs / 60000));

  return c.json(formatPublicRentalDetails(rental[0], remainingMinutes));
});

app.get("/api/rental/:id/progress", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const rentalId = c.req.param("id");

  const rental = await db.select().from(rentals).where(and(eq(rentals.id, rentalId), eq(rentals.userId, userId))).limit(1);

  if (rental.length === 0) {
    return c.json({ error: "Rental not found" }, 404);
  }

  const recentStageEntries = await db.select({
    id: auditLog.id,
    rentalId: auditLog.rentalId,
    action: auditLog.action,
    detail: auditLog.detail,
    createdAt: auditLog.createdAt,
  })
    .from(auditLog)
    .where(and(eq(auditLog.rentalId, rentalId), eq(auditLog.action, "provision_stage")))
    .orderBy(desc(auditLog.createdAt))
    .limit(50);

  const progress = buildRentalProgressPayload(
    rental[0],
    recentStageEntries.map((entry) => parseStageAuditEntry(entry)),
  );
  const userStatus = getUserStatus({ status: rental[0].status, lastStage: rental[0].lastStage });

  return c.json({
    ...progress,
    userStatus,
    userMessage: getUserStatusMessage(userStatus),
    stage: userStatus,
    message: getUserStatusMessage(userStatus),
    stageLogs: [],
  });
});

app.get("/api/rental/:id/probes", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const rentalId = c.req.param("id");

  const rental = await db.select({
    id: rentals.id,
    userId: rentals.userId,
    status: rentals.status,
    lastStage: rentals.lastStage,
    ip: rentals.ip,
    vpsId: rentals.vpsId,
  }).from(rentals).where(and(eq(rentals.id, rentalId), eq(rentals.userId, userId))).limit(1);

  if (rental.length === 0) {
    return c.json({ error: "Rental not found" }, 404);
  }

  const recentProbeStageEntries = await db.select({
    id: auditLog.id,
    rentalId: auditLog.rentalId,
    action: auditLog.action,
    detail: auditLog.detail,
    createdAt: auditLog.createdAt,
  })
    .from(auditLog)
    .where(and(
      eq(auditLog.rentalId, rentalId),
      eq(auditLog.action, "provision_stage"),
      sql`${auditLog.detail} LIKE ${'%"stage":"stage2.5-%'}`,
    ))
    .orderBy(desc(auditLog.createdAt))
    .limit(100);

  const probePayload = buildRentalProbePayload(
    rental[0],
    recentProbeStageEntries.map((entry) => parseStageAuditEntry(entry)),
  );
  const userStatus = getUserStatus({ status: rental[0].status, lastStage: rental[0].lastStage });
  return c.json({
    rentalId,
    status: rental[0].status,
    userStatus,
    userMessage: getUserStatusMessage(userStatus),
    probeStatus: probePayload.current?.status || "unknown",
    decision: probePayload.summary.latestDecision,
    lastRunAt: probePayload.current?.lastEventAt || null,
  });
});

app.get("/api/rental/:id/billing", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const rentalId = c.req.param("id");

  const rental = await db.select({
    id: rentals.id,
    status: rentals.status,
    durationHours: rentals.durationHours,
    pricePerHour: rentals.pricePerHour,
    totalPrice: rentals.totalPrice,
    expiresAt: rentals.expiresAt,
  }).from(rentals).where(and(eq(rentals.id, rentalId), eq(rentals.userId, userId))).limit(1);

  if (rental.length === 0) {
    return c.json({ error: "Rental not found" }, 404);
  }

  const rentalPayments = await db.select({
    id: payments.id,
    amount: payments.amount,
    currency: payments.currency,
    method: payments.method,
    status: payments.status,
    createdAt: payments.createdAt,
  })
    .from(payments)
    .where(and(eq(payments.rentalId, rentalId), eq(payments.userId, userId)))
    .orderBy(desc(payments.createdAt))
    .limit(50);

  return c.json(buildRentalBillingSummary(rental[0], rentalPayments));
});

app.get("/api/rental/:id/config", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const rentalId = c.req.param("id");

  const rental = await db.select().from(rentals).where(and(eq(rentals.id, rentalId), eq(rentals.userId, userId))).limit(1);

  if (rental.length === 0) {
    return c.json({ error: "Rental not found" }, 404);
  }

  if (rental[0].status === "provisioning") {
    return c.json({ error: "Still provisioning" }, 202);
  }

  if (rental[0].status !== "active") {
    return c.json({ error: "Rental not active" }, 403);
  }

  const config = await redis.get(`rental:${rentalId}:config`);
  if (!config) {
    return c.json({ error: "Config not ready yet" }, 202);
  }

  try {
    const parsed = JSON.parse(config);
    const validation = normalizeProvisionedConfig(parsed);
    if (!validation.ok) {
      return c.json({ error: validation.error }, 409);
    }
    return c.json(validation.config);
  } catch {
    return c.json({ error: "Deployment is not ready yet." }, 409);
  }
});

app.get("/api/rental/:id/connection-profile", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const rentalId = c.req.param("id");

  const rental = await db.select().from(rentals).where(and(eq(rentals.id, rentalId), eq(rentals.userId, userId))).limit(1);
  if (rental.length === 0) {
    return c.json({ error: "Rental not found" }, 404);
  }

  const userStatus = getUserStatus({ status: rental[0].status, lastStage: rental[0].lastStage });
  if (rental[0].status === "provisioning") {
    return c.json({
      ...getPublicRentalStatusPayload({
        id: rental[0].id,
        status: rental[0].status,
        lastStage: rental[0].lastStage,
        region: rental[0].region,
        attemptCount: rental[0].attemptCount,
      }),
      ready: false,
    }, 202);
  }
  if (rental[0].status !== "active") {
    return c.json({
      error: getUserStatusMessage(userStatus),
      userStatus,
      ready: false,
    }, 409);
  }

  const config = await redis.get(`rental:${rentalId}:config`);
  if (!config) {
    return c.json({
      ready: false,
      userStatus: "configuring",
      userMessage: getUserStatusMessage("configuring"),
    }, 202);
  }

  try {
    const parsed = JSON.parse(config);
    const validation = normalizeProvisionedConfig(parsed);
    if (!validation.ok) {
      return c.json({
        ready: false,
        userStatus: "configuring",
        userMessage: getUserStatusMessage("configuring"),
      }, 202);
    }

    if (validation.config.protocol !== "vless-reality") {
      return c.json({ error: "Connection profile is only available for VLESS Reality nodes" }, 409);
    }

    const xrayConfig = {
      log: { loglevel: "warning" },
      inbounds: [{
        tag: "socks-in",
        listen: "127.0.0.1",
        port: 10808,
        protocol: "socks",
        settings: { udp: true },
      }],
      outbounds: [{
        tag: "proxy",
        protocol: "vless",
        settings: {
          vnext: [{
            address: validation.config.ip,
            port: validation.config.port,
            users: [{
              id: validation.config.uuid,
              encryption: "none",
              flow: "xtls-rprx-vision",
            }],
          }],
        },
        streamSettings: {
          network: "tcp",
          security: "reality",
          realitySettings: {
            fingerprint: "chrome",
            serverName: validation.config.serverName,
            publicKey: validation.config.publicKey,
            shortId: validation.config.shortId,
            spiderX: "/",
          },
        },
      }],
    };

    await recordStructuredAudit(c, {
      eventType: "connection_profile_issued",
      rentalId,
      payload: {
        protocol: validation.config.protocol,
        region: rental[0].region || null,
        client: "app",
      },
    });

    return c.json({
      ready: true,
      userStatus: "ready",
      userMessage: getUserStatusMessage("ready"),
      rentalId,
      region: rental[0].region || null,
      expiresAt: rental[0].expiresAt?.toISOString() || null,
      profileVersion: rental[0].compliancePolicyVersion || null,
      connection: validation.config,
      app: {
        core: "xray",
        systemProxy: {
          socksHost: "127.0.0.1",
          socksPort: 10808,
        },
        xrayConfig,
      },
    });
  } catch {
    return c.json({
      ready: false,
      userStatus: "configuring",
      userMessage: getUserStatusMessage("configuring"),
    }, 202);
  }
});

app.post("/api/rental/:id/pause", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const rentalId = c.req.param("id");

  const result = await db.update(rentals)
    .set({ status: "paused", pausedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(rentals.id, rentalId), eq(rentals.userId, userId), eq(rentals.status, "active")))
    .returning();

  if (result.length === 0) {
    return c.json({ error: "Cannot pause: rental not active or not found" }, 400);
  }

  await db.insert(auditLog).values({ rentalId, action: "rental_paused" });
  return c.json({ status: "paused" });
});

app.post("/api/rental/:id/resume", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const freezeBlock = await getUserFreezeBlock(userId);
  if (freezeBlock) {
    return c.json(freezeBlock, 403);
  }

  const rentalId = c.req.param("id");

  const result = await db.update(rentals)
    .set({ status: "active", pausedAt: null, updatedAt: new Date() })
    .where(and(eq(rentals.id, rentalId), eq(rentals.userId, userId), eq(rentals.status, "paused")))
    .returning();

  if (result.length === 0) {
    return c.json({ error: "Cannot resume: rental not paused or not found" }, 400);
  }

  await db.insert(auditLog).values({ rentalId, action: "rental_resumed" });
  return c.json({ status: "active" });
});

app.post("/api/rental/:id/destroy", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const rentalId = c.req.param("id");

  const result = await db.update(rentals)
    .set({ status: "destroyed", updatedAt: new Date() })
    .where(and(eq(rentals.id, rentalId), eq(rentals.userId, userId)))
    .returning();

  if (result.length === 0) {
    return c.json({ error: "Rental not found" }, 404);
  }

  const rental = result[0];
  await addProvisionJob({
    rentalId,
    action: "destroy",
    vpsId: rental.vpsId ?? undefined,
    ip: rental.ip ?? undefined,
  });

  await deleteCache(`rental:${rentalId}:config`);
  await db.insert(auditLog).values({ rentalId, action: "rental_destroyed", detail: "user_requested" });

  return c.json({ status: "destroyed" });
});

// ============================================================
// Stripe Payments
// ============================================================
if (stripe) {
  app.post("/api/payment/checkout", async (c) => {
    const body = await c.req.json();
    const { protocol, durationHours, email } = body;

    if (!protocol || !durationHours || !email) {
      return c.json({ error: "Missing required fields" }, 400);
    }
    if (!isProtocolAllowedForRelease(protocol)) {
      return c.json({ error: "Invalid protocol" }, 400);
    }

    const tier = getRentalPrice(durationHours);
    if (!tier) {
      return c.json({ error: "Invalid duration" }, 400);
    }

    const complianceResult = await resolveComplianceProfile(toRecord(body).complianceProfileId);
    if (!complianceResult.ok) {
      return c.json({ error: complianceResult.error }, toHttpStatus(complianceResult.status));
    }
    const complianceCheck = validateProtocolForCompliance(protocol, complianceResult.profile);
    if (!complianceCheck.ok) {
      return c.json({ error: complianceCheck.error }, 409);
    }

    const existingUser = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existingUser.length > 0) {
      const freezeBlock = await getUserFreezeBlock(existingUser[0].id);
      if (freezeBlock) {
        return c.json(freezeBlock, 403);
      }

      const existingProvisioning = await db.select({ id: rentals.id }).from(rentals)
        .where(and(
          eq(rentals.userId, existingUser[0].id),
          or(eq(rentals.status, "provisioning"), eq(rentals.status, "active"), eq(rentals.status, "paused"))
        ))
        .limit(1);
      if (existingProvisioning.length > 0) {
        return c.json({ error: "Existing rental is active, paused, or still provisioning. Destroy or finish it before creating another." }, 409);
      }
    }

    const catalog = getCatalogRuntimeConfig();
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `${protocol} Node Rental`,
              description: `${durationHours} hours of exclusive node access`,
            },
            unit_amount: Math.round(tier.totalPrice * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${env.FRONTEND_URL}/rental/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.FRONTEND_URL}/rental/cancel`,
      metadata: {
        protocol,
        durationHours: String(durationHours),
        email,
        provider: catalog.provider,
        region: catalog.region,
        plan: catalog.plan,
        complianceProfileId: complianceResult.profile.id,
        compliancePolicyVersion: complianceResult.profile.version,
      },
    });

    return c.json({ url: session.url, sessionId: session.id });
  });

  app.post("/api/payment/webhook", async (c) => {
    const body = await c.req.text();
    const sig = c.req.header("stripe-signature");

    if (!sig || !env.STRIPE_WEBHOOK_SECRET) {
      return c.json({ error: "No signature" }, 400);
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, sig, env.STRIPE_WEBHOOK_SECRET);
    } catch {
      return c.json({ error: "Invalid signature" }, 400);
    }

    if (event.type === "checkout.session.completed") {
      // Check for duplicate
      const processed = await redis.get(`stripe:event:${event.id}`);
      if (processed) return c.json({ received: true });

      const session = event.data.object as Stripe.Checkout.Session;
      const sessionType = session.metadata?.type || "new";

      if (sessionType === "wallet_topup") {
        await completeWalletTopupFromStripeSession(session);
      } else if (sessionType === "renewal") {
        // Handle renewal
        const { rentalId, durationHours } = session.metadata || {};
        if (!rentalId || !durationHours) {
          return c.json({ error: "Missing renewal metadata" }, 400);
        }

        const duration = parseInt(durationHours);
        const tier = getRentalPrice(duration);
        if (!tier) {
          return c.json({ error: "Invalid duration" }, 400);
        }

        const existingRental = await db.select({ expiresAt: rentals.expiresAt }).from(rentals).where(eq(rentals.id, rentalId)).limit(1);
        const renewBase = existingRental[0]?.expiresAt && existingRental[0].expiresAt > new Date()
          ? existingRental[0].expiresAt
          : new Date();
        const nextExpiresAt = new Date(renewBase);
        nextExpiresAt.setHours(nextExpiresAt.getHours() + duration);

        await db.update(rentals)
          .set({
            expiresAt: nextExpiresAt,
            durationHours: sql`${rentals.durationHours} + ${duration}`,
            totalPrice: sql`${rentals.totalPrice} + ${tier.totalPrice}`,
            updatedAt: new Date(),
          })
          .where(eq(rentals.id, rentalId));

        // Record payment
        const paymentId = randomUUID();
        const rental = await db.select({ userId: rentals.userId }).from(rentals).where(eq(rentals.id, rentalId)).limit(1);
        await db.insert(payments).values({
          id: paymentId,
          rentalId,
          userId: rental[0]?.userId || "unknown",
          amount: tier.totalPrice,
          currency: "usd",
          method: "stripe",
          stripeSessionId: session.id,
          status: "completed",
        });

        await db.insert(auditLog).values({
          rentalId,
          action: "rental_renewed",
          detail: `+${duration}h, $${tier.totalPrice}`,
        });

        await setCache(`stripe:${session.id}`, `renewal:${rentalId}`, 3600);
      } else {
        // Handle new rental
        const { protocol, durationHours, email, complianceProfileId, compliancePolicyVersion } = session.metadata || {};
        if (!protocol || !durationHours || !email) {
          return c.json({ error: "Missing metadata" }, 400);
        }
        if (!isProtocolAllowedForRelease(protocol)) {
          return c.json({ error: "Invalid protocol" }, 400);
        }

        const rentalId = randomUUID();

        // Find or create user
        const existingUser = await db.select().from(users).where(eq(users.email, email)).limit(1);
        const userId = existingUser.length > 0 ? existingUser[0].id : randomUUID();

        if (existingUser.length === 0) {
          await db.insert(users).values({ id: userId, email, balance: 0 });
        }

        const duration = parseInt(durationHours || "1");
        const tier = getRentalPrice(duration);
        if (!tier) {
          return c.json({ error: "Invalid duration" }, 400);
        }
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + duration);
        const runtimeCatalog = getCatalogRuntimeConfig();
        const preferredRegion = session.metadata?.region || runtimeCatalog.region;
        const selectedRegion = selectProvisionRegion({
          preferredRegion,
          attemptNo: 1,
          autoRecovery: true,
        });
        const placement = {
          provider: session.metadata?.provider || runtimeCatalog.provider,
          region: selectedRegion,
          plan: session.metadata?.plan || runtimeCatalog.plan,
        };

        const complianceResult = await resolveComplianceProfile(complianceProfileId);
        if (!complianceResult.ok) {
          return c.json({ error: complianceResult.error }, toHttpStatus(complianceResult.status));
        }
        const complianceCheck = validateProtocolForCompliance(protocol, complianceResult.profile);
        if (!complianceCheck.ok) {
          return c.json({ error: complianceCheck.error }, 409);
        }

        await Promise.all([ensureRentalPlacementSchema(), ensureComplianceSchema()]);
        await db.insert(rentals).values({
          id: rentalId,
          userId,
          protocol,
          status: "provisioning",
          provider: placement.provider,
          region: placement.region,
          plan: placement.plan,
          durationHours: duration,
          pricePerHour: tier.pricePerHour,
          totalPrice: tier.totalPrice,
          paymentMethod: "stripe",
          paymentStatus: "paid",
          complianceProfileId: complianceResult.profile.id,
          compliancePolicyVersion: compliancePolicyVersion || complianceResult.profile.version,
          complianceEnforcedAt: new Date(),
          expiresAt,
        });

        // Record payment
        const paymentId = randomUUID();
        await db.insert(payments).values({
          id: paymentId,
          rentalId,
          userId,
          amount: tier.totalPrice,
          currency: "usd",
          method: "stripe",
          stripeSessionId: session.id,
          status: "completed",
        });

        // Queue provision
        await addProvisionJob({
          rentalId,
          protocol,
          durationHours: duration,
          provider: placement.provider,
          region: placement.region,
          plan: placement.plan,
          autoRecovery: true,
        });
        await appendAuditEvent({
          traceId: `stripe:${session.id}`,
          actorType: "system",
          actorUserId: userId,
          rentalId,
          eventType: "rental_created",
          payload: {
            protocol,
            durationHours: duration,
            paymentMethod: "stripe",
            complianceProfileId: complianceResult.profile.id,
            compliancePolicyVersion: compliancePolicyVersion || complianceResult.profile.version,
          },
        });

        // Cache for success page
        await setCache(`stripe:${session.id}`, rentalId, 3600);
      }

      await redis.setex(`stripe:event:${event.id}`, 86400, "done");
    }

    return c.json({ received: true });
  });

  app.post("/api/wallet/topups/webhook", async (c) => {
    const body = await c.req.text();
    const sig = c.req.header("stripe-signature");

    if (!sig || !env.STRIPE_WEBHOOK_SECRET) {
      return c.json({ error: "No signature" }, 400);
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, sig, env.STRIPE_WEBHOOK_SECRET);
    } catch {
      return c.json({ error: "Invalid signature" }, 400);
    }

    const processed = await redis.get(`stripe:event:${event.id}`);
    if (processed) return c.json({ received: true });

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.metadata?.type === "wallet_topup") {
        await completeWalletTopupFromStripeSession(session);
        await redis.setex(`stripe:event:${event.id}`, 86400, "done");
      }
    }

    return c.json({ received: true });
  });

  app.post("/api/payment/renew", verifyAuth, async (c) => {
    const userId = c.get("userId");
    const freezeBlock = await getUserFreezeBlock(userId);
    if (freezeBlock) {
      return c.json(freezeBlock, 403);
    }

    const { rentalId, durationHours } = await c.req.json();

    if (!rentalId || !durationHours) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    if (!isValidRentalDuration(durationHours)) {
      return c.json({ error: "Invalid duration" }, 400);
    }

    const rental = await db.select().from(rentals)
      .where(and(
        eq(rentals.id, rentalId),
        eq(rentals.userId, userId),
        or(eq(rentals.status, "active"), eq(rentals.status, "paused"))
      )).limit(1);

    if (rental.length === 0) {
      return c.json({ error: "Rental not found or not active" }, 404);
    }

    const tier = getRentalPrice(durationHours);
    if (!tier) {
      return c.json({ error: "Invalid duration" }, 400);
    }
    const session = await stripe!.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Renew ${rental[0].protocol} Node Rental`,
              description: `+${durationHours} hours extension`,
            },
            unit_amount: Math.round(tier.totalPrice * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${env.FRONTEND_URL}/rental/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.FRONTEND_URL}/rental/cancel`,
      metadata: { rentalId, type: "renewal", durationHours: String(durationHours) },
    });

    return c.json({ url: session.url, sessionId: session.id });
  });
}

// ============================================================
// Redeem Codes
// ============================================================
app.post("/api/redeem/validate", async (c) => {
  const { code } = await c.req.json();

  if (!code || typeof code !== "string" || code.length < 6 || code.length > 50) {
    return c.json({ error: "Invalid code format" }, 400);
  }

  await ensureRedeemCodeModeSchema();
  const codeRecord = await db.select().from(redeemCodes)
    .where(and(
      eq(redeemCodes.code, code),
      sql`${redeemCodes.usedBy} IS NULL`,
      or(sql`${redeemCodes.expiresAt} IS NULL`, sql`${redeemCodes.expiresAt} > NOW()`)
    )).limit(1);

  if (codeRecord.length === 0) {
    return c.json({ error: "Invalid or expired code", valid: false }, 400);
  }

  return c.json({
    valid: true,
    codeType: codeRecord[0].codeType,
    durationHours: codeRecord[0].durationHours,
    walletAmount: codeRecord[0].walletAmount || null,
  });
});

app.post("/api/redeem", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const freezeBlock = await getUserFreezeBlock(userId);
  if (freezeBlock) {
    return c.json(freezeBlock, 403);
  }

  const body = await c.req.json();
  const { code, protocol } = body;

  if (!code || typeof code !== "string" || code.length < 6 || code.length > 50) {
    return c.json({ error: "Invalid code format" }, 400);
  }

  if (!isProtocolAllowedForRelease(protocol)) {
    return c.json({ error: "Invalid protocol" }, 400);
  }

  const complianceResult = await resolveComplianceProfile(toRecord(body).complianceProfileId);
  if (!complianceResult.ok) {
    return c.json({ error: complianceResult.error }, toHttpStatus(complianceResult.status));
  }
  const complianceCheck = validateProtocolForCompliance(protocol, complianceResult.profile);
  if (!complianceCheck.ok) {
    return c.json({ error: complianceCheck.error }, 409);
  }

  const activeRental = await db.select({ id: rentals.id }).from(rentals)
    .where(and(
      eq(rentals.userId, userId),
      or(eq(rentals.status, "provisioning"), eq(rentals.status, "active"), eq(rentals.status, "paused"))
    ))
    .limit(1);
  if (activeRental.length > 0) {
    return c.json({ error: "Existing rental is active, paused, or still provisioning. Destroy or finish it before creating another." }, 409);
  }

  await ensureRedeemCodeModeSchema();
  // Check code
  const codeRecord = await db.select().from(redeemCodes)
    .where(and(
      eq(redeemCodes.code, code),
      sql`${redeemCodes.usedBy} IS NULL`,
      or(sql`${redeemCodes.expiresAt} IS NULL`, sql`${redeemCodes.expiresAt} > NOW()`)
    )).limit(1);

  if (codeRecord.length === 0) {
    return c.json({ error: "Invalid, expired, or already used code" }, 400);
  }
  if (codeRecord[0].codeType === "wallet") {
    return c.json({ error: "This code adds wallet balance. Redeem it from the wallet endpoint." }, 409);
  }

  const durationHours = codeRecord[0].durationHours;

  // Atomically claim the code. The usedBy guard prevents concurrent double redemption.
  const claimed = await db.update(redeemCodes)
    .set({ usedBy: userId, usedAt: new Date() })
    .where(and(eq(redeemCodes.id, codeRecord[0].id), sql`${redeemCodes.usedBy} IS NULL`))
    .returning();
  if (claimed.length === 0) {
    return c.json({ error: "Invalid, expired, or already used code" }, 400);
  }

  const rentalId = randomUUID();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + durationHours);
  const catalog = getCatalogRuntimeConfig();
  const region = selectProvisionRegion({
    preferredRegion: catalog.region,
    attemptNo: 1,
    autoRecovery: true,
  });

  await Promise.all([ensureRentalPlacementSchema(), ensureComplianceSchema()]);
  await db.insert(rentals).values({
    id: rentalId,
    userId,
    protocol,
    status: "provisioning",
    provider: catalog.provider,
    region,
    plan: catalog.plan,
    durationHours,
    pricePerHour: 0,
    totalPrice: 0,
    paymentMethod: "redeem_code",
    paymentStatus: "paid",
    complianceProfileId: complianceResult.profile.id,
    compliancePolicyVersion: complianceResult.profile.version,
    complianceEnforcedAt: new Date(),
    expiresAt,
  });

  // Record payment
  const paymentId = randomUUID();
  await db.insert(payments).values({
    id: paymentId,
    rentalId,
    userId,
    amount: 0,
    currency: "usd",
    method: "redeem_code",
    status: "completed",
  });

  await db.insert(auditLog).values({
    rentalId,
    action: "rental_created",
    detail: `protocol=${protocol}, duration=${durationHours}h, method=redeem_code, compliance=${complianceResult.profile.id}@${complianceResult.profile.version}`,
  });
  await recordStructuredAudit(c, {
    eventType: "rental_created",
    rentalId,
    payload: {
      protocol,
      durationHours,
      paymentMethod: "redeem_code",
      complianceProfileId: complianceResult.profile.id,
      compliancePolicyVersion: complianceResult.profile.version,
    },
  });

  await addProvisionJob({
    rentalId,
    protocol,
    durationHours,
    provider: catalog.provider,
    region,
    plan: catalog.plan,
    autoRecovery: true,
  });

  return c.json({ rentalId, durationHours, status: "provisioning" });
});

// ============================================================
// Internal Billing
// ============================================================
app.post("/internal/billing/tick", async (c) => {
  if (!verifyInternalSecret(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => ({})) as { now?: string; limit?: number };
  const now = body.now ? new Date(body.now) : new Date();
  if (Number.isNaN(now.getTime())) {
    return c.json({ error: "Invalid now timestamp" }, 400);
  }

  const limit = Number.isFinite(body.limit) ? Math.min(500, Math.max(1, Math.floor(Number(body.limit)))) : 100;
  await Promise.all([ensureBillingTickSchema(), ensureProvisionAttemptSchema(), ensureRentalPlacementSchema()]);

  const walletRentals = await db.select({
    id: rentals.id,
    userId: rentals.userId,
    pricePerHour: rentals.pricePerHour,
    paymentMethod: rentals.paymentMethod,
    startedAt: rentals.startedAt,
    createdAt: rentals.createdAt,
    expiresAt: rentals.expiresAt,
    vpsId: rentals.vpsId,
    ip: rentals.ip,
  })
    .from(rentals)
    .where(and(eq(rentals.status, "active"), eq(rentals.paymentMethod, "wallet")))
    .limit(limit);

  const results: Array<Record<string, unknown>> = [];
  let charged = 0;
  let destroyed = 0;
  let skipped = 0;

  for (const rental of walletRentals) {
    if (!rental.userId) {
      skipped += 1;
      results.push({ rentalId: rental.id, status: "skipped", reason: "missing_user" });
      continue;
    }

    const latestTick = await db.select({ periodEnd: billingTicks.periodEnd })
      .from(billingTicks)
      .where(eq(billingTicks.rentalId, rental.id))
      .orderBy(desc(billingTicks.periodEnd))
      .limit(1);
    const periodStart = latestTick[0]?.periodEnd || rental.startedAt || rental.createdAt || now;
    const periodEnd = rental.expiresAt && rental.expiresAt < now ? rental.expiresAt : now;
    const amount = calculateBillingChargeAmount(rental.pricePerHour, periodStart, periodEnd);
    const idempotencyKey = buildBillingTickIdempotencyKey(rental.id, periodStart, periodEnd);

    if (periodEnd <= periodStart || amount <= 0) {
      skipped += 1;
      results.push({ rentalId: rental.id, status: "skipped", reason: "empty_period" });
      continue;
    }

    const existingTick = await db.select({ id: billingTicks.id })
      .from(billingTicks)
      .where(eq(billingTicks.idempotencyKey, idempotencyKey))
      .limit(1);
    if (existingTick.length > 0) {
      skipped += 1;
      results.push({ rentalId: rental.id, status: "skipped", reason: "already_charged" });
      continue;
    }

    const ledgerBalance = await getLatestLedgerBalance(rental.userId);
    const fallbackUser = ledgerBalance ? [] : await db.select({ balance: users.balance }).from(users).where(eq(users.id, rental.userId)).limit(1);
    const balance = ledgerBalance?.balance ?? Number(fallbackUser[0]?.balance || 0);
    if (balance < amount) {
      const updated = await db.update(rentals)
        .set({ status: "destroying", destroyReason: "low_balance", updatedAt: new Date() })
        .where(and(eq(rentals.id, rental.id), eq(rentals.status, "active")))
        .returning({ id: rentals.id });

      if (updated.length > 0) {
        await addProvisionJob({
          rentalId: rental.id,
          action: "destroy",
          vpsId: rental.vpsId ?? undefined,
          ip: rental.ip ?? undefined,
        });
        await db.insert(auditLog).values({
          rentalId: rental.id,
          action: "billing_low_balance_destroy",
          detail: JSON.stringify({ balance, required: amount, periodStart, periodEnd }).slice(0, 500),
        });
        destroyed += 1;
        results.push({ rentalId: rental.id, status: "destroying", balance, required: amount });
      } else {
        skipped += 1;
        results.push({ rentalId: rental.id, status: "skipped", reason: "status_changed" });
      }
      continue;
    }

    const ledger = await createWalletLedgerEntry({
      userId: rental.userId,
      type: "billing_charge",
      amount: -amount,
      currency: "usd",
      rentalId: rental.id,
      idempotencyKey,
    });
    await db.insert(billingTicks).values({
      id: randomUUID(),
      rentalId: rental.id,
      userId: rental.userId,
      periodStart,
      periodEnd,
      amount,
      status: "charged",
      idempotencyKey,
    });
    await ensureRentalPlacementSchema();
    await db.update(rentals)
      .set({
        billingStartedAt: rental.startedAt || rental.createdAt || periodStart,
        billingLastChargedAt: periodEnd,
        updatedAt: new Date(),
      })
      .where(eq(rentals.id, rental.id));
    await db.insert(auditLog).values({
      rentalId: rental.id,
      action: "billing_tick_charged",
      detail: JSON.stringify({ amount, periodStart, periodEnd, idempotencyKey }).slice(0, 500),
    });
    charged += ledger.alreadyProcessed ? 0 : 1;
    results.push({ rentalId: rental.id, status: "charged", amount, periodStart, periodEnd });
  }

  return c.json({
    charged,
    destroyed,
    skipped,
    scanned: walletRentals.length,
    results,
  });
});

app.post("/internal/billing/rentals/:id/charge", async (c) => {
  if (!verifyInternalSecret(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const rentalId = c.req.param("id");
  const body = await c.req.json().catch(() => ({})) as {
    periodStart?: unknown;
    periodEnd?: unknown;
    now?: unknown;
  };
  const now = typeof body.now === "string" ? new Date(body.now) : new Date();
  if (Number.isNaN(now.getTime())) {
    return c.json({ error: "Invalid now timestamp" }, 400);
  }

  await Promise.all([ensureBillingTickSchema(), ensureWalletSchema(), ensureRentalPlacementSchema()]);
  const rental = await db.select({
    id: rentals.id,
    userId: rentals.userId,
    status: rentals.status,
    pricePerHour: rentals.pricePerHour,
    paymentMethod: rentals.paymentMethod,
    startedAt: rentals.startedAt,
    createdAt: rentals.createdAt,
    expiresAt: rentals.expiresAt,
  })
    .from(rentals)
    .where(eq(rentals.id, rentalId))
    .limit(1);

  if (rental.length === 0) {
    return c.json({ error: "Rental not found" }, 404);
  }
  if (rental[0].status !== "active" || rental[0].paymentMethod !== "wallet" || !rental[0].userId) {
    return c.json({ error: "Rental is not an active wallet rental" }, 409);
  }

  const latestTick = await db.select({ periodEnd: billingTicks.periodEnd })
    .from(billingTicks)
    .where(eq(billingTicks.rentalId, rentalId))
    .orderBy(desc(billingTicks.periodEnd))
    .limit(1);
  const requestedStart = typeof body.periodStart === "string" ? new Date(body.periodStart) : null;
  const requestedEnd = typeof body.periodEnd === "string" ? new Date(body.periodEnd) : null;
  if ((requestedStart && Number.isNaN(requestedStart.getTime())) || (requestedEnd && Number.isNaN(requestedEnd.getTime()))) {
    return c.json({ error: "Invalid billing period" }, 400);
  }

  const periodStart = requestedStart || latestTick[0]?.periodEnd || rental[0].startedAt || rental[0].createdAt || now;
  const periodEnd = requestedEnd || (rental[0].expiresAt && rental[0].expiresAt < now ? rental[0].expiresAt : now);
  const amount = calculateBillingChargeAmount(rental[0].pricePerHour, periodStart, periodEnd);
  if (periodEnd <= periodStart || amount <= 0) {
    return c.json({ status: "skipped", reason: "empty_period", rentalId, periodStart, periodEnd });
  }

  const idempotencyKey = buildBillingTickIdempotencyKey(rentalId, periodStart, periodEnd);
  const existingTick = await db.select({ id: billingTicks.id })
    .from(billingTicks)
    .where(eq(billingTicks.idempotencyKey, idempotencyKey))
    .limit(1);
  if (existingTick.length > 0) {
    return c.json({ status: "skipped", reason: "already_charged", rentalId, idempotencyKey });
  }

  const ledgerBalance = await getLatestLedgerBalance(rental[0].userId);
  const fallbackUser = ledgerBalance ? [] : await db.select({ balance: users.balance }).from(users).where(eq(users.id, rental[0].userId)).limit(1);
  const balance = ledgerBalance?.balance ?? Number(fallbackUser[0]?.balance || 0);
  if (balance < amount) {
    return c.json({ error: "Insufficient wallet balance", code: "WALLET_BALANCE_LOW", balance, required: amount }, 402);
  }

  const ledger = await createWalletLedgerEntry({
    userId: rental[0].userId,
    type: "billing_charge",
    amount: -amount,
    currency: "usd",
    rentalId,
    idempotencyKey,
  });
  await db.insert(billingTicks).values({
    id: randomUUID(),
    rentalId,
    userId: rental[0].userId,
    periodStart,
    periodEnd,
    amount,
    status: "charged",
    idempotencyKey,
  });
  await db.update(rentals)
    .set({
      billingStartedAt: rental[0].startedAt || rental[0].createdAt || periodStart,
      billingLastChargedAt: periodEnd,
      updatedAt: new Date(),
    })
    .where(eq(rentals.id, rentalId));
  await db.insert(auditLog).values({
    rentalId,
    action: "billing_manual_charge",
    detail: JSON.stringify({ amount, periodStart, periodEnd, idempotencyKey }).slice(0, 500),
  });

  return c.json({
    rentalId,
    status: "charged",
    amount,
    periodStart,
    periodEnd,
    idempotencyKey,
    ledgerEntryId: ledger.ledger?.id || null,
    alreadyProcessed: ledger.alreadyProcessed,
  });
});

app.post("/internal/billing/rentals/:id/low-balance-destroy", async (c) => {
  if (!verifyInternalSecret(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const rentalId = c.req.param("id");
  const body = await c.req.json().catch(() => ({})) as { thresholdMinutes?: unknown };
  const thresholdMinutes = Number.isFinite(Number(body.thresholdMinutes))
    ? Math.min(120, Math.max(1, Math.floor(Number(body.thresholdMinutes))))
    : 10;

  await Promise.all([ensureWalletSchema(), ensureRentalPlacementSchema()]);
  const rental = await db.select({
    id: rentals.id,
    userId: rentals.userId,
    status: rentals.status,
    pricePerHour: rentals.pricePerHour,
    paymentMethod: rentals.paymentMethod,
    vpsId: rentals.vpsId,
    ip: rentals.ip,
  })
    .from(rentals)
    .where(eq(rentals.id, rentalId))
    .limit(1);

  if (rental.length === 0) {
    return c.json({ error: "Rental not found" }, 404);
  }
  if (rental[0].status !== "active" || rental[0].paymentMethod !== "wallet" || !rental[0].userId) {
    return c.json({ error: "Rental is not an active wallet rental" }, 409);
  }

  const required = Math.round(((rental[0].pricePerHour / 60) * thresholdMinutes) * 100) / 100;
  const ledgerBalance = await getLatestLedgerBalance(rental[0].userId);
  const fallbackUser = ledgerBalance ? [] : await db.select({ balance: users.balance }).from(users).where(eq(users.id, rental[0].userId)).limit(1);
  const balance = ledgerBalance?.balance ?? Number(fallbackUser[0]?.balance || 0);
  if (balance >= required) {
    return c.json({ rentalId, queuedDestroy: false, balance, required, thresholdMinutes });
  }

  const updated = await db.update(rentals)
    .set({
      status: "destroying",
      destroyReason: "low_balance",
      updatedAt: new Date(),
    })
    .where(and(eq(rentals.id, rentalId), eq(rentals.status, "active")))
    .returning({ id: rentals.id });
  if (updated.length === 0) {
    return c.json({ error: "Rental status changed before destroy could be queued" }, 409);
  }

  await addProvisionJob({
    rentalId,
    action: "destroy",
    vpsId: rental[0].vpsId ?? undefined,
    ip: rental[0].ip ?? undefined,
  });
  await db.insert(auditLog).values({
    rentalId,
    action: "billing_low_balance_destroy",
    detail: JSON.stringify({ balance, required, thresholdMinutes, mode: "manual" }).slice(0, 500),
  });

  return c.json({ rentalId, queuedDestroy: true, balance, required, thresholdMinutes });
});

// ============================================================
// Internal Probe Service
// ============================================================
app.post("/internal/probes/runs", async (c) => {
  if (!verifyProbeServiceRequest(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => ({})) as {
    rentalId?: unknown;
    attemptId?: unknown;
    ip?: unknown;
    port?: unknown;
    protocol?: unknown;
    policy?: unknown;
  };
  const ip = typeof body.ip === "string" && body.ip.trim() ? body.ip.trim() : "";
  const port = Number(body.port);
  if (!ip || !Number.isInteger(port) || port < 1 || port > 65535) {
    return c.json({ error: "Invalid probe target" }, 400);
  }

  const policy = normalizeProbePolicy(body.policy);
  const probeRunId = randomUUID();
  const rentalId = typeof body.rentalId === "string" && body.rentalId.trim() ? body.rentalId.trim() : null;
  const attemptId = typeof body.attemptId === "string" && body.attemptId.trim() ? body.attemptId.trim() : null;
  const protocol = typeof body.protocol === "string" && body.protocol.trim() ? body.protocol.trim() : null;

  await ensureProbeSchema();
  await db.insert(probeRuns).values({
    id: probeRunId,
    rentalId,
    attemptId,
    ip,
    port,
    protocol,
    status: "running",
    requiredNodes: policy.minNodes,
    passThreshold: policy.passRatio,
    completedNodes: 0,
  });
  const managedProbe = getManagedProbeConfig();
  if (managedProbe.provider) {
    try {
      const started = await startManagedProbeRun({
        ip,
        port,
        minNodes: policy.minNodes,
      }, managedProbe);
      if (started) {
        await db.update(probeRuns)
          .set({
            provider: started.provider,
            providerRunId: started.providerRunId,
            detail: started.detail,
            updatedAt: new Date(),
          })
          .where(eq(probeRuns.id, probeRunId));
      }
    } catch (error) {
      const detail = truncate(`Managed probe create failed: ${error instanceof Error ? error.message : String(error)}`);
      await db.update(probeRuns)
        .set({
          provider: managedProbe.provider,
          status: "failed",
          decision: "fail",
          detail,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(probeRuns.id, probeRunId));
      return c.json({ error: detail }, 502);
    }
  }
  if (rentalId) {
    await db.insert(auditLog).values({
      rentalId,
      action: "probe_run_created",
      detail: truncate(JSON.stringify({ probeRunId, attemptId, ip, port, protocol, policy })),
    });
  }

  return c.json({
    probeRunId,
    status: "running",
    requiredNodes: policy.minNodes,
    timeoutMs: policy.timeoutMs,
  });
});

app.get("/internal/probes/runs/:id", async (c) => {
  if (!verifyProbeServiceRequest(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const probeRunId = c.req.param("id");
  if (!isValidProbeId(probeRunId)) {
    return c.json({ error: "Invalid probe run id" }, 400);
  }

  await ensureProbeSchema();
  let run = await db.select().from(probeRuns).where(eq(probeRuns.id, probeRunId)).limit(1);
  if (run.length === 0) {
    return c.json({ error: "Probe run not found" }, 404);
  }
  if (run[0].status === "running" && run[0].provider && run[0].providerRunId) {
    await syncManagedProbeRun({
      id: run[0].id,
      rentalId: run[0].rentalId,
      attemptId: run[0].attemptId,
      ip: run[0].ip,
      port: run[0].port,
      protocol: run[0].protocol,
      status: run[0].status,
      requiredNodes: run[0].requiredNodes,
      passThreshold: run[0].passThreshold,
      provider: run[0].provider,
      providerRunId: run[0].providerRunId,
    });
    run = await db.select().from(probeRuns).where(eq(probeRuns.id, probeRunId)).limit(1);
  }
  const results = await db.select()
    .from(probeResults)
    .where(eq(probeResults.probeRunId, probeRunId))
    .orderBy(asc(probeResults.createdAt));

  return c.json({
    probeRunId: run[0].id,
    rentalId: run[0].rentalId,
    attemptId: run[0].attemptId,
    ip: run[0].ip,
    port: run[0].port,
    protocol: run[0].protocol,
    provider: run[0].provider,
    providerRunId: run[0].providerRunId,
    status: run[0].status,
    decision: run[0].decision,
    passRatio: run[0].passRatio,
    completedNodes: run[0].completedNodes,
    requiredNodes: run[0].requiredNodes,
    detail: run[0].detail,
    results,
  });
});

app.post("/internal/probes/results", async (c) => {
  if (!verifyProbeServiceRequest(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => ({})) as {
    probeRunId?: unknown;
    nodeId?: unknown;
    probeNodeId?: unknown;
    ok?: unknown;
    latencyMs?: unknown;
    errorCode?: unknown;
    detail?: unknown;
    rawDetail?: unknown;
  };
  const probeRunId = typeof body.probeRunId === "string" && body.probeRunId.trim() ? body.probeRunId.trim() : "";
  const probeNodeId = typeof body.probeNodeId === "string" && body.probeNodeId.trim()
    ? body.probeNodeId.trim()
    : typeof body.nodeId === "string" && body.nodeId.trim()
      ? body.nodeId.trim()
      : "";
  if (!isValidProbeId(probeRunId) || !isValidProbeId(probeNodeId)) {
    return c.json({ error: "Invalid probe run or node id" }, 400);
  }

  await ensureProbeSchema();
  const run = await db.select().from(probeRuns).where(eq(probeRuns.id, probeRunId)).limit(1);
  if (run.length === 0) {
    return c.json({ error: "Probe run not found" }, 404);
  }

  const ok = body.ok === true || body.ok === "true" || body.ok === 1;
  const latencyMs = Number.isFinite(Number(body.latencyMs)) ? Math.max(0, Math.floor(Number(body.latencyMs))) : null;
  const errorCode = typeof body.errorCode === "string" && body.errorCode.trim()
    ? body.errorCode.trim().slice(0, 120)
    : null;
  const rawDetailSource = typeof body.rawDetail === "string" ? body.rawDetail : typeof body.detail === "string" ? body.detail : "";
  const rawDetail = rawDetailSource.trim() ? rawDetailSource.trim().slice(0, 500) : null;
  const node = await db.select({ id: probeNodes.id }).from(probeNodes).where(eq(probeNodes.id, probeNodeId)).limit(1);
  if (node.length === 0) {
    await db.insert(probeNodes).values({
      id: probeNodeId,
      status: "active",
      lastSeenAt: new Date(),
    });
  }

  const existingResult = await db.select({ id: probeResults.id })
    .from(probeResults)
    .where(and(eq(probeResults.probeRunId, probeRunId), eq(probeResults.probeNodeId, probeNodeId)))
    .limit(1);
  if (existingResult.length > 0) {
    await db.update(probeResults)
      .set({ ok, latencyMs, errorCode, rawDetail, updatedAt: new Date() })
      .where(eq(probeResults.id, existingResult[0].id));
  } else {
    await db.insert(probeResults).values({
      id: randomUUID(),
      probeRunId,
      probeNodeId,
      ok,
      latencyMs,
      errorCode,
      rawDetail,
    });
  }

  const resultRows = await db.select({ ok: probeResults.ok })
    .from(probeResults)
    .where(eq(probeResults.probeRunId, probeRunId));
  const summary = summarizeProbeResults(resultRows, {
    minNodes: run[0].requiredNodes || 3,
    passRatio: run[0].passThreshold || 0.7,
  });
  const terminal = summary.status === "passed" || summary.status === "failed";
  const detail = terminal
    ? `${summary.passedNodes}/${summary.completedNodes} probe nodes passed`
    : null;
  await db.update(probeRuns)
    .set({
      status: summary.status,
      decision: summary.decision,
      passRatio: summary.passRatio,
      completedNodes: summary.completedNodes,
      detail,
      completedAt: terminal ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(probeRuns.id, probeRunId));

  return c.json({
    accepted: true,
    probeRunId,
    probeNodeId,
    status: summary.status,
    decision: summary.decision,
    passRatio: summary.passRatio,
    completedNodes: summary.completedNodes,
    requiredNodes: run[0].requiredNodes || 3,
  });
});

app.post("/internal/probes/agents/heartbeat", async (c) => {
  if (!verifyProbeServiceRequest(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => ({})) as {
    nodeId?: unknown;
    provider?: unknown;
    region?: unknown;
    province?: unknown;
    city?: unknown;
    endpoint?: unknown;
    status?: unknown;
    version?: unknown;
    weight?: unknown;
  };
  const nodeId = typeof body.nodeId === "string" && body.nodeId.trim() ? body.nodeId.trim() : "";
  if (!isValidProbeId(nodeId)) {
    return c.json({ error: "Invalid node id" }, 400);
  }

  const now = new Date();
  const weight = Number.isFinite(Number(body.weight)) && Number(body.weight) > 0 ? Number(body.weight) : 1;
  const values = {
    provider: typeof body.provider === "string" && body.provider.trim() ? body.provider.trim() : null,
    region: typeof body.region === "string" && body.region.trim() ? body.region.trim() : null,
    province: typeof body.province === "string" && body.province.trim() ? body.province.trim() : null,
    city: typeof body.city === "string" && body.city.trim() ? body.city.trim() : null,
    endpoint: typeof body.endpoint === "string" && body.endpoint.trim() ? body.endpoint.trim() : null,
    status: normalizeProbeNodeStatus(body.status),
    version: typeof body.version === "string" && body.version.trim() ? body.version.trim().slice(0, 80) : null,
    weight,
    lastSeenAt: now,
    updatedAt: now,
  };

  await ensureProbeSchema();
  const existing = await db.select({ id: probeNodes.id }).from(probeNodes).where(eq(probeNodes.id, nodeId)).limit(1);
  if (existing.length > 0) {
    await db.update(probeNodes).set(values).where(eq(probeNodes.id, nodeId));
  } else {
    await db.insert(probeNodes).values({
      id: nodeId,
      ...values,
      createdAt: now,
    });
  }

  const node = await db.select().from(probeNodes).where(eq(probeNodes.id, nodeId)).limit(1);
  return c.json({
    accepted: true,
    node: node[0],
    config: {
      heartbeatSeconds: 60,
      supportedProtocols: ["vless-reality", "hysteria2"],
    },
  });
});

// ============================================================
// Admin
// ============================================================
async function verifyAdminRequest(c: { req: { header: (name: string) => string | undefined } }) {
  const auth = c.req.header("Authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7);
    const userId = await redis.get(`session:${token}`);
    if (userId) {
      await redis.expire(`session:${token}`, 86400 * 30);
      const user = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
      if (user.length > 0 && isAdminEmail(user[0].email, adminEmails)) {
        return true;
      }
    }
  }

  const apiSecret = c.req.header("X-API-Secret");
  return apiSecret === env.API_SECRET;
}

function getAdminActor(c: { req: { header: (name: string) => string | undefined } }) {
  const auth = c.req.header("Authorization");
  if (auth?.startsWith("Bearer ")) {
    return `session:${shortHash(auth.slice(7))}`;
  }
  return c.req.header("X-API-Secret") === env.API_SECRET ? "api-secret" : null;
}

type AdminTopupLedgerRow = {
  id: string;
  userId: string;
  email: string | null;
  type: string;
  amount: number;
  currency: string | null;
  rentalId: string | null;
  topupId: string | null;
  balanceAfter: number;
  idempotencyKey: string;
  createdAt: Date | string | null;
};

function serializeAdminTopupLedgerRow(row: AdminTopupLedgerRow) {
  return {
    id: row.id,
    userId: row.userId,
    email: row.email,
    type: row.type,
    amount: Number(row.amount ?? 0),
    currency: row.currency || "usd",
    rentalId: row.rentalId,
    topupId: row.topupId,
    balanceAfter: Number(row.balanceAfter ?? 0),
    idempotencyKey: row.idempotencyKey,
    createdAt: consoleToIso(row.createdAt),
  };
}

async function getAdminTopupDetail(topupId: string) {
  await ensureWalletSchema();

  const fiatTopups = await db.select({
    id: topups.id,
    userId: topups.userId,
    email: users.email,
    provider: topups.provider,
    amount: topups.amount,
    currency: topups.currency,
    status: topups.status,
    stripeSessionId: topups.stripeSessionId,
    createdAt: topups.createdAt,
    completedAt: topups.completedAt,
    updatedAt: topups.updatedAt,
  })
    .from(topups)
    .leftJoin(users, eq(topups.userId, users.id))
    .where(eq(topups.id, topupId))
    .limit(1);

  if (fiatTopups.length > 0) {
    const ledgerRows = await db.select({
      id: walletLedger.id,
      userId: walletLedger.userId,
      email: users.email,
      type: walletLedger.type,
      amount: walletLedger.amount,
      currency: walletLedger.currency,
      rentalId: walletLedger.rentalId,
      topupId: walletLedger.topupId,
      balanceAfter: walletLedger.balanceAfter,
      idempotencyKey: walletLedger.idempotencyKey,
      createdAt: walletLedger.createdAt,
    })
      .from(walletLedger)
      .leftJoin(users, eq(walletLedger.userId, users.id))
      .where(eq(walletLedger.topupId, topupId))
      .orderBy(desc(walletLedger.createdAt))
      .limit(1);

    const topup = fiatTopups[0];
    return {
      kind: "fiat" as const,
      topup: {
        kind: "fiat" as const,
        id: topup.id,
        userId: topup.userId,
        email: topup.email,
        provider: topup.provider,
        amount: Number(topup.amount ?? 0),
        currency: topup.currency || "usd",
        status: topup.status,
        stripeSessionId: topup.stripeSessionId,
        createdAt: consoleToIso(topup.createdAt),
        completedAt: consoleToIso(topup.completedAt),
        updatedAt: consoleToIso(topup.updatedAt),
      },
      walletLedger: ledgerRows[0] ? serializeAdminTopupLedgerRow(ledgerRows[0]) : null,
    };
  }

  await ensureCryptoTopupSchema();
  const cryptoTopupsRows = await db.select({
    id: cryptoTopups.id,
    userId: cryptoTopups.userId,
    email: users.email,
    asset: cryptoTopups.asset,
    network: cryptoTopups.network,
    rail: cryptoTopups.rail,
    address: cryptoTopups.address,
    expectedAmount: cryptoTopups.expectedAmount,
    receivedAmount: cryptoTopups.receivedAmount,
    fiatAmount: cryptoTopups.fiatAmount,
    currency: cryptoTopups.currency,
    status: cryptoTopups.status,
    txHash: cryptoTopups.txHash,
    confirmations: cryptoTopups.confirmations,
    ledgerId: cryptoTopups.ledgerId,
    createdAt: cryptoTopups.createdAt,
    expiresAt: cryptoTopups.expiresAt,
    completedAt: cryptoTopups.completedAt,
    updatedAt: cryptoTopups.updatedAt,
  })
    .from(cryptoTopups)
    .leftJoin(users, eq(cryptoTopups.userId, users.id))
    .where(eq(cryptoTopups.id, topupId))
    .limit(1);

  if (cryptoTopupsRows.length === 0) {
    return null;
  }

  const cryptoTopup = cryptoTopupsRows[0];
  const ledgerRows = await db.select({
    id: walletLedger.id,
    userId: walletLedger.userId,
    email: users.email,
    type: walletLedger.type,
    amount: walletLedger.amount,
    currency: walletLedger.currency,
    rentalId: walletLedger.rentalId,
    topupId: walletLedger.topupId,
    balanceAfter: walletLedger.balanceAfter,
    idempotencyKey: walletLedger.idempotencyKey,
    createdAt: walletLedger.createdAt,
  })
    .from(walletLedger)
    .leftJoin(users, eq(walletLedger.userId, users.id))
    .where(eq(walletLedger.topupId, topupId))
    .orderBy(desc(walletLedger.createdAt))
    .limit(1);

  let linkedLedger = ledgerRows[0] || null;
  if (!linkedLedger && cryptoTopup.ledgerId) {
    const fallbackLedgerRows = await db.select({
      id: walletLedger.id,
      userId: walletLedger.userId,
      email: users.email,
      type: walletLedger.type,
      amount: walletLedger.amount,
      currency: walletLedger.currency,
      rentalId: walletLedger.rentalId,
      topupId: walletLedger.topupId,
      balanceAfter: walletLedger.balanceAfter,
      idempotencyKey: walletLedger.idempotencyKey,
      createdAt: walletLedger.createdAt,
    })
      .from(walletLedger)
      .leftJoin(users, eq(walletLedger.userId, users.id))
      .where(eq(walletLedger.id, cryptoTopup.ledgerId))
      .limit(1);
    linkedLedger = fallbackLedgerRows[0] || null;
  }

  return {
    kind: "crypto" as const,
    topup: {
      kind: "crypto" as const,
      id: cryptoTopup.id,
      userId: cryptoTopup.userId,
      email: cryptoTopup.email,
      asset: cryptoTopup.asset,
      network: cryptoTopup.network,
      rail: cryptoTopup.rail || "wallet",
      address: cryptoTopup.address,
      expectedAmount: Number(cryptoTopup.expectedAmount ?? 0),
      receivedAmount: cryptoTopup.receivedAmount == null ? null : Number(cryptoTopup.receivedAmount),
      fiatAmount: Number(cryptoTopup.fiatAmount ?? 0),
      currency: cryptoTopup.currency || "usd",
      status: cryptoTopup.status,
      txHash: cryptoTopup.txHash || null,
      confirmations: Number(cryptoTopup.confirmations || 0),
      ledgerId: cryptoTopup.ledgerId || null,
      createdAt: consoleToIso(cryptoTopup.createdAt),
      expiresAt: consoleToIso(cryptoTopup.expiresAt),
      completedAt: consoleToIso(cryptoTopup.completedAt),
      updatedAt: consoleToIso(cryptoTopup.updatedAt),
    },
    walletLedger: linkedLedger ? serializeAdminTopupLedgerRow(linkedLedger) : null,
  };
}

function parseBoundedLimit(value: string | undefined, fallback: number, max: number) {
  const parsed = Number(value || fallback);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(1, Math.floor(parsed))) : fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getProbeStageWhere(rentalId?: string) {
  const base = and(
    eq(auditLog.action, "provision_stage"),
    sql`${auditLog.detail} LIKE ${'%"stage":"stage2.5-%'}`,
  );

  return rentalId ? and(base, eq(auditLog.rentalId, rentalId)) : base;
}

async function readRecentProbeStageEntries(limit: number, rentalId?: string) {
  return db.select({
    id: auditLog.id,
    rentalId: auditLog.rentalId,
    action: auditLog.action,
    detail: auditLog.detail,
    createdAt: auditLog.createdAt,
  })
    .from(auditLog)
    .where(getProbeStageWhere(rentalId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}

async function getAdminRentalProbeContexts(rentalIds: string[]) {
  if (rentalIds.length === 0) {
    return new Map<string, {
      rentalId: string;
      email: string | null;
      protocol: string;
      status: string;
      ip: string | null;
      vpsId: string | null;
      createdAt: Date | null;
      updatedAt: Date | null;
    }>();
  }

  await ensureRentalPlacementSchema();
  const rows = await db.select({
    rentalId: rentals.id,
    email: users.email,
    protocol: rentals.protocol,
    status: rentals.status,
    provider: rentals.provider,
    region: rentals.region,
    plan: rentals.plan,
    attemptCount: rentals.attemptCount,
    lastStage: rentals.lastStage,
    failedReason: rentals.failedReason,
    ip: rentals.ip,
    vpsId: rentals.vpsId,
    createdAt: rentals.createdAt,
    updatedAt: rentals.updatedAt,
  })
    .from(rentals)
    .leftJoin(users, eq(rentals.userId, users.id))
    .where(inArray(rentals.id, rentalIds));

  return new Map(rows.map((row) => [row.rentalId, {
    ...row,
    email: maskEmail(row.email),
  }]));
}

app.get("/api/admin/providers", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const config = getCatalogRuntimeConfig();
  const overrides = await readCatalogRegionOverrides(config);

  return c.json(buildAdminProvidersPayload({
    config,
    regions: buildCatalogRegions(config),
    plans: buildCatalogPlans(config),
    overrides,
    source: process.env,
  }));
});

app.post("/api/admin/providers/:provider/check", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const provider = normalizeProviderId(c.req.param("provider"));
  if (!isSupportedProvider(provider)) {
    return c.json({ error: "Unsupported provider" }, 400);
  }

  const config = getCatalogRuntimeConfig();
  const body = await c.req.json().catch(() => ({})) as { region?: unknown; plan?: unknown };
  const region = typeof body.region === "string" && body.region.trim() ? body.region.trim() : config.region;
  const plan = typeof body.plan === "string" && body.plan.trim() ? body.plan.trim() : config.plan;
  if (!isValidProviderRegionId(region)) {
    return c.json({ error: "Invalid region" }, 400);
  }

  const res = await postProvisionServer("/api/provider-check", { provider, region, plan });
  const responseBody = await readProvisionServerResponse(res);
  return c.json({
    ok: res.ok,
    status: res.status,
    provider: typeof responseBody.provider === "string" ? responseBody.provider : provider,
    region: typeof responseBody.region === "string" ? responseBody.region : region,
    plan: typeof responseBody.plan === "string" ? responseBody.plan : plan,
    stageLogs: getProvisionStageLogs(responseBody),
    error: responseBody.error || responseBody.detail || null,
  }, res.ok ? 200 : 502);
});

app.patch("/api/admin/providers/:provider/regions/:region", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const provider = normalizeProviderId(c.req.param("provider"));
  const region = c.req.param("region").trim();
  if (!isSupportedProvider(provider)) {
    return c.json({ error: "Unsupported provider" }, 400);
  }
  if (!isValidProviderRegionId(region)) {
    return c.json({ error: "Invalid region" }, 400);
  }

  const body = await c.req.json().catch(() => ({})) as {
    status?: unknown;
    enabled?: unknown;
    reason?: unknown;
  };
  if (
    typeof body.status === "string" &&
    !["available", "disabled", "degraded"].includes(body.status.trim().toLowerCase())
  ) {
    return c.json({ error: "Invalid region status" }, 400);
  }

  const override = buildProviderRegionOverride({
    status: body.status,
    enabled: body.enabled,
    reason: body.reason,
    updatedBy: getAdminActor(c),
  });
  const key = getProviderRegionOverrideKey(provider, region);
  await setCache(key, override);
  await db.insert(auditLog).values({
    rentalId: null,
    action: "admin_provider_region_updated",
    detail: truncate(JSON.stringify({ provider, region, override })),
  });

  return c.json({ provider, region, override });
});

app.get("/api/admin/capacity", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await Promise.all([ensureProvisionAttemptSchema(), ensureRentalPlacementSchema()]);
  const [statusCounts, attemptRows, rentalPlacementRows, queueCounts] = await Promise.all([
    db.select({
      status: rentals.status,
      count: sql<number>`count(*)::int`,
    })
      .from(rentals)
      .groupBy(rentals.status),
    db.select({
      provider: provisionAttempts.provider,
      region: provisionAttempts.region,
      plan: provisionAttempts.plan,
      status: provisionAttempts.status,
      count: sql<number>`count(*)::int`,
      cloudCostAmount: sql<number>`coalesce(sum(${provisionAttempts.cloudCostAmount}), 0)`,
    })
      .from(provisionAttempts)
      .groupBy(provisionAttempts.provider, provisionAttempts.region, provisionAttempts.plan, provisionAttempts.status),
    db.select({
      provider: rentals.provider,
      region: rentals.region,
      plan: rentals.plan,
      status: rentals.status,
      count: sql<number>`count(*)::int`,
    })
      .from(rentals)
      .groupBy(rentals.provider, rentals.region, rentals.plan, rentals.status),
    provisionQueue.getJobCounts("waiting", "active", "delayed", "failed", "completed", "paused"),
  ]);

  return c.json(buildAdminCapacityPayload({
    config: getCatalogRuntimeConfig(),
    statusCounts,
    attemptRows,
    rentalPlacementRows,
    queueCounts,
  }));
});

app.get("/api/admin/metrics/provisioning", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await ensureProvisionAttemptSchema();
  const [rentalStatusRows, attemptStatusRows, queueCounts] = await Promise.all([
    db.select({
      key: rentals.status,
      count: sql<number>`count(*)::int`,
    })
      .from(rentals)
      .groupBy(rentals.status),
    db.select({
      key: provisionAttempts.status,
      count: sql<number>`count(*)::int`,
      amount: sql<number>`coalesce(sum(${provisionAttempts.cloudCostAmount}), 0)`,
    })
      .from(provisionAttempts)
      .groupBy(provisionAttempts.status),
    provisionQueue.getJobCounts("waiting", "active", "delayed", "failed", "completed", "paused"),
  ]);

  return c.json(buildProvisioningMetrics({
    rentalStatusRows,
    attemptStatusRows,
    queueCounts,
  }));
});

app.get("/api/admin/metrics/billing", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await Promise.all([ensureWalletSchema(), ensureBillingTickSchema()]);
  const [ledgerRows, tickRows, topupRows, walletRentalRows] = await Promise.all([
    db.select({
      key: walletLedger.type,
      count: sql<number>`count(*)::int`,
      amount: sql<number>`coalesce(sum(${walletLedger.amount}), 0)`,
    })
      .from(walletLedger)
      .groupBy(walletLedger.type),
    db.select({
      key: billingTicks.status,
      count: sql<number>`count(*)::int`,
      amount: sql<number>`coalesce(sum(${billingTicks.amount}), 0)`,
    })
      .from(billingTicks)
      .groupBy(billingTicks.status),
    db.select({
      key: topups.status,
      count: sql<number>`count(*)::int`,
      amount: sql<number>`coalesce(sum(${topups.amount}), 0)`,
    })
      .from(topups)
      .groupBy(topups.status),
    db.select({
      key: rentals.status,
      count: sql<number>`count(*)::int`,
    })
      .from(rentals)
      .where(eq(rentals.paymentMethod, "wallet"))
      .groupBy(rentals.status),
  ]);

  return c.json(buildBillingMetrics({
    ledgerRows,
    tickRows,
    topupRows,
    walletRentalRows,
  }));
});

app.get("/api/admin/metrics/probes", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const scanLimit = parseBoundedLimit(c.req.query("scanLimit"), 2000, 5000);
  const entries = await readRecentProbeStageEntries(scanLimit);
  const stageLogs = entries.map((entry) => parseStageAuditEntry(entry));
  const runs = buildProbeRunSummaries(stageLogs);

  return c.json(buildProbeMetrics({
    scannedEvents: stageLogs.length,
    runs,
  }));
});

app.get("/api/admin/compliance/profiles", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const profiles = await listComplianceProfiles();
  return c.json({ profiles });
});

app.post("/api/admin/compliance/profiles", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const profile = await createOrUpdateComplianceProfile(await c.req.json().catch(() => ({})));
  if (!profile) {
    return c.json({ error: "Failed to save compliance profile" }, 500);
  }
  await recordStructuredAudit(c, {
    eventType: "compliance_profile_saved",
    actorType: "admin",
    payload: { profileId: profile.id, version: profile.version, mode: profile.mode },
  });
  return c.json({ profile });
});

app.get("/api/admin/compliance/stats", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const limit = parseBoundedLimit(c.req.query("limit"), 50, 200);
  const rentalsToSync = c.req.query("sync") === "1"
    ? await listActiveRestrictedRentals(limit)
    : [];

  for (const rental of rentalsToSync) {
    await syncComplianceStatsForRental(rental.rentalId).catch(() => null);
  }

  const rows = await db.select({
    id: rentals.id,
    userId: rentals.userId,
    ip: rentals.ip,
    status: rentals.status,
    complianceProfileId: rentals.complianceProfileId,
    compliancePolicyVersion: rentals.compliancePolicyVersion,
  }).from(rentals)
    .where(sql`${rentals.complianceProfileId} IS NOT NULL`)
    .limit(limit);
  const profiles = await listComplianceProfiles();
  const stats = await listComplianceStatsForRentals(rows.map((row) => row.id));
  const statMap = new Map(stats.map((stat) => [stat.rentalId, stat]));
  const syncedStats = stats.filter((stat) => Boolean(stat.lastSyncedAt));
  const latestSyncedAt = syncedStats.length > 0 ? syncedStats[0].lastSyncedAt : null;

  return c.json({
    summary: {
      trackedRentals: rows.length,
      syncedRentals: syncedStats.length,
      profileCount: new Set(rows.map((row) => row.complianceProfileId).filter((value): value is string => Boolean(value))).size,
      rejectPackets: stats.reduce((total, stat) => total + (stat.rejectPackets || 0), 0),
      rejectBytes: stats.reduce((total, stat) => total + (stat.rejectBytes || 0), 0),
      latestSyncedAt: latestSyncedAt ? latestSyncedAt.toISOString() : null,
    },
    profiles,
    rentals: rows.map((row) => ({
      rentalId: row.id,
      userId: row.userId,
      ip: row.ip,
      status: row.status,
      complianceProfileId: row.complianceProfileId,
      compliancePolicyVersion: row.compliancePolicyVersion,
      stats: formatComplianceStat(statMap.get(row.id) || null),
    })),
  });
});

app.get("/api/admin/audit/events", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const limit = parseBoundedLimit(c.req.query("limit"), 50, 200);
  const events = await listAuditEvents(limit);
  return c.json({ events: events.map(formatAuditEvent), limit });
});

app.post("/api/admin/audit/anchors/:id/verify", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const result = await verifyAuditAnchorBatch(c.req.param("id"));
  if (!result.ok && "error" in result) {
    return c.json({ error: result.error }, toHttpStatus(result.status));
  }
  if (!result.ok) {
    return c.json(result, 409);
  }
  return c.json(result);
});

app.get("/api/admin/users/:id/ledger", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const userId = c.req.param("id");
  const limit = parseBoundedLimit(c.req.query("limit"), 50, 200);
  await Promise.all([ensureAdminUserSchema(), ensureWalletSchema()]);
  const user = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (user.length === 0) {
    return c.json({ error: "User not found" }, 404);
  }

  const entries = await db.select()
    .from(walletLedger)
    .where(eq(walletLedger.userId, userId))
    .orderBy(desc(walletLedger.createdAt))
    .limit(limit);

  return c.json({ userId, entries, limit });
});

app.post("/api/admin/users/:id/credit", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const userId = c.req.param("id");
  const requestBody = await c.req.json().catch(() => ({})) as {
    amount?: unknown;
    currency?: unknown;
    reason?: unknown;
    idempotencyKey?: unknown;
  };
  const amount = normalizeAdminCreditAmount(requestBody.amount);
  if (amount === null) {
    return c.json({ error: "Amount must be greater than 0 and no more than 10000" }, 400);
  }

  const currency = typeof requestBody.currency === "string" && requestBody.currency.trim()
    ? requestBody.currency.trim().toLowerCase()
    : "usd";
  if (currency !== "usd") {
    return c.json({ error: "Unsupported currency" }, 400);
  }

  const rawIdempotencyKey = c.req.header("Idempotency-Key")
    || (typeof requestBody.idempotencyKey === "string" ? requestBody.idempotencyKey : "");
  if (!rawIdempotencyKey.trim()) {
    return c.json({ error: "Idempotency-Key is required" }, 400);
  }

  await Promise.all([ensureAdminUserSchema(), ensureWalletSchema()]);
  const user = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (user.length === 0) {
    return c.json({ error: "User not found" }, 404);
  }

  const reason = normalizeAdminReason(requestBody.reason, "admin credit");
  const idempotencyKey = buildAdminCreditIdempotencyKey(userId, rawIdempotencyKey);
  const result = await createWalletLedgerEntry({
    userId,
    type: "admin_credit",
    amount,
    currency,
    idempotencyKey,
  });
  await db.insert(auditLog).values({
    rentalId: null,
    action: "admin_user_credit",
    detail: truncate(JSON.stringify({
      userId,
      amount,
      currency,
      reason,
      idempotencyKey,
      alreadyProcessed: result.alreadyProcessed,
      actor: getAdminActor(c),
    })),
  });

  return c.json({
    userId,
    ledger: result.ledger,
    alreadyProcessed: result.alreadyProcessed,
  });
});

app.post("/api/admin/users/:id/freeze", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const userId = c.req.param("id");
  const requestBody = await c.req.json().catch(() => ({})) as {
    frozen?: unknown;
    reason?: unknown;
  };
  await ensureAdminUserSchema();
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (existing.length === 0) {
    return c.json({ error: "User not found" }, 404);
  }

  const update = buildAdminFreezeUpdate({
    frozen: requestBody.frozen,
    reason: requestBody.reason,
  });
  const updated = await db.update(users)
    .set({
      isFrozen: update.isFrozen,
      frozenAt: update.frozenAt,
      freezeReason: update.freezeReason,
      updatedAt: update.updatedAt,
    })
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      email: users.email,
      isFrozen: users.isFrozen,
      frozenAt: users.frozenAt,
      freezeReason: users.freezeReason,
      updatedAt: users.updatedAt,
    });

  await db.insert(auditLog).values({
    rentalId: null,
    action: "admin_user_freeze_updated",
    detail: truncate(JSON.stringify({
      userId,
      ...update.auditDetail,
      actor: getAdminActor(c),
    })),
  });
  const releasedReferralRewards = update.isFrozen ? [] : await releaseHeldReferralRewards(userId);
  await recordStructuredAudit(c, {
    eventType: "admin_user_freeze_updated",
    actorType: "admin",
    actorUserId: userId,
    payload: {
      userId,
      frozen: update.isFrozen,
      releasedReferralRewards: releasedReferralRewards.length,
      actor: getAdminActor(c),
    },
  });

  return c.json({ user: updated[0], releasedReferralRewards: releasedReferralRewards.length });
});

app.get("/api/admin/users/:id", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const userId = c.req.param("id");
  await Promise.all([ensureAdminUserSchema(), ensureWalletSchema()]);
  const result = await db.select({
    id: users.id,
    email: users.email,
    balance: users.balance,
    isFrozen: users.isFrozen,
    frozenAt: users.frozenAt,
    freezeReason: users.freezeReason,
    createdAt: users.createdAt,
    updatedAt: users.updatedAt,
  })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (result.length === 0) {
    return c.json({ error: "User not found" }, 404);
  }

  const [rentalStatusRows, latestLedger, recentLedger] = await Promise.all([
    db.select({
      status: rentals.status,
      count: sql<number>`count(*)::int`,
    })
      .from(rentals)
      .where(eq(rentals.userId, userId))
      .groupBy(rentals.status),
    getLatestLedgerBalance(userId),
    db.select()
      .from(walletLedger)
      .where(eq(walletLedger.userId, userId))
      .orderBy(desc(walletLedger.createdAt))
      .limit(10),
  ]);

  return c.json({
    user: {
      ...result[0],
      balance: Number(result[0].balance || 0),
      walletBalance: latestLedger?.balance ?? Number(result[0].balance || 0),
      walletCurrency: latestLedger?.currency || "usd",
    },
    rentals: {
      byStatus: Object.fromEntries(rentalStatusRows.map((row) => [row.status, Number(row.count || 0)])),
    },
    recentLedger,
  });
});

app.post("/api/admin/redeem-codes", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await ensureRedeemCodeModeSchema();
  const { count, durationHours, expiresAt, codeType, walletAmount } = await c.req.json();
  const normalizedCodeType = codeType === "wallet" ? "wallet" : "duration";

  if (!count || count < 1 || count > 100) {
    return c.json({ error: "Count must be between 1 and 100" }, 400);
  }

  const validDurations = [1, 6, 8, 12, 16, 24, 48, 72];
  if (normalizedCodeType === "duration" && !validDurations.includes(durationHours)) {
    return c.json({ error: "Invalid duration" }, 400);
  }
  const normalizedWalletAmount = Math.round(Number(walletAmount || 0) * 100) / 100;
  if (normalizedCodeType === "wallet" && (!Number.isFinite(normalizedWalletAmount) || normalizedWalletAmount <= 0 || normalizedWalletAmount > 10000)) {
    return c.json({ error: "Wallet amount must be between 0.01 and 10000 USD" }, 400);
  }

  const codes: { code: string; codeType: string; durationHours: number; walletAmount: number | null }[] = [];

  for (let i = 0; i < count; i++) {
    const codeId = randomUUID();
    const codePart = Array.from({ length: 8 }, () =>
      "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".charAt(Math.floor(Math.random() * 32))
    ).join("");
    const code = `ANIX-${codePart.slice(0, 4)}-${codePart.slice(4, 8)}`;

    await db.insert(redeemCodes).values({
      id: codeId,
      code,
      codeType: normalizedCodeType,
      durationHours: normalizedCodeType === "duration" ? durationHours : 0,
      walletAmount: normalizedCodeType === "wallet" ? normalizedWalletAmount : null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    });

    codes.push({
      code,
      codeType: normalizedCodeType,
      durationHours: normalizedCodeType === "duration" ? durationHours : 0,
      walletAmount: normalizedCodeType === "wallet" ? normalizedWalletAmount : null,
    });
  }

  return c.json({ codes, count: codes.length });
});

app.get("/api/admin/redeem-codes", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await ensureRedeemCodeModeSchema();
  const codes = await db.select().from(redeemCodes)
    .leftJoin(users, eq(redeemCodes.usedBy, users.id))
    .orderBy(desc(redeemCodes.createdAt));

  return c.json({ codes });
});

app.patch("/api/admin/redeem-codes/:id", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const id = c.req.param("id");
  const body = await c.req.json();
  const { durationHours, expiresAt, codeType, walletAmount } = body as {
    durationHours?: number;
    expiresAt?: string | null;
    codeType?: string;
    walletAmount?: number;
  };

  await ensureRedeemCodeModeSchema();
  const existing = await db.select().from(redeemCodes).where(eq(redeemCodes.id, id)).limit(1);
  if (existing.length === 0) {
    return c.json({ error: "Redeem code not found" }, 404);
  }

  if (existing[0].usedBy && durationHours && durationHours !== existing[0].durationHours) {
    return c.json({ error: "Used redeem codes cannot change duration" }, 400);
  }

  const updates: Partial<typeof redeemCodes.$inferInsert> = {};
  if (codeType === "wallet" || codeType === "duration") {
    updates.codeType = codeType;
  }
  if (typeof durationHours === "number") {
    updates.durationHours = durationHours;
  }
  if (typeof walletAmount === "number") {
    updates.walletAmount = Math.round(walletAmount * 100) / 100;
  }
  if (expiresAt === null) {
    updates.expiresAt = null;
  } else if (typeof expiresAt === "string" && expiresAt.length > 0) {
    updates.expiresAt = new Date(expiresAt);
  }

  const updated = await db.update(redeemCodes)
    .set(updates)
    .where(eq(redeemCodes.id, id))
    .returning();

  return c.json({ code: updated[0] });
});

app.delete("/api/admin/redeem-codes/:id", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const id = c.req.param("id");
  await ensureRedeemCodeModeSchema();
  const existing = await db.select().from(redeemCodes).where(eq(redeemCodes.id, id)).limit(1);
  if (existing.length === 0) {
    return c.json({ error: "Redeem code not found" }, 404);
  }

  if (existing[0].usedBy) {
    return c.json({ error: "Used redeem codes cannot be deleted" }, 400);
  }

  await db.delete(redeemCodes).where(eq(redeemCodes.id, id));
  return c.json({ deleted: true, id });
});

app.get("/api/admin/topups/:id", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const detail = await getAdminTopupDetail(c.req.param("id"));
  if (!detail) {
    return c.json({ error: "Topup not found" }, 404);
  }

  return c.json(detail);
});

app.get("/api/admin/overview", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const [
    totalUsersRow,
    activeRentalsRow,
    provisioningRentalsRow,
    totalRevenueRow,
    availableCodesRow,
    usedCodesRow,
    complianceTrackedRow,
    complianceRejectPacketsRow,
    recentComplianceStats,
    recentRentals,
    recentPayments,
    recentTopups,
    recentCryptoTopups,
    recentWalletLedgerEntries,
    recentAnchorBatches,
    recentAuditEntries,
    recentFailedJobs,
    recentProvisionJobs,
    provisionQueueCounts,
    provisionQueuePaused,
    provisioningDebugRows,
    recentStageAuditEntries,
    systemHealthChecks,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(users),
    db.select({ count: sql<number>`count(*)::int` }).from(rentals)
      .where(eq(rentals.status, "active")),
    db.select({ count: sql<number>`count(*)::int` }).from(rentals)
      .where(eq(rentals.status, "provisioning")),
    db.select({ total: sql<number>`coalesce(sum(${payments.amount}), 0)` }).from(payments)
      .where(eq(payments.status, "completed")),
    db.select({ count: sql<number>`count(*)::int` }).from(redeemCodes)
      .where(sql`${redeemCodes.usedBy} IS NULL`),
    db.select({ count: sql<number>`count(*)::int` }).from(redeemCodes)
      .where(sql`${redeemCodes.usedBy} IS NOT NULL`),
    db.select({ count: sql<number>`count(*)::int` }).from(complianceStats),
    db.select({ total: sql<number>`coalesce(sum(${complianceStats.rejectPackets}), 0)` }).from(complianceStats),
    db.select({
      rentalId: complianceStats.rentalId,
      complianceProfileId: complianceStats.complianceProfileId,
      policyVersion: complianceStats.policyVersion,
      rejectPackets: complianceStats.rejectPackets,
      rejectBytes: complianceStats.rejectBytes,
      lastSyncedAt: complianceStats.lastSyncedAt,
    }).from(complianceStats).orderBy(desc(complianceStats.lastSyncedAt)).limit(6),
    db.select({
      rentalId: rentals.id,
      email: users.email,
      protocol: rentals.protocol,
      status: rentals.status,
      ip: rentals.ip,
      durationHours: rentals.durationHours,
      totalPrice: rentals.totalPrice,
      createdAt: rentals.createdAt,
      expiresAt: rentals.expiresAt,
    })
      .from(rentals)
      .leftJoin(users, eq(rentals.userId, users.id))
      .orderBy(desc(rentals.createdAt))
      .limit(8),
    db.select({
      paymentId: payments.id,
      rentalId: payments.rentalId,
      email: users.email,
      amount: payments.amount,
      currency: payments.currency,
      method: payments.method,
      status: payments.status,
      createdAt: payments.createdAt,
    })
      .from(payments)
      .leftJoin(users, eq(payments.userId, users.id))
      .orderBy(desc(payments.createdAt))
      .limit(8),
    db.select({
      topupId: topups.id,
      email: users.email,
      provider: topups.provider,
      amount: topups.amount,
      currency: topups.currency,
      status: topups.status,
      createdAt: topups.createdAt,
      completedAt: topups.completedAt,
    })
      .from(topups)
      .leftJoin(users, eq(topups.userId, users.id))
      .orderBy(desc(topups.createdAt))
      .limit(8),
    db.select({
      topupId: cryptoTopups.id,
      email: users.email,
      asset: cryptoTopups.asset,
      network: cryptoTopups.network,
      rail: cryptoTopups.rail,
      fiatAmount: cryptoTopups.fiatAmount,
      currency: cryptoTopups.currency,
      status: cryptoTopups.status,
      txHash: cryptoTopups.txHash,
      createdAt: cryptoTopups.createdAt,
    })
      .from(cryptoTopups)
      .leftJoin(users, eq(cryptoTopups.userId, users.id))
      .orderBy(desc(cryptoTopups.createdAt))
      .limit(8),
    db.select({
      entryId: walletLedger.id,
      email: users.email,
      type: walletLedger.type,
      amount: walletLedger.amount,
      currency: walletLedger.currency,
      rentalId: walletLedger.rentalId,
      topupId: walletLedger.topupId,
      balanceAfter: walletLedger.balanceAfter,
      createdAt: walletLedger.createdAt,
    })
      .from(walletLedger)
      .leftJoin(users, eq(walletLedger.userId, users.id))
      .orderBy(desc(walletLedger.createdAt))
      .limit(8),
    db.select({
      batchId: auditAnchorBatches.id,
      eventCount: auditAnchorBatches.eventCount,
      merkleRoot: auditAnchorBatches.merkleRoot,
      status: auditAnchorBatches.status,
      chain: auditAnchorBatches.chain,
      txHash: auditAnchorBatches.txHash,
      receipt: auditAnchorBatches.receipt,
      submissionStartedAt: auditAnchorBatches.submissionStartedAt,
      createdAt: auditAnchorBatches.createdAt,
      anchoredAt: auditAnchorBatches.anchoredAt,
    })
      .from(auditAnchorBatches)
      .orderBy(desc(auditAnchorBatches.createdAt))
      .limit(6),
    db.select({
      id: auditLog.id,
      rentalId: auditLog.rentalId,
      action: auditLog.action,
      detail: auditLog.detail,
      createdAt: auditLog.createdAt,
    })
      .from(auditLog)
      .orderBy(desc(auditLog.createdAt))
      .limit(10),
    provisionQueue.getFailed(0, 9),
    provisionQueue.getJobs(["waiting", "active", "delayed", "failed"], 0, 49, false),
    provisionQueue.getJobCounts("waiting", "active", "delayed", "failed", "completed", "paused"),
    provisionQueue.isPaused(),
    db.select({
      rentalId: rentals.id,
      email: users.email,
      protocol: rentals.protocol,
      status: rentals.status,
      ip: rentals.ip,
      vpsId: rentals.vpsId,
      paymentMethod: rentals.paymentMethod,
      paymentStatus: rentals.paymentStatus,
      createdAt: rentals.createdAt,
      updatedAt: rentals.updatedAt,
      expiresAt: rentals.expiresAt,
      ageMinutes: sql<number>`greatest(0, floor(extract(epoch from (NOW() - ${rentals.createdAt})) / 60))::int`,
      expiresInMinutes: sql<number | null>`case when ${rentals.expiresAt} is null then null else floor(extract(epoch from (${rentals.expiresAt} - NOW())) / 60)::int end`,
      isStale: sql<boolean>`${rentals.createdAt} <= NOW() - (${STALE_PROVISIONING_MINUTES} * INTERVAL '1 minute')`,
    })
      .from(rentals)
      .leftJoin(users, eq(rentals.userId, users.id))
      .where(eq(rentals.status, "provisioning"))
      .orderBy(asc(rentals.createdAt))
      .limit(20),
    db.select({
      id: auditLog.id,
      rentalId: auditLog.rentalId,
      action: auditLog.action,
      detail: auditLog.detail,
      createdAt: auditLog.createdAt,
    })
      .from(auditLog)
      .where(eq(auditLog.action, "provision_stage"))
      .orderBy(desc(auditLog.createdAt))
      .limit(80),
    runHealthChecks([
      { name: "database", check: () => db.execute(sql`select 1`) },
      { name: "redis", check: () => redis.ping() },
      { name: "provision", check: () => checkProvisionServerHealth(env.PROVISION_SERVER_URL) },
    ]),
  ]);

  const provisioningRentalIds = provisioningDebugRows.map((row) => row.rentalId);
  const provisioningAuditRows = provisioningRentalIds.length > 0
    ? await db.select({
      id: auditLog.id,
      rentalId: auditLog.rentalId,
      action: auditLog.action,
      detail: auditLog.detail,
      createdAt: auditLog.createdAt,
    })
      .from(auditLog)
      .where(inArray(auditLog.rentalId, provisioningRentalIds))
      .orderBy(desc(auditLog.createdAt))
      .limit(100)
    : [];

  const latestAuditByRentalId = new Map<string, typeof provisioningAuditRows[number]>();
  for (const entry of provisioningAuditRows) {
    if (entry.rentalId && !latestAuditByRentalId.has(entry.rentalId)) {
      latestAuditByRentalId.set(entry.rentalId, entry);
    }
  }

  const provisionJobMap = new Map<string, ProvisionQueueJobLike>();
  for (const job of [...recentProvisionJobs, ...recentFailedJobs]) {
    provisionJobMap.set(job.id ? String(job.id) : `${job.name}:${job.timestamp}`, job);
  }

  const provisionDebugJobs = await Promise.all(
    Array.from(provisionJobMap.values()).map((job) => serializeProvisionQueueJob(job)),
  );
  const recentFailedJobIds = new Set(recentFailedJobs.map((job) => job.id ? String(job.id) : ""));
  const serializedFailedJobs = provisionDebugJobs.filter((job) => recentFailedJobIds.has(job.id));
  const latestJobByRentalId = new Map<string, Awaited<ReturnType<typeof serializeProvisionQueueJob>>>();
  for (const job of provisionDebugJobs) {
    if (!job.rentalId) {
      continue;
    }
    const previous = latestJobByRentalId.get(job.rentalId);
    if (!previous || getSerializedJobTime(job) > getSerializedJobTime(previous)) {
      latestJobByRentalId.set(job.rentalId, job);
    }
  }

  const normalizedQueueCounts = Object.fromEntries(
    Object.entries(provisionQueueCounts).map(([key, value]) => [key, Number(value)]),
  );
  const debugProvisioningRentals = provisioningDebugRows.map((row) => ({
    ...row,
    email: maskEmail(row.email),
    ageMinutes: Number(row.ageMinutes ?? 0),
    expiresInMinutes: row.expiresInMinutes === null ? null : Number(row.expiresInMinutes),
    isStale: Boolean(row.isStale),
    canRelease: !row.ip && !row.vpsId,
    lastAudit: latestAuditByRentalId.get(row.rentalId) ?? null,
    queueJob: latestJobByRentalId.get(row.rentalId) ?? null,
  }));

  return c.json({
    summary: {
      totalUsers: totalUsersRow[0]?.count ?? 0,
      activeRentals: activeRentalsRow[0]?.count ?? 0,
      provisioningRentals: provisioningRentalsRow[0]?.count ?? 0,
      totalRevenue: Number(totalRevenueRow[0]?.total ?? 0),
      availableRedeemCodes: availableCodesRow[0]?.count ?? 0,
      usedRedeemCodes: usedCodesRow[0]?.count ?? 0,
      complianceTrackedRentals: complianceTrackedRow[0]?.count ?? 0,
      complianceRejectPackets: Number(complianceRejectPacketsRow[0]?.total ?? 0),
    },
    compliance: {
      recentStats: recentComplianceStats.map((row) => ({
        rentalId: row.rentalId,
        complianceProfileId: row.complianceProfileId,
        policyVersion: row.policyVersion,
        rejectPackets: Number(row.rejectPackets || 0),
        rejectBytes: Number(row.rejectBytes || 0),
        lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
      })),
    },
    chainMode: {
      ...buildChainModePayload({
        email: null,
        access: {
          allowed: env.CHAIN_ENVIRONMENT !== "testnet",
          allowlistedOnly: env.CHAIN_ENVIRONMENT === "testnet",
          reason: null,
        },
      }),
      readiness: summarizeEvmChainReadiness(env),
    },
    recentRentals,
    recentPayments,
    recentTopups,
    recentCryptoTopups,
    recentWalletLedgerEntries,
    recentAnchorBatches: recentAnchorBatches.map((batch) => ({
      batchId: batch.batchId,
      eventCount: Number(batch.eventCount || 0),
      merkleRoot: batch.merkleRoot,
      status: batch.status,
      chain: batch.chain,
      txHash: batch.txHash,
      hasReceipt: Boolean(batch.receipt),
      receiptSummary: formatAuditAnchorReceipt(batch.receipt),
      submissionStartedAt: consoleToIso(batch.submissionStartedAt),
      createdAt: consoleToIso(batch.createdAt),
      anchoredAt: consoleToIso(batch.anchoredAt),
    })),
    recentAuditEntries,
    recentFailedJobs: recentFailedJobs.map((job) => ({
      ...(serializedFailedJobs.find((serializedJob) => serializedJob.id === String(job.id)) ?? {
        id: job.id ? String(job.id) : "",
        name: job.name,
        state: "failed",
        data: sanitizeProvisionJobData(job.data),
        rentalId: getProvisionJobRentalId(job.data),
        failedReason: job.failedReason || null,
        attemptsMade: job.attemptsMade,
        attempts: job.opts.attempts ?? null,
        timestamp: job.timestamp ?? null,
        processedOn: job.processedOn ?? null,
        finishedOn: job.finishedOn ?? null,
        delay: job.delay ?? 0,
        stacktrace: job.stacktrace?.slice(0, 3) || [],
      }),
    })),
    systemHealth: {
      status: systemHealthChecks.some((check) => !check.ok) ? "degraded" : "ok",
      checks: systemHealthChecks,
    },
    debug: {
      generatedAt: new Date().toISOString(),
      staleThresholdMinutes: STALE_PROVISIONING_MINUTES,
      provisionServerUrl: env.PROVISION_SERVER_URL,
      queue: {
        name: "provision",
        isPaused: provisionQueuePaused,
        counts: normalizedQueueCounts,
        recentJobs: provisionDebugJobs,
      },
      provisioningRentals: debugProvisioningRentals,
      stageLogs: recentStageAuditEntries.map(parseStageAuditEntry),
    },
  });
});

app.get("/api/admin/probes/nodes", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await ensureProbeSchema();
  const limit = parseBoundedLimit(c.req.query("limit"), 50, 200);
  const status = c.req.query("status")?.trim().toLowerCase();
  const nodes = status
    ? await db.select()
      .from(probeNodes)
      .where(eq(probeNodes.status, status))
      .orderBy(desc(probeNodes.lastSeenAt))
      .limit(limit)
    : await db.select()
      .from(probeNodes)
      .orderBy(desc(probeNodes.lastSeenAt))
      .limit(limit);

  return c.json({
    summary: {
      returnedNodes: nodes.length,
      generatedAt: new Date().toISOString(),
    },
    nodes,
  });
});

app.get("/api/admin/probes/runs", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const limit = parseBoundedLimit(c.req.query("limit"), 50, 200);
  const rentalId = c.req.query("rentalId")?.trim();
  const status = c.req.query("status")?.trim();
  const decision = c.req.query("decision")?.trim();
  const rowLimit = Math.min(2000, Math.max(200, limit * 20));
  const entries = await readRecentProbeStageEntries(rowLimit, rentalId || undefined);
  const stageLogs = entries.map((entry) => parseStageAuditEntry(entry));
  let runs = buildProbeRunSummaries(stageLogs)
    .sort((a, b) => (Date.parse(b.lastEventAt || "") || 0) - (Date.parse(a.lastEventAt || "") || 0));

  if (status) {
    runs = runs.filter((run) => run.status === status);
  }
  if (decision) {
    runs = runs.filter((run) => run.decision === decision);
  }

  const returnedRuns = runs.slice(0, limit);
  const rentalIds = Array.from(new Set(returnedRuns.map((run) => run.rentalId).filter((id): id is string => Boolean(id))));
  const rentalContexts = await getAdminRentalProbeContexts(rentalIds);

  return c.json({
    summary: {
      scannedEvents: stageLogs.length,
      totalRuns: runs.length,
      returnedRuns: returnedRuns.length,
      passedRuns: runs.filter((run) => run.status === "passed").length,
      failedRuns: runs.filter((run) => run.status === "failed").length,
      skippedRuns: runs.filter((run) => run.status === "skipped").length,
      runningRuns: runs.filter((run) => run.status === "running").length,
      generatedAt: new Date().toISOString(),
    },
    runs: returnedRuns.map((run) => ({
      ...run,
      rental: run.rentalId ? rentalContexts.get(run.rentalId) ?? null : null,
    })),
  });
});

app.get("/api/admin/probes/runs/:id", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const probeRunId = c.req.param("id").trim();
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(probeRunId)) {
    return c.json({ error: "Invalid probe run id" }, 400);
  }

  const limit = parseBoundedLimit(c.req.query("scanLimit"), 2000, 5000);
  const entries = await readRecentProbeStageEntries(limit);
  const stageLogs = entries.map((entry) => parseStageAuditEntry(entry));
  const run = buildProbeRunSummaries(stageLogs).find((candidate) => candidate.probeRunId === probeRunId);
  if (!run) {
    return c.json({ error: "Probe run not found" }, 404);
  }

  const rentalContexts = await getAdminRentalProbeContexts(run.rentalId ? [run.rentalId] : []);

  return c.json({
    run: {
      ...run,
      rental: run.rentalId ? rentalContexts.get(run.rentalId) ?? null : null,
    },
  });
});

app.post("/api/admin/probes/run", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => ({})) as {
    ip?: unknown;
    port?: unknown;
    protocol?: unknown;
    policy?: unknown;
  };
  const ip = typeof body.ip === "string" && body.ip.trim() ? body.ip.trim() : "";
  const port = Number(body.port);
  const protocol = typeof body.protocol === "string" && body.protocol.trim() ? body.protocol.trim() : "tcp";
  if (!ip || !Number.isInteger(port) || port < 1 || port > 65535) {
    return c.json({ error: "Invalid probe target" }, 400);
  }

  const policy = normalizeProbePolicy(body.policy);
  const requestBody = {
    rentalId: null,
    attemptId: null,
    ip,
    port,
    protocol,
    policy,
  };

  const res = await fetch(`${env.FRONTEND_URL ? "http://127.0.0.1:8787" : ""}/internal/probes/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Secret": env.API_SECRET,
    },
    body: JSON.stringify(requestBody),
  }).catch(() => null);

  if (!res) {
    return c.json({ error: "Internal probe service unavailable" }, 502);
  }

  const payload = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    return c.json({
      error: typeof payload.error === "string" ? payload.error : "Probe run creation failed",
      detail: typeof payload.detail === "string" ? payload.detail : null,
    }, 502);
  }

  const probeRunId = typeof payload.probeRunId === "string" && payload.probeRunId.trim()
    ? payload.probeRunId.trim()
    : null;
  if (!probeRunId) {
    return c.json(payload);
  }

  let latestPayload: Record<string, unknown> = payload;
  for (let i = 0; i < 12; i++) {
    await sleep(1000);
    const pollRes = await fetch(`http://127.0.0.1:8787/internal/probes/runs/${encodeURIComponent(probeRunId)}`, {
      headers: {
        "X-API-Secret": env.API_SECRET,
      },
    }).catch(() => null);
    if (!pollRes) {
      break;
    }
    latestPayload = await pollRes.json().catch(() => latestPayload) as Record<string, unknown>;
    const status = typeof latestPayload.status === "string" ? latestPayload.status : "";
    if (status === "passed" || status === "failed" || status === "skipped") {
      break;
    }
  }

  return c.json(latestPayload);
});

app.get("/api/admin/search", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const q = (c.req.query("q") || "").trim().toLowerCase();
  if (q.length < 2) {
    return c.json({ error: "Query must be at least 2 characters" }, 400);
  }

  const pattern = `%${q}%`;

  const [matchedUsers, matchedRentals] = await Promise.all([
    db.select({
      userId: users.id,
      email: users.email,
      createdAt: users.createdAt,
    })
      .from(users)
      .where(sql`lower(coalesce(${users.email}, '')) like ${pattern}`)
      .orderBy(desc(users.createdAt))
      .limit(10),
    db.select({
      rentalId: rentals.id,
      email: users.email,
      protocol: rentals.protocol,
      status: rentals.status,
      ip: rentals.ip,
      vpsId: rentals.vpsId,
      createdAt: rentals.createdAt,
      expiresAt: rentals.expiresAt,
    })
      .from(rentals)
      .leftJoin(users, eq(rentals.userId, users.id))
      .where(sql`
        lower(${rentals.id}) like ${pattern}
        or lower(coalesce(${users.email}, '')) like ${pattern}
        or lower(coalesce(${rentals.ip}, '')) like ${pattern}
        or lower(${rentals.protocol}) like ${pattern}
        or lower(${rentals.status}) like ${pattern}
      `)
      .orderBy(desc(rentals.createdAt))
      .limit(15),
  ]);

  return c.json({ users: matchedUsers, rentals: matchedRentals });
});

app.get("/api/admin/rentals/:id", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const rentalId = c.req.param("id");
  await ensureRentalPlacementSchema();
  const result = await db.select({
    rentalId: rentals.id,
    userId: rentals.userId,
    email: users.email,
    protocol: rentals.protocol,
    status: rentals.status,
    provider: rentals.provider,
    region: rentals.region,
    plan: rentals.plan,
    attemptCount: rentals.attemptCount,
    lastStage: rentals.lastStage,
    failedReason: rentals.failedReason,
    ip: rentals.ip,
    vpsId: rentals.vpsId,
    durationHours: rentals.durationHours,
    pricePerHour: rentals.pricePerHour,
    totalPrice: rentals.totalPrice,
    paymentMethod: rentals.paymentMethod,
    paymentStatus: rentals.paymentStatus,
    startedAt: rentals.startedAt,
    expiresAt: rentals.expiresAt,
    pausedAt: rentals.pausedAt,
    createdAt: rentals.createdAt,
    updatedAt: rentals.updatedAt,
  })
    .from(rentals)
    .leftJoin(users, eq(rentals.userId, users.id))
    .where(eq(rentals.id, rentalId))
    .limit(1);

  if (result.length === 0) {
    return c.json({ error: "Rental not found" }, 404);
  }

  const rental = result[0];
  const config = await getCache<Record<string, unknown>>(`rental:${rentalId}:config`);
  await ensureProvisionAttemptSchema();
  const recentAuditEntries = await db.select({
    id: auditLog.id,
    action: auditLog.action,
    detail: auditLog.detail,
    createdAt: auditLog.createdAt,
  })
    .from(auditLog)
    .where(eq(auditLog.rentalId, rentalId))
    .orderBy(desc(auditLog.createdAt))
    .limit(150);
  const attempts = await db.select()
    .from(provisionAttempts)
    .where(eq(provisionAttempts.rentalId, rentalId))
    .orderBy(asc(provisionAttempts.attemptNo))
    .limit(50);

  const stageLogs = recentAuditEntries
    .filter((entry) => entry.action === "provision_stage")
    .map((entry) => parseStageAuditEntry({ ...entry, rentalId }));
  const probePayload = buildRentalProbePayload({
    id: rental.rentalId,
    status: rental.status,
    ip: rental.ip,
    vpsId: rental.vpsId,
  }, stageLogs);

  const now = new Date();
  const remainingMinutes = rental.expiresAt
    ? Math.max(0, Math.floor((rental.expiresAt.getTime() - now.getTime()) / 60000))
    : 0;

  return c.json({
    rental: {
      ...rental,
      remainingMinutes,
    },
    config,
    recentAuditEntries,
    stageLogs,
    attempts,
    probeSummary: probePayload.summary,
    probeRuns: probePayload.runs,
  });
});

app.post("/api/admin/rentals/:id/refund", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const rentalId = c.req.param("id");
  const requestBody = await c.req.json().catch(() => ({})) as {
    amount?: unknown;
    reason?: unknown;
    idempotencyKey?: unknown;
  };
  const rawIdempotencyKey = c.req.header("Idempotency-Key")
    || (typeof requestBody.idempotencyKey === "string" ? requestBody.idempotencyKey : "");
  if (!rawIdempotencyKey.trim()) {
    return c.json({ error: "Idempotency-Key is required" }, 400);
  }

  await ensureWalletSchema();
  const rental = await db.select({
    id: rentals.id,
    userId: rentals.userId,
    status: rentals.status,
    paymentMethod: rentals.paymentMethod,
    paymentStatus: rentals.paymentStatus,
  })
    .from(rentals)
    .where(eq(rentals.id, rentalId))
    .limit(1);

  if (rental.length === 0) {
    return c.json({ error: "Rental not found" }, 404);
  }
  if (!rental[0].userId) {
    return c.json({ error: "Rental has no user to refund" }, 409);
  }
  if (rental[0].paymentMethod !== "wallet") {
    return c.json({ error: "Only wallet rentals can be refunded through wallet ledger" }, 409);
  }

  const idempotencyKey = buildAdminRefundIdempotencyKey(rentalId, rawIdempotencyKey);
  const existingRefund = await db.select()
    .from(walletLedger)
    .where(eq(walletLedger.idempotencyKey, idempotencyKey))
    .limit(1);
  if (existingRefund.length > 0) {
    return c.json({ rentalId, ledger: existingRefund[0], alreadyProcessed: true });
  }

  const totals = await db.select({
    debits: sql<number>`coalesce(sum(case when ${walletLedger.amount} < 0 then abs(${walletLedger.amount}) else 0 end), 0)`,
    credits: sql<number>`coalesce(sum(case when ${walletLedger.amount} > 0 then ${walletLedger.amount} else 0 end), 0)`,
  })
    .from(walletLedger)
    .where(eq(walletLedger.rentalId, rentalId));
  const debits = Math.round(Number(totals[0]?.debits || 0) * 100) / 100;
  const credits = Math.round(Number(totals[0]?.credits || 0) * 100) / 100;
  const refundable = Math.max(0, Math.round((debits - credits) * 100) / 100);
  if (refundable <= 0) {
    return c.json({ error: "Rental has no refundable wallet charges" }, 409);
  }

  const requestedAmount = requestBody.amount === undefined ? refundable : normalizeAdminCreditAmount(requestBody.amount);
  if (requestedAmount === null) {
    return c.json({ error: "Amount must be greater than 0 and no more than 10000" }, 400);
  }
  if (requestedAmount > refundable) {
    return c.json({ error: "Refund amount exceeds refundable wallet charges", refundable }, 409);
  }

  const reason = normalizeAdminReason(requestBody.reason, "admin refund");
  const result = await createWalletLedgerEntry({
    userId: rental[0].userId,
    type: "admin_refund",
    amount: requestedAmount,
    currency: "usd",
    rentalId,
    idempotencyKey,
  });
  if (!result.alreadyProcessed && requestedAmount >= refundable) {
    await db.update(rentals)
      .set({ paymentStatus: "refunded", updatedAt: new Date() })
      .where(eq(rentals.id, rentalId));
  }
  await db.insert(auditLog).values({
    rentalId,
    action: "admin_rental_refund",
    detail: truncate(JSON.stringify({
      userId: rental[0].userId,
      amount: requestedAmount,
      refundableBefore: refundable,
      reason,
      idempotencyKey,
      actor: getAdminActor(c),
    })),
  });

  return c.json({
    rentalId,
    refundedAmount: requestedAmount,
    refundableBefore: refundable,
    ledger: result.ledger,
    alreadyProcessed: result.alreadyProcessed,
  });
});

app.post("/api/admin/rentals/:id/destroy", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const rentalId = c.req.param("id");
  const rental = await db.select().from(rentals).where(eq(rentals.id, rentalId)).limit(1);
  if (rental.length === 0) {
    return c.json({ error: "Rental not found" }, 404);
  }

  if (rental[0].status !== "destroyed") {
    await db.update(rentals)
      .set({ status: "destroyed", updatedAt: new Date() })
      .where(eq(rentals.id, rentalId));

    await deleteCache(`rental:${rentalId}:config`);
  }

  await db.insert(auditLog).values({
    rentalId,
    action: "admin_destroy_requested",
    detail: `status=${rental[0].status}`,
  });

  await addProvisionJob({
    rentalId,
    action: "destroy",
    vpsId: rental[0].vpsId ?? undefined,
    ip: rental[0].ip ?? undefined,
  });

  return c.json({ status: "destroyed", rentalId });
});

app.post("/api/admin/rentals/:id/release-provisioning", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const rentalId = c.req.param("id");
  const rental = await db.select({
    id: rentals.id,
    status: rentals.status,
    ip: rentals.ip,
    vpsId: rentals.vpsId,
  }).from(rentals).where(eq(rentals.id, rentalId)).limit(1);

  if (rental.length === 0) {
    return c.json({ error: "Rental not found" }, 404);
  }

  if (rental[0].status !== "provisioning") {
    return c.json({ error: `Rental is ${rental[0].status}, not provisioning` }, 409);
  }

  if (rental[0].ip || rental[0].vpsId) {
    return c.json({ error: "Rental already has machine data; force destroy instead of release" }, 409);
  }

  const removedJobs = await removePendingProvisionJobs(rentalId);
  const released = await releaseFailedProvisioningRental(
    rentalId,
    `admin released stuck provisioning rental; removed_pending_jobs=${removedJobs}`,
  );

  if (!released) {
    return c.json({ error: "Rental could not be released" }, 409);
  }

  return c.json({ status: "expired", rentalId, removedJobs });
});

app.post("/api/admin/debug/provision-test", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => ({})) as { protocol?: string; durationHours?: number };
  const protocol = body.protocol === "hysteria2" ? "hysteria2" : "vless-reality";
  if (!isProtocolAllowedForRelease(protocol)) {
    return c.json({ error: "Invalid protocol" }, 400);
  }
  const durationHours = Number.isFinite(body.durationHours) && body.durationHours && body.durationHours > 0
    ? Math.min(24, Math.max(1, Math.floor(body.durationHours)))
    : 1;
  const rentalId = randomUUID();
  const now = new Date();
  const catalog = getCatalogRuntimeConfig();

  await ensureRentalPlacementSchema();
  await db.insert(rentals).values({
    id: rentalId,
    userId: null,
    protocol,
    status: "provisioning",
    provider: catalog.provider,
    region: catalog.region,
    plan: catalog.plan,
    durationHours,
    pricePerHour: 0,
    totalPrice: 0,
    paymentMethod: "admin_debug_test",
    paymentStatus: "paid",
    startedAt: now,
    expiresAt: new Date(now.getTime() + durationHours * 3600 * 1000),
  });

  await db.insert(auditLog).values({
    rentalId,
    action: "admin_debug_test_created",
    detail: `protocol=${protocol}, duration=${durationHours}h`,
  });
  await insertProvisionStageAudit(rentalId, {
    stage: "stage0-0-debug-test-created",
    status: "ok",
    message: "Admin debug test rental created",
    timestamp: new Date().toISOString(),
    meta: { protocol, durationHours },
  });
  await addProvisionJob({ rentalId, protocol, durationHours });

  return c.json({ rentalId, protocol, durationHours, status: "provisioning" });
});

app.post("/api/admin/debug/provider-check", async (c) => {
  if (!(await verifyAdminRequest(c))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const config = getCatalogRuntimeConfig();
  const requestBody = await c.req.json().catch(() => ({})) as {
    provider?: unknown;
    region?: unknown;
    plan?: unknown;
  };
  const requestedProvider = typeof requestBody.provider === "string" && requestBody.provider.trim()
    ? normalizeProviderId(requestBody.provider)
    : config.provider;
  if (!isSupportedProvider(requestedProvider)) {
    return c.json({ error: "Unsupported provider" }, 400);
  }
  const region = typeof requestBody.region === "string" && requestBody.region.trim() ? requestBody.region.trim() : config.region;
  const plan = typeof requestBody.plan === "string" && requestBody.plan.trim() ? requestBody.plan.trim() : config.plan;

  const res = await postProvisionServer("/api/provider-check", { provider: requestedProvider, region, plan });
  const responseBody = await readProvisionServerResponse(res);
  return c.json({
    ok: res.ok,
    status: res.status,
    provider: typeof responseBody.provider === "string" ? responseBody.provider : requestedProvider,
    region: typeof responseBody.region === "string" ? responseBody.region : region,
    plan: typeof responseBody.plan === "string" ? responseBody.plan : plan,
    stageLogs: getProvisionStageLogs(responseBody),
    error: responseBody.error || responseBody.detail || null,
  }, res.ok ? 200 : 502);
});

// ============================================================
// Session Status (for Stripe success page)
// ============================================================
app.get("/api/rental/session/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");

  const value = await redis.get(`stripe:${sessionId}`);
  if (!value) {
    return c.json({ status: "pending" });
  }

  if (value.startsWith("renewal:")) {
    const rentalId = value.slice(8);
    return c.json({ rentalId, isRenewal: true });
  }

  if (value.startsWith("topup:")) {
    const topupId = value.slice(6);
    return c.json({ topupId, isTopup: true });
  }

  const rentalId = value;
  const rental = await db.select().from(rentals).where(eq(rentals.id, rentalId)).limit(1);

  if (rental.length === 0) {
    return c.json({ status: "pending" });
  }

  const now = new Date();
  const expiresAt = rental[0].expiresAt;
  const remainingMs = expiresAt ? expiresAt.getTime() - now.getTime() : 0;
  const remainingMinutes = Math.max(0, Math.floor(remainingMs / 60000));

  return c.json({
    rentalId: rental[0].id,
    isRenewal: false,
    remainingMinutes,
    status: rental[0].status,
  });
});


// ============================================================
// Console
// ============================================================
function consoleToIso(value: Date | string | null | undefined) {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function consoleRemainingMinutes(expiresAt: Date | string | null | undefined, status: string) {
  if (!expiresAt || !["active", "paused", "provisioning"].includes(status)) return 0;
  const time = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.floor((time - Date.now()) / 60000));
}

function formatConsoleAuditEntry(entry: {
  id: number;
  rentalId: string | null;
  action: string;
  detail: string | null;
  createdAt: Date | string | null;
}) {
  const isProvisionStage = entry.action === "provision_stage";
  return {
    id: entry.id,
    rentalId: entry.rentalId,
    action: isProvisionStage ? "connection_delivery" : entry.action,
    detail: isProvisionStage ? "System updated connection delivery automatically." : entry.detail,
    createdAt: consoleToIso(entry.createdAt),
  };
}

app.get("/api/console/overview", verifyAuth, async (c) => {
  const userId = c.get("userId");
  await ensureWalletSchema();

  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (user.length === 0) return c.json({ error: "User not found" }, 404);

  const [userRentals, userPayments, ledgerBalance] = await Promise.all([
    db.select().from(rentals).where(eq(rentals.userId, userId)).orderBy(desc(rentals.createdAt)),
    db.select().from(payments).where(eq(payments.userId, userId)).orderBy(desc(payments.createdAt)).limit(8),
    getLatestLedgerBalance(userId),
  ]);
  const rentalIds = userRentals.map((rental) => rental.id);
  const recentAuditEntries = rentalIds.length > 0
    ? await db.select().from(auditLog).where(inArray(auditLog.rentalId, rentalIds)).orderBy(desc(auditLog.createdAt)).limit(8)
    : [];
  const wallet = ledgerBalance
    ? buildWalletSummaryFromBalance({ userId, balance: ledgerBalance.balance, currency: ledgerBalance.currency, source: "wallet-ledger" })
    : buildWalletSummary(user[0]);
  const activeRentals = userRentals.filter((rental) => rental.status === "active");
  const provisioningRentals = userRentals.filter((rental) => rental.status === "provisioning");
  const expiringSoonRentals = activeRentals.filter((rental) => {
    const minutes = consoleRemainingMinutes(rental.expiresAt, rental.status);
    return minutes >= 0 && minutes <= 60;
  });

  return c.json({
    user: {
      id: user[0].id,
      email: user[0].email,
      isAdmin: isAdminEmail(user[0].email, adminEmails),
      createdAt: consoleToIso(user[0].createdAt),
    },
    wallet,
    summary: {
      totalRentals: userRentals.length,
      activeRentals: activeRentals.length,
      provisioningRentals: provisioningRentals.length,
      expiringSoonRentals: expiringSoonRentals.length,
      totalPaid: userPayments.filter((payment) => payment.status === "completed").reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    },
    recentRentals: userRentals.slice(0, 5).map((rental) => ({
      id: rental.id,
      protocol: rental.protocol,
      status: rental.status,
      ip: rental.ip,
      vpsId: rental.vpsId,
      durationHours: rental.durationHours,
      totalPrice: Number(rental.totalPrice || 0),
      paymentMethod: rental.paymentMethod,
      remainingMinutes: consoleRemainingMinutes(rental.expiresAt, rental.status),
      createdAt: consoleToIso(rental.createdAt),
      expiresAt: consoleToIso(rental.expiresAt),
    })),
    recentPayments: userPayments.map((payment) => ({
      id: payment.id,
      rentalId: payment.rentalId,
      amount: Number(payment.amount || 0),
      currency: payment.currency || "usd",
      method: payment.method,
      status: payment.status || "completed",
      createdAt: consoleToIso(payment.createdAt),
    })),
    recentAuditEntries: recentAuditEntries.map(formatConsoleAuditEntry),
  });
});

app.get("/api/console/nodes", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const userRentals = await db.select().from(rentals).where(eq(rentals.userId, userId)).orderBy(desc(rentals.createdAt));
  const rentalIds = userRentals.map((rental) => rental.id);
  const probeRows = rentalIds.length > 0
    ? await db.select().from(probeRuns).where(inArray(probeRuns.rentalId, rentalIds)).orderBy(desc(probeRuns.createdAt)).limit(100)
    : [];
  const latestProbeByRental = new Map<string, typeof probeRows[number]>();
  for (const probe of probeRows) {
    if (probe.rentalId && !latestProbeByRental.has(probe.rentalId)) latestProbeByRental.set(probe.rentalId, probe);
  }

  return c.json({
    nodes: userRentals.map((rental) => {
      const latestProbe = latestProbeByRental.get(rental.id);
      return {
        id: rental.id,
        protocol: rental.protocol,
        status: rental.status,
        ip: rental.ip,
        vpsId: rental.vpsId,
        durationHours: rental.durationHours,
        pricePerHour: Number(rental.pricePerHour || 0),
        totalPrice: Number(rental.totalPrice || 0),
        paymentMethod: rental.paymentMethod,
        paymentStatus: rental.paymentStatus,
        remainingMinutes: consoleRemainingMinutes(rental.expiresAt, rental.status),
        createdAt: consoleToIso(rental.createdAt),
        startedAt: consoleToIso(rental.startedAt),
        expiresAt: consoleToIso(rental.expiresAt),
        probeSummary: latestProbe ? {
          status: latestProbe.status,
          decision: latestProbe.decision,
          lastRunAt: consoleToIso(latestProbe.createdAt),
        } : {
          status: "not_run",
          decision: "unknown",
          lastRunAt: null,
        },
      };
    }),
  });
});

app.get("/api/console/wallet", verifyAuth, async (c) => {
  const userId = c.get("userId");
  await Promise.all([ensureWalletSchema(), ensureCryptoTopupSchema()]);
  const user = await db.select({ id: users.id, balance: users.balance }).from(users).where(eq(users.id, userId)).limit(1);
  if (user.length === 0) return c.json({ error: "User not found" }, 404);
  const email = await getUserEmailById(userId);
  const chainAccess = isChainFeatureAllowed({
    chainEnvironment: env.CHAIN_ENVIRONMENT,
    whitelistEmails: env.chainWhitelistEmails,
    email,
  });
  const chainMode = buildChainModePayload({ email, access: chainAccess });

  const [ledgerBalance, ledgerRows, topupRows, cryptoTopupRows, paymentRows] = await Promise.all([
    getLatestLedgerBalance(userId),
    listWalletLedgerEntries(userId, 50),
    db.select().from(topups).where(eq(topups.userId, userId)).orderBy(desc(topups.createdAt)).limit(25),
    db.select().from(cryptoTopups).where(eq(cryptoTopups.userId, userId)).orderBy(desc(cryptoTopups.createdAt)).limit(25),
    db.select({
      id: payments.id,
      rentalId: payments.rentalId,
      amount: payments.amount,
      currency: payments.currency,
      method: payments.method,
      status: payments.status,
      createdAt: payments.createdAt,
    }).from(payments).where(eq(payments.userId, userId)).orderBy(desc(payments.createdAt)).limit(50),
  ]);
  const wallet = ledgerBalance
    ? buildWalletSummaryFromBalance({ userId, balance: ledgerBalance.balance, currency: ledgerBalance.currency, source: "wallet-ledger" })
    : buildWalletSummary(user[0]);
  const ledger = ledgerRows.length > 0 ? buildWalletLedger(ledgerRows) : buildLegacyWalletLedger(paymentRows);

  return c.json({
    wallet,
    topups: topupRows.map((topup) => ({
      id: topup.id,
      amount: Number(topup.amount || 0),
      currency: topup.currency || "usd",
      provider: topup.provider,
      status: topup.status,
      stripeSessionId: topup.stripeSessionId,
      createdAt: consoleToIso(topup.createdAt),
      completedAt: consoleToIso(topup.completedAt),
    })),
    cryptoTopups: cryptoTopupRows.map(formatCryptoTopup),
    ledgerEntries: ledger.entries,
    ledgerSource: ledger.source,
    chainMode,
  });
});

app.get("/api/console/audit", verifyAuth, async (c) => {
  const userId = c.get("userId");
  await Promise.all([ensureComplianceSchema(), ensureAuditEventSchema()]);
  const userRentals = await db.select({
    id: rentals.id,
    protocol: rentals.protocol,
    complianceProfileId: rentals.complianceProfileId,
    compliancePolicyVersion: rentals.compliancePolicyVersion,
    complianceEnforcedAt: rentals.complianceEnforcedAt,
  }).from(rentals).where(eq(rentals.userId, userId));
  const rentalIds = userRentals.map((rental) => rental.id);
  const [recentAuditEntries, profiles, structuredEvents, complianceStatRows] = await Promise.all([
    rentalIds.length > 0
      ? db.select().from(auditLog).where(inArray(auditLog.rentalId, rentalIds)).orderBy(desc(auditLog.createdAt)).limit(50)
      : Promise.resolve([]),
    listComplianceProfiles(),
    listAuditEvents(25),
    listComplianceStatsForRentals(rentalIds),
  ]);
  const complianceStatMap = new Map(complianceStatRows.map((stat) => [stat.rentalId, stat]));

  return c.json({
    auditEntries: recentAuditEntries.map(formatConsoleAuditEntry),
    compliance: {
      status: "active",
      message: "Compliance profiles are stored on rentals and enforced before provisioning.",
      profiles,
      rentals: userRentals.map((rental) => ({
        rentalId: rental.id,
        protocol: rental.protocol,
        profileId: rental.complianceProfileId || "standard",
        policyVersion: rental.compliancePolicyVersion || null,
        enforcedAt: consoleToIso(rental.complianceEnforcedAt),
        stats: formatComplianceStat(complianceStatMap.get(rental.id) || null),
      })),
      blockedEvents: [],
    },
    structuredEvents: structuredEvents
      .filter((event) => !event.actorUserId || event.actorUserId === userId || !event.rentalId || rentalIds.includes(event.rentalId))
      .slice(0, 10)
      .map(formatAuditEvent),
  });
});

app.get("/api/console/referrals", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const payload = await getReferralConsoleData(userId);
  return c.json(payload);
});

app.post("/api/console/referrals/bind", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const freezeBlock = await getUserFreezeBlock(userId);
  if (freezeBlock) {
    return c.json(freezeBlock, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const result = await bindInviteCode({
    inviteeId: userId,
    code: String(toRecord(body).code || ""),
  });
  if (!result.ok) {
    return c.json({ error: result.error }, toHttpStatus(result.status));
  }

  await recordStructuredAudit(c, {
    eventType: "referral_invite_bound",
    payload: {
      inviteCodeId: result.binding.inviteCodeId,
      inviterId: result.binding.inviterId,
      alreadyBound: result.alreadyBound,
    },
  });
  return c.json({
    binding: result.binding,
    alreadyBound: result.alreadyBound,
    referrals: await getReferralConsoleData(userId),
  });
});

// ============================================================
// Cron Job: Cleanup & Notifications
// ============================================================
async function runCron() {
  const now = new Date();

  // 1. Auto-destroy expired rentals
  const expired = await db.select().from(rentals)
    .where(and(
      or(eq(rentals.status, "active"), eq(rentals.status, "paused")),
      sql`${rentals.expiresAt} <= NOW()`
    ));

  for (const rental of expired) {
    await db.update(rentals).set({ status: "destroyed", updatedAt: new Date() }).where(eq(rentals.id, rental.id));
    await addProvisionJob({ rentalId: rental.id, action: "destroy", vpsId: rental.vpsId ?? undefined, ip: rental.ip ?? undefined });
    await deleteCache(`rental:${rental.id}:config`);
    console.log("Auto-destroyed rental:", rental.id);
  }

  // 2. Release stale provisioning rows that can no longer be delivered.
  const staleProvisioning = await db.select({ id: rentals.id }).from(rentals)
    .where(and(
      eq(rentals.status, "provisioning"),
      sql`${rentals.expiresAt} <= NOW()`
    ));

  for (const rental of staleProvisioning) {
    const released = await releaseFailedProvisioningRental(rental.id, "provisioning expired before delivery");
    if (released) {
      console.log("Released stale provisioning rental:", rental.id);
    }
  }

  // 3. Send renewal reminders
  if (env.NOTIFICATION_WEBHOOK_URL) {
    const expiringSoon = await db.select({
      r: rentals,
      u: users,
    }).from(rentals)
      .innerJoin(users, eq(rentals.userId, users.id))
      .where(and(
        eq(rentals.status, "active"),
        sql`${rentals.expiresAt} <= NOW() + INTERVAL '30 minutes'`,
        sql`${rentals.expiresAt} > NOW()`
      ));

    for (const { r: rental, u: user } of expiringSoon) {
      const reminded = await redis.get(`rental:${rental.id}:last_reminder`);
      if (reminded) continue;

      const remainingMin = Math.floor((rental.expiresAt!.getTime() - now.getTime()) / 60000);
      const message = `[AnixOps] Rental ${rental.id.slice(0, 8)} expires in ${remainingMin} minutes. User: ${user.email}`;

      // Send notification
      try {
        await fetch(env.NOTIFICATION_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "rental_expiring",
            rentalId: rental.id,
            email: user.email,
            remainingMinutes: remainingMin,
            message,
          }),
        });
        await redis.setex(`rental:${rental.id}:last_reminder`, 600, "sent");
      } catch (e) {
        console.error("Failed to send reminder:", e);
      }
    }
  }

  // 4. Preserve destroyed rentals.
  // Physical deletion used to collide with payments.rental_id foreign keys and could
  // crash the API process during cron execution. Keep the history row instead.
}

// Run cron every minute
setInterval(() => {
  void runCron().catch((error) => {
    console.error("Cron job failed:", error);
  });
}, 60000);

// ============================================================
// Provision Worker
// ============================================================
const provisionWorker = createProvisionWorker(async (job) => {
  const {
    rentalId,
    protocol,
    durationHours,
    action,
    vpsId,
    ip,
    provider: jobProvider,
    region: jobRegion,
    plan: jobPlan,
    excludedRegions,
    autoRecovery,
  } = job.data;

  if (action === "destroy") {
    console.log("Destroying rental:", rentalId, "vps:", vpsId, "ip:", ip);
    await insertProvisionStageAudit(rentalId, {
      stage: "stage5-0-destroy-job-start",
      status: "started",
      message: "API worker started destroy job",
      timestamp: new Date().toISOString(),
      meta: { hasVpsId: Boolean(vpsId), hasIp: Boolean(ip) },
    });

    const destroyRes = await postProvisionServer("/api/destroy", { rentalId, vpsId, ip });
    const destroyBody = await readProvisionServerResponse(destroyRes);
    await insertProvisionStageAudits(rentalId, getProvisionStageLogs(destroyBody));

    if (!destroyRes.ok) {
      throw new Error(buildProvisionFailureMessage(destroyRes.status, destroyBody).replace("Provision failed", "Destroy failed"));
    }

    await db.update(rentals).set({ status: "destroyed", updatedAt: new Date() }).where(eq(rentals.id, rentalId));
    await deleteCache(`rental:${rentalId}:config`);
    await insertProvisionStageAudit(rentalId, {
      stage: "stage5-6-api-destroy-complete",
      status: "ok",
      message: "API marked rental destroyed and cleared config cache",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Provision
  if (!isProtocolAllowedForRelease(protocol)) {
    throw new Error("Invalid protocol");
  }
  console.log("Provisioning rental:", rentalId, "protocol:", protocol);

  await ensureRentalPlacementSchema();
  const provisionTarget = await db.select({
    status: rentals.status,
    provider: rentals.provider,
    region: rentals.region,
    plan: rentals.plan,
    complianceProfileId: rentals.complianceProfileId,
    compliancePolicyVersion: rentals.compliancePolicyVersion,
  })
    .from(rentals)
    .where(eq(rentals.id, rentalId))
    .limit(1);
  if (provisionTarget.length === 0 || provisionTarget[0].status !== "provisioning") {
    console.log("Skipping provision job for non-provisioning rental:", rentalId, provisionTarget[0]?.status ?? "missing");
    return;
  }

  const attemptNo = getProvisionAttemptNo(job);
  const maxAttempts = getProvisionMaxAttempts(job);
  const runtimeCatalog = getCatalogRuntimeConfig();
  const autoRecoveryEnabled = autoRecovery !== false;
  const preferredRegion = jobRegion || provisionTarget[0].region || runtimeCatalog.region || "nrt";
  const selectedRegion = selectProvisionRegion({
    preferredRegion,
    attemptNo,
    autoRecovery: autoRecoveryEnabled,
    excludedRegions: normalizeRegionList(excludedRegions),
  });
  const catalog = {
    provider: jobProvider || provisionTarget[0].provider || runtimeCatalog.provider,
    region: selectedRegion,
    plan: jobPlan || provisionTarget[0].plan || runtimeCatalog.plan,
  };
  const complianceResult = await resolveComplianceProfile(provisionTarget[0].complianceProfileId);
  if (!complianceResult.ok) {
    throw new Error(complianceResult.error);
  }
  const complianceCheck = validateProtocolForCompliance(protocol || "", complianceResult.profile);
  if (!complianceCheck.ok) {
    throw new Error(complianceCheck.error);
  }
  await db.update(rentals)
    .set({
      provider: catalog.provider,
      region: catalog.region,
      plan: catalog.plan,
      complianceProfileId: complianceResult.profile.id,
      compliancePolicyVersion: provisionTarget[0].compliancePolicyVersion || complianceResult.profile.version,
      complianceEnforcedAt: new Date(),
      attemptCount: attemptNo,
      updatedAt: new Date(),
    })
    .where(eq(rentals.id, rentalId));
  const attempt = await startProvisionAttempt({
    rentalId,
    attemptNo,
    maxAttempts,
    protocol,
    provider: catalog.provider,
    region: catalog.region,
    plan: catalog.plan,
  });
  let attemptFinished = false;
  let attemptCloudCostAmount = 0;

  await insertProvisionStageAudit(rentalId, {
    stage: "stage4-0-api-job-start",
    status: "started",
    message: "API worker started provision job",
    timestamp: new Date().toISOString(),
    meta: {
      protocol: protocol || null,
      attemptId: attempt.attemptId,
      attempt: attempt.attemptNo,
      maxAttempts: attempt.maxAttempts,
      provider: catalog.provider,
      region: catalog.region,
      plan: catalog.plan,
      autoRecovery: autoRecoveryEnabled,
      complianceProfileId: complianceResult.profile.id,
      compliancePolicyVersion: provisionTarget[0].compliancePolicyVersion || complianceResult.profile.version,
    },
  });

  try {
    const provisionResult = await postProvisionServer("/api/provision", {
      rentalId,
      protocol,
      attemptId: attempt.attemptId,
      attemptNo: attempt.attemptNo,
      maxAttempts: attempt.maxAttempts,
      provider: catalog.provider,
      region: catalog.region,
      plan: catalog.plan,
      compliancePolicy: buildCompliancePolicyPayload(complianceResult.profile),
    });
    const provisionBody = await readProvisionServerResponse(provisionResult);
    const provisionStageLogs = getProvisionStageLogs(provisionBody);
    await insertProvisionStageAudits(rentalId, provisionStageLogs);
    attemptCloudCostAmount = calculateProvisionAttemptCloudCost(catalog.provider, provisionStageLogs);

    if (!provisionResult.ok) {
      const summary = summarizeProvisionAttemptStageLogs(provisionStageLogs);
      await finishProvisionAttempt({
        attemptId: attempt.attemptId,
        rentalId,
        status: summary.cleanupConfirmed ? "failed_destroyed" : "failed",
        failureReason: buildProvisionFailureMessage(provisionResult.status, provisionBody),
        vpsId: summary.vpsId,
        ip: summary.ip,
        probeRunId: summary.probeRunId,
        cloudCostAmount: attemptCloudCostAmount,
        cloudCostCurrency: "usd",
      });
      attemptFinished = true;
      throw new Error(buildProvisionFailureMessage(provisionResult.status, provisionBody));
    }

    const data = provisionBody as { config: Record<string, unknown>; ip: string; vpsId: string };
    const configValidation = normalizeProvisionedConfig(data.config);
    if (!configValidation.ok) {
      const invalidReason = configValidation.error;
      await insertProvisionStageAudit(rentalId, {
        stage: "stage4-2-cache-config",
        status: "failed",
        message: invalidReason,
        timestamp: new Date().toISOString(),
        meta: { attemptId: attempt.attemptId, attempt: attempt.attemptNo, maxAttempts: attempt.maxAttempts },
      });
      await releaseFailedProvisioningRental(rentalId, invalidReason, "failed");
      try {
        await postProvisionServer("/api/destroy", {
          rentalId,
          vpsId: data.vpsId,
          ip: data.ip,
          attemptId: attempt.attemptId,
          reason: "provision_result_incomplete",
        });
      } catch (error) {
        console.error("Failed to destroy incomplete provision result:", rentalId, getErrorMessage(error));
      }
      await finishProvisionAttempt({
        attemptId: attempt.attemptId,
        rentalId,
        status: "failed",
        failureReason: invalidReason,
        vpsId: data.vpsId,
        ip: data.ip,
        cloudCostAmount: attemptCloudCostAmount,
        cloudCostCurrency: "usd",
      });
      attemptFinished = true;
      console.error("Provisioned config rejected because it is incomplete:", rentalId);
      return;
    }

    // Cache config
    const ttl = ((durationHours ?? 24) + 1) * 3600;
    await insertProvisionStageAudit(rentalId, {
      stage: "stage4-2-cache-config",
      status: "started",
      message: "API caching provisioned config",
      timestamp: new Date().toISOString(),
      meta: { ttl, attemptId: attempt.attemptId, attempt: attempt.attemptNo, maxAttempts: attempt.maxAttempts },
    });
    await setCache(`rental:${rentalId}:config`, configValidation.config, ttl);

    // Update rental
    const updated = await db.update(rentals)
      .set({ status: "active", ip: data.ip, vpsId: data.vpsId, updatedAt: new Date() })
      .where(and(eq(rentals.id, rentalId), eq(rentals.status, "provisioning")))
      .returning({ id: rentals.id });

    if (updated.length === 0) {
      await deleteCache(`rental:${rentalId}:config`);
      try {
        await postProvisionServer("/api/destroy", {
          rentalId,
          vpsId: data.vpsId,
          ip: data.ip,
          attemptId: attempt.attemptId,
          reason: "provision_result_discarded",
        });
      } catch (error) {
        console.error("Failed to destroy provision result for released rental:", rentalId, getErrorMessage(error));
      }
      await finishProvisionAttempt({
        attemptId: attempt.attemptId,
        rentalId,
        status: "abandoned",
        failureReason: "Provision result discarded because rental is no longer provisioning",
        vpsId: data.vpsId,
        ip: data.ip,
        cloudCostAmount: attemptCloudCostAmount,
        cloudCostCurrency: "usd",
      });
      attemptFinished = true;
      console.log("Provision result discarded for released rental:", rentalId);
      return;
    }

    await finishProvisionAttempt({
      attemptId: attempt.attemptId,
      rentalId,
      status: "succeeded",
      vpsId: data.vpsId,
      ip: data.ip,
      cloudCostAmount: attemptCloudCostAmount,
      cloudCostCurrency: "usd",
    });
    attemptFinished = true;

    await insertProvisionStageAudit(rentalId, {
      stage: "stage4-3-db-active",
      status: "ok",
      message: "API marked rental active",
      timestamp: new Date().toISOString(),
      meta: { vpsId: data.vpsId, ip: data.ip, attemptId: attempt.attemptId, attempt: attempt.attemptNo, maxAttempts: attempt.maxAttempts },
    });
    console.log("Provisioned:", rentalId, "ip:", data.ip);
  } catch (error) {
    if (!attemptFinished) {
      await finishProvisionAttempt({
        attemptId: attempt.attemptId,
        rentalId,
        status: "failed",
        failureReason: getErrorMessage(error),
        cloudCostAmount: attemptCloudCostAmount,
        cloudCostCurrency: "usd",
      });
    }
    throw error;
  }
});

provisionWorker.on("failed", async (job, err) => {
  console.error("Job failed:", job?.id, err.message);
  if (!job || !hasExhaustedAttempts(job) || job.data.action === "destroy") {
    return;
  }

  try {
    await ensureProvisionAttemptSchema();
    const released = await releaseFailedProvisioningRental(
      job.data.rentalId,
      `provision job failed after ${job.attemptsMade} attempts: ${err.message}`,
      "failed",
    );
    if (released) {
      console.error("Marked failed provisioning rental:", job.data.rentalId);
    }
  } catch (releaseError) {
    console.error("Failed to release provisioning rental:", getErrorMessage(releaseError));
  }
});

// ============================================================
// Start Server
// ============================================================
await Promise.all([
  ensureAdminUserSchema(),
  ensureRedeemCodeModeSchema(),
  ensurePaymentMethodSchema(),
  ensureReferralSchema(),
  ensureCryptoTopupSchema(),
  ensureComplianceSchema(),
  ensureComplianceStatsSchema(),
  ensureAuditEventSchema(),
]);

const port = parseInt(env.PORT);
serve({
  fetch: app.fetch,
  port,
});

console.log(`AnixOps Server running on port ${port}`);
