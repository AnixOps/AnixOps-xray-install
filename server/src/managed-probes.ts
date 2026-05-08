import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import { db, probeNodes, probeResults, probeRuns } from "./db/index.js";
import { summarizeProbeResults } from "./lib/probe-service.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type ManagedProbeProvider = "globalping";

export type ManagedProbeConfig = {
  provider: ManagedProbeProvider | null;
  globalpingApiUrl: string;
  globalpingToken: string | null;
  globalpingCountry: string;
  globalpingEyeballBias: boolean;
};

export type ManagedProbeCreateInput = {
  ip: string;
  port: number;
  minNodes: number;
};

export type ManagedProbeRunRef = {
  id: string;
  rentalId: string | null;
  attemptId: string | null;
  ip: string;
  port: number;
  protocol: string | null;
  status: string;
  requiredNodes: number | null;
  passThreshold: number | null;
  provider: string | null;
  providerRunId: string | null;
};

type ManagedProbeCreateResult = {
  provider: ManagedProbeProvider;
  providerRunId: string;
  detail: string;
};

type ManagedProbeObservation = {
  nodeId: string;
  ok: boolean | null;
  status: string;
  latencyMs?: number;
  detail?: string;
  provider: string;
  region: string;
  province: string | null;
  city: string;
  endpoint: string;
  version?: string;
};

type ManagedProbeSnapshot = {
  status: "running" | "finished";
  detail: string | null;
  observations: ManagedProbeObservation[];
};

type GlobalpingMeasurement = {
  status?: unknown;
  results?: unknown;
};

type GlobalpingMeasurementResult = {
  probe?: {
    version?: unknown;
    region?: unknown;
    country?: unknown;
    state?: unknown;
    city?: unknown;
    asn?: unknown;
    network?: unknown;
    tags?: unknown;
  };
  result?: {
    status?: unknown;
    stats?: {
      avg?: unknown;
    };
    rawOutput?: unknown;
  };
};

function parseBool(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

export function getManagedProbeConfig(source: NodeJS.ProcessEnv = process.env): ManagedProbeConfig {
  const provider = String(source.PROBE_PROVIDER || source.MAINLAND_PROBE_PROVIDER || "").trim().toLowerCase();
  return {
    provider: provider === "globalping" ? "globalping" : null,
    globalpingApiUrl: String(source.PROBE_GLOBALPING_API_URL || "https://api.globalping.io/v1").trim().replace(/\/+$/, ""),
    globalpingToken: trimOrNull(source.PROBE_GLOBALPING_TOKEN),
    globalpingCountry: String(source.PROBE_GLOBALPING_COUNTRY || "CN").trim().toUpperCase(),
    globalpingEyeballBias: !["0", "false", "no", "off"].includes(String(source.PROBE_GLOBALPING_EYEBALL_BIAS || "true").trim().toLowerCase()),
  };
}

export function shouldUseManagedProbes(source: NodeJS.ProcessEnv = process.env) {
  return parseBool(source.PROBE_ENABLED || source.MAINLAND_PROBE_ENABLED) || Boolean(getManagedProbeConfig(source).provider);
}

export function buildGlobalpingCreatePayload(input: ManagedProbeCreateInput, config: ManagedProbeConfig) {
  const total = Math.max(1, Math.floor(input.minNodes || 1));
  const eyeballLimit = config.globalpingEyeballBias ? Math.max(1, Math.ceil(total / 2)) : 0;
  const datacenterLimit = config.globalpingEyeballBias ? Math.max(1, total - eyeballLimit) : total;
  const locations = config.globalpingEyeballBias
    ? [
      { country: config.globalpingCountry, tags: ["eyeball-network"], limit: eyeballLimit },
      { country: config.globalpingCountry, tags: ["datacenter-network"], limit: datacenterLimit },
    ]
    : [{ country: config.globalpingCountry, limit: total }];

  return {
    target: input.ip,
    type: "ping",
    inProgressUpdates: true,
    locations,
    measurementOptions: {
      protocol: "TCP",
      port: input.port,
    },
  };
}

export async function startManagedProbeRun(
  input: ManagedProbeCreateInput,
  config = getManagedProbeConfig(),
  fetchImpl: FetchLike = fetch,
): Promise<ManagedProbeCreateResult | null> {
  if (config.provider !== "globalping") {
    return null;
  }

  const res = await fetchImpl(`${config.globalpingApiUrl}/measurements`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.globalpingToken ? { Authorization: `Bearer ${config.globalpingToken}` } : {}),
    },
    body: JSON.stringify(buildGlobalpingCreatePayload(input, config)),
    signal: AbortSignal.timeout(8000),
  });
  const body = await readJson(res);
  if (!res.ok) {
    throw new Error(`Globalping create failed: ${res.status}: ${String(body.error || body.message || "unknown error")}`);
  }

  const providerRunId = typeof body.id === "string" && body.id.trim() ? body.id.trim() : "";
  if (!providerRunId) {
    throw new Error("Globalping create response did not include measurement id");
  }

  return {
    provider: "globalping",
    providerRunId,
    detail: config.globalpingEyeballBias
      ? `Queued via Globalping country=${config.globalpingCountry} mode=eyeball+datacenter probes=${Math.max(1, Math.floor(input.minNodes || 1))}`
      : `Queued via Globalping country=${config.globalpingCountry} probes=${Math.max(1, Math.floor(input.minNodes || 1))}`,
  };
}

export async function syncManagedProbeRun(
  run: ManagedProbeRunRef,
  config = getManagedProbeConfig(),
  fetchImpl: FetchLike = fetch,
) {
  if (config.provider !== "globalping" || run.provider !== "globalping" || !run.providerRunId) {
    return false;
  }

  try {
    const snapshot = await fetchGlobalpingMeasurement(run.providerRunId, config, fetchImpl);
    await persistManagedProbeSnapshot(run, snapshot);
  } catch (error) {
    await db.update(probeRuns)
      .set({
        detail: truncate(`Managed probe sync warning: ${error instanceof Error ? error.message : String(error)}`),
        updatedAt: new Date(),
      })
      .where(eq(probeRuns.id, run.id));
  }

  return true;
}

async function fetchGlobalpingMeasurement(
  providerRunId: string,
  config: ManagedProbeConfig,
  fetchImpl: FetchLike,
): Promise<ManagedProbeSnapshot> {
  const res = await fetchImpl(`${config.globalpingApiUrl}/measurements/${encodeURIComponent(providerRunId)}`, {
    headers: {
      ...(config.globalpingToken ? { Authorization: `Bearer ${config.globalpingToken}` } : {}),
    },
    signal: AbortSignal.timeout(8000),
  });
  const body = await readJson(res);
  if (!res.ok) {
    throw new Error(`Globalping poll failed: ${res.status}: ${String(body.error || body.message || "unknown error")}`);
  }

  return mapGlobalpingMeasurement(body as GlobalpingMeasurement);
}

export function mapGlobalpingMeasurement(body: GlobalpingMeasurement): ManagedProbeSnapshot {
  const status = String(body.status || "").trim().toLowerCase() === "finished" ? "finished" : "running";
  const observations = Array.isArray(body.results)
    ? body.results.map((item) => mapGlobalpingResult(item as GlobalpingMeasurementResult)).filter(Boolean) as ManagedProbeObservation[]
    : [];
  return {
    status,
    detail: observations.length > 0 ? null : status === "finished" ? "Globalping finished without terminal probe results" : null,
    observations,
  };
}

function mapGlobalpingResult(item: GlobalpingMeasurementResult): ManagedProbeObservation | null {
  const resultStatus = String(item.result?.status || "").trim().toLowerCase();
  const ok = resultStatus === "finished" ? true : resultStatus === "failed" || resultStatus === "offline" ? false : null;
  const region = String(item.probe?.region || "").trim();
  const province = trimOrNull(item.probe?.state);
  const city = String(item.probe?.city || "").trim();
  const network = String(item.probe?.network || "").trim();
  const asn = Number(item.probe?.asn);
  if (!region || !city || !network || !Number.isFinite(asn)) {
    return null;
  }

  const fingerprint = JSON.stringify({
    provider: "globalping",
    country: String(item.probe?.country || "").trim(),
    state: province,
    city,
    asn,
    network,
    tags: Array.isArray(item.probe?.tags) ? item.probe?.tags : [],
  });
  const nodeId = `globalping:${createHash("sha1").update(fingerprint).digest("hex").slice(0, 40)}`;

  return {
    nodeId,
    ok,
    status: resultStatus || "unknown",
    latencyMs: numberOrUndefined(item.result?.stats?.avg),
    detail: trimOrUndefined(item.result?.rawOutput),
    provider: "globalping",
    region,
    province,
    city,
    endpoint: network,
    version: trimOrUndefined(item.probe?.version),
  };
}

async function persistManagedProbeSnapshot(run: ManagedProbeRunRef, snapshot: ManagedProbeSnapshot) {
  const now = new Date();
  const policy = {
    minNodes: run.requiredNodes || 3,
    passRatio: run.passThreshold || 0.7,
  };

  for (const observation of snapshot.observations) {
    await upsertManagedProbeNode(observation, now);
    if (observation.ok !== null) {
      await upsertManagedProbeResult(run.id, observation, now);
    }
  }

  const resultRows = await db.select({ ok: probeResults.ok })
    .from(probeResults)
    .where(eq(probeResults.probeRunId, run.id));
  const summary = summarizeProbeResults(resultRows, policy);
  let status = summary.status;
  let decision = summary.decision;
  let detail = summary.status === "passed" || summary.status === "failed"
    ? `${summary.passedNodes}/${summary.completedNodes} probe nodes passed via ${run.provider || "managed provider"}`
    : snapshot.detail;

  if (snapshot.status === "finished" && status === "running") {
    status = "failed";
    decision = "fail";
    detail = snapshot.detail || `Managed probe provider finished without enough completed nodes (${summary.completedNodes}/${policy.minNodes})`;
  }

  const terminal = status === "passed" || status === "failed";
  await db.update(probeRuns)
    .set({
      status,
      decision,
      passRatio: summary.passRatio,
      completedNodes: summary.completedNodes,
      detail: truncate(detail || ""),
      completedAt: terminal ? now : null,
      updatedAt: now,
    })
    .where(eq(probeRuns.id, run.id));
}

async function upsertManagedProbeNode(observation: ManagedProbeObservation, now: Date) {
  const existing = await db.select({ id: probeNodes.id })
    .from(probeNodes)
    .where(eq(probeNodes.id, observation.nodeId))
    .limit(1);
  const values = {
    provider: observation.provider,
    region: observation.region,
    province: observation.province,
    city: observation.city,
    endpoint: truncate(observation.endpoint, 240),
    status: "active",
    version: observation.version,
    lastSeenAt: now,
    updatedAt: now,
  };

  if (existing.length > 0) {
    await db.update(probeNodes).set(values).where(eq(probeNodes.id, observation.nodeId));
    return;
  }

  await db.insert(probeNodes).values({
    id: observation.nodeId,
    ...values,
  });
}

async function upsertManagedProbeResult(probeRunId: string, observation: ManagedProbeObservation, now: Date) {
  const existing = await db.select({ id: probeResults.id })
    .from(probeResults)
    .where(and(eq(probeResults.probeRunId, probeRunId), eq(probeResults.probeNodeId, observation.nodeId)))
    .limit(1);
  const values = {
    ok: observation.ok === true,
    latencyMs: observation.latencyMs ?? null,
    errorCode: observation.ok === false ? truncate(observation.status, 120) : null,
    rawDetail: observation.detail ? truncate(observation.detail, 500) : null,
    updatedAt: now,
  };

  if (existing.length > 0) {
    await db.update(probeResults).set(values).where(eq(probeResults.id, existing[0].id));
    return;
  }

  await db.insert(probeResults).values({
    id: `${probeRunId}:${observation.nodeId}`,
    probeRunId,
    probeNodeId: observation.nodeId,
    ok: observation.ok === true,
    latencyMs: observation.latencyMs ?? null,
    errorCode: observation.ok === false ? truncate(observation.status, 120) : null,
    rawDetail: observation.detail ? truncate(observation.detail, 500) : null,
    createdAt: now,
    updatedAt: now,
  });
}

async function readJson(res: Response) {
  const text = await res.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: text.slice(0, 240) };
  }
}

function trimOrNull(value: unknown) {
  const normalized = String(value || "").trim();
  return normalized ? normalized : null;
}

function trimOrUndefined(value: unknown) {
  const normalized = String(value || "").trim();
  return normalized ? normalized : undefined;
}

function numberOrUndefined(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : undefined;
}

function truncate(value: string, max = 500) {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}
