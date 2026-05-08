import { Socket } from "net";
import { ProvisionStageError, StageRecorder, type ProvisionStageLog } from "./stage-log.js";

export type ProbeMode = "disabled" | "external" | "local";
export type ProbeDecision = "pass" | "fail" | "skipped";

export interface ConnectivityProbeConfig {
  enabled: boolean;
  mode: ProbeMode;
  serviceUrl?: string;
  serviceToken?: string;
  timeoutMs: number;
  pollIntervalMs: number;
  maxPolls: number;
  minNodes: number;
  passRatio: number;
}

export interface ConnectivityProbeInput {
  rentalId: string;
  attemptId?: string;
  attemptNo?: number;
  maxAttempts?: number;
  ip: string;
  port: number;
  protocol: string;
}

export interface ConnectivityProbeResult {
  decision: ProbeDecision;
  mode: ProbeMode;
  probeRunId?: string;
  completedNodes?: number;
  requiredNodes?: number;
  passRatio?: number;
  latencyMs?: number;
  detail?: string;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type TcpProbeLike = (host: string, port: number, timeoutMs: number) => Promise<{ ok: boolean; latencyMs?: number; detail?: string }>;

function parseBool(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseRatio(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

export function getConnectivityProbeConfig(source: NodeJS.ProcessEnv = process.env): ConnectivityProbeConfig {
  const serviceUrl = (source.PROBE_SERVICE_URL || source.MAINLAND_PROBE_SERVICE_URL || "").trim();
  const enabled = parseBool(source.PROBE_ENABLED || source.MAINLAND_PROBE_ENABLED) || Boolean(serviceUrl);
  const mode: ProbeMode = !enabled ? "disabled" : serviceUrl ? "external" : "local";

  return {
    enabled,
    mode,
    ...(serviceUrl ? { serviceUrl } : {}),
    serviceToken: source.PROBE_SERVICE_TOKEN || source.MAINLAND_PROBE_TOKEN || source.PROVISION_SERVER_TOKEN || source.SERVER_TOKEN,
    timeoutMs: parsePositiveInt(source.PROBE_TIMEOUT_MS || source.MAINLAND_PROBE_TIMEOUT_MS, 5000),
    pollIntervalMs: parsePositiveInt(source.PROBE_POLL_INTERVAL_MS || source.MAINLAND_PROBE_POLL_INTERVAL_MS, 1000),
    maxPolls: parsePositiveInt(source.PROBE_MAX_POLLS || source.MAINLAND_PROBE_MAX_POLLS, 30),
    minNodes: parsePositiveInt(source.PROBE_MIN_NODES || source.MAINLAND_PROBE_MIN_NODES, 3),
    passRatio: parseRatio(source.PROBE_PASS_RATIO || source.MAINLAND_PROBE_PASS_RATIO, 0.7),
  };
}

function buildProbeHeaders(config: ConnectivityProbeConfig) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.serviceToken) {
    headers.Authorization = `Bearer ${config.serviceToken}`;
  }
  return headers;
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

function normalizeProbeDecision(value: unknown): ProbeDecision | null {
  if (value === "pass" || value === "passed" || value === "ok" || value === true) {
    return "pass";
  }
  if (value === "fail" || value === "failed" || value === "blocked" || value === false) {
    return "fail";
  }
  return null;
}

function numberOrUndefined(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function runExternalProbe(
  input: ConnectivityProbeInput,
  config: ConnectivityProbeConfig,
  fetchImpl: FetchLike,
): Promise<ConnectivityProbeResult> {
  if (!config.serviceUrl) {
    return { decision: "fail", mode: "external", detail: "Probe service URL is not configured" };
  }

  const baseUrl = config.serviceUrl.replace(/\/+$/, "");
  const createRes = await fetchImpl(`${baseUrl}/internal/probes/runs`, {
    method: "POST",
    headers: buildProbeHeaders(config),
    body: JSON.stringify({
      rentalId: input.rentalId,
      attemptId: input.attemptId,
      attemptNo: input.attemptNo,
      maxAttempts: input.maxAttempts,
      ip: input.ip,
      port: input.port,
      protocol: input.protocol,
      policy: {
        minNodes: config.minNodes,
        timeoutMs: config.timeoutMs,
        passRatio: config.passRatio,
      },
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  const created = await readJson(createRes);
  if (!createRes.ok) {
    return {
      decision: "fail",
      mode: "external",
      detail: `Probe service create failed: ${createRes.status}: ${String(created.error || created.detail || "unknown")}`,
    };
  }

  const probeRunId = typeof created.probeRunId === "string"
    ? created.probeRunId
    : typeof created.id === "string"
      ? created.id
      : "";
  if (!probeRunId) {
    return { decision: "fail", mode: "external", detail: "Probe service did not return probeRunId" };
  }

  for (let i = 0; i < config.maxPolls; i++) {
    const statusRes = await fetchImpl(`${baseUrl}/internal/probes/runs/${encodeURIComponent(probeRunId)}`, {
      headers: buildProbeHeaders(config),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    const statusBody = await readJson(statusRes);
    if (!statusRes.ok) {
      return {
        decision: "fail",
        mode: "external",
        probeRunId,
        detail: `Probe service status failed: ${statusRes.status}: ${String(statusBody.error || statusBody.detail || "unknown")}`,
      };
    }

    const decision = normalizeProbeDecision(statusBody.decision || statusBody.ok);
    const status = typeof statusBody.status === "string" ? statusBody.status : "";
    const passRatio = numberOrUndefined(statusBody.passRatio);
    if (decision || ["completed", "failed", "passed"].includes(status)) {
      const finalDecision = decision || (passRatio !== undefined && passRatio >= config.passRatio ? "pass" : "fail");
      return {
        decision: finalDecision,
        mode: "external",
        probeRunId,
        completedNodes: numberOrUndefined(statusBody.completedNodes),
        requiredNodes: numberOrUndefined(statusBody.requiredNodes) ?? config.minNodes,
        passRatio,
        detail: typeof statusBody.detail === "string" ? statusBody.detail : undefined,
      };
    }

    await sleep(config.pollIntervalMs);
  }

  return { decision: "fail", mode: "external", probeRunId, detail: "Probe service polling timed out" };
}

export async function localTcpProbe(host: string, port: number, timeoutMs: number): Promise<{ ok: boolean; latencyMs?: number; detail?: string }> {
  const started = Date.now();
  return await new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;

    const finish = (ok: boolean, detail?: string) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve({ ok, latencyMs: Date.now() - started, detail });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false, "timeout"));
    socket.once("error", (error) => finish(false, error.message));
    socket.connect(port, host);
  });
}

export async function runConnectivityProbe(
  input: ConnectivityProbeInput,
  config = getConnectivityProbeConfig(),
  fetchImpl: FetchLike = fetch,
  tcpProbeImpl: TcpProbeLike = localTcpProbe,
): Promise<ConnectivityProbeResult> {
  if (!config.enabled || config.mode === "disabled") {
    return { decision: "skipped", mode: "disabled", detail: "Connectivity probe is disabled" };
  }

  if (config.mode === "external") {
    return await runExternalProbe(input, config, fetchImpl);
  }

  const result = await tcpProbeImpl(input.ip, input.port, config.timeoutMs);
  return {
    decision: result.ok ? "pass" : "fail",
    mode: "local",
    completedNodes: 1,
    requiredNodes: 1,
    passRatio: result.ok ? 1 : 0,
    latencyMs: result.latencyMs,
    detail: result.detail,
  };
}

export async function verifyDeliveryConnectivity(
  input: ConnectivityProbeInput,
  stages: StageRecorder,
  config = getConnectivityProbeConfig(),
): Promise<ConnectivityProbeResult> {
  const attemptMeta = {
    attemptId: input.attemptId || null,
    attempt: input.attemptNo || null,
    maxAttempts: input.maxAttempts || null,
  };

  if (!config.enabled || config.mode === "disabled") {
    const result = await runConnectivityProbe(input, config);
    stages.record("stage2.5-0-probe-skipped", "info", "Mainland connectivity probe disabled", {
      ...attemptMeta,
      ip: input.ip,
      port: input.port,
      protocol: input.protocol,
    });
    return result;
  }

  stages.record("stage2.5-1-probe-start", "started", "Running delivery connectivity probe", {
    ...attemptMeta,
    ip: input.ip,
    port: input.port,
    protocol: input.protocol,
    mode: config.mode,
    minNodes: config.minNodes,
    passRatio: config.passRatio,
  });
  const result = await runConnectivityProbe(input, config);
  const meta = {
    ...attemptMeta,
    ip: input.ip,
    port: input.port,
    protocol: input.protocol,
    mode: result.mode,
    probeRunId: result.probeRunId || null,
    completedNodes: result.completedNodes || null,
    requiredNodes: result.requiredNodes || null,
    passRatio: result.passRatio ?? null,
    latencyMs: result.latencyMs || null,
    detail: result.detail ? result.detail.slice(0, 160) : null,
  };

  if (result.decision === "pass") {
    stages.record("stage2.5-2-probe-result", "ok", "Delivery connectivity probe passed", meta);
    return result;
  }

  stages.fail("stage2.5-3-probe-failed", "Delivery connectivity probe failed", new Error(result.detail || "probe failed"), meta);
}

export function getStageLogsFromError(error: unknown): ProvisionStageLog[] {
  return error instanceof ProvisionStageError ? error.logs : [];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
