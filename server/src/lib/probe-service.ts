export type ProbePolicy = {
  minNodes: number;
  timeoutMs: number;
  passRatio: number;
};

export type ProbeResultLike = {
  ok: boolean;
};

function positiveInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function ratio(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

export function normalizeProbePolicy(input: unknown): ProbePolicy {
  const record = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};

  return {
    minNodes: positiveInt(record.minNodes, 3),
    timeoutMs: positiveInt(record.timeoutMs, 5000),
    passRatio: ratio(record.passRatio, 0.7),
  };
}

export function summarizeProbeResults(results: ProbeResultLike[], policy: { minNodes: number; passRatio: number }) {
  const completedNodes = results.length;
  const passedNodes = results.filter((result) => result.ok).length;
  const passRatio = completedNodes > 0 ? Math.round((passedNodes / completedNodes) * 10000) / 10000 : null;
  const hasQuorum = completedNodes >= policy.minNodes;
  const decision = hasQuorum && passRatio !== null
    ? passRatio >= policy.passRatio ? "pass" : "fail"
    : null;

  return {
    completedNodes,
    passedNodes,
    passRatio,
    status: decision === "pass" ? "passed" : decision === "fail" ? "failed" : "running",
    decision,
  };
}

export function normalizeProbeNodeStatus(value: unknown) {
  const status = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ["active", "degraded", "offline", "disabled"].includes(status) ? status : "active";
}
