import { getProviderStartupCostUsd } from "../provider-costs.js";

export type ProvisionAttemptJobLike = {
  attemptsMade?: number;
  opts?: {
    attempts?: number;
  };
};

export type ProvisionAttemptStageLog = {
  stage: string;
  status: string;
  message: string;
  meta?: Record<string, unknown>;
};

export function getProvisionAttemptNo(job: ProvisionAttemptJobLike) {
  const attemptsMade = Number(job.attemptsMade || 0);
  return Math.max(1, Math.floor(attemptsMade) + 1);
}

export function getProvisionMaxAttempts(job: ProvisionAttemptJobLike) {
  const attempts = Number(job.opts?.attempts || 1);
  return Number.isFinite(attempts) ? Math.max(1, Math.floor(attempts)) : 1;
}

export function buildProvisionAttemptId(rentalId: string, attemptNo: number) {
  return `${rentalId}:attempt:${attemptNo}`;
}

export function summarizeProvisionAttemptStageLogs(stageLogs: ProvisionAttemptStageLog[]) {
  const reversed = [...stageLogs].reverse();
  const latestMetaValue = (key: string) => {
    for (const log of reversed) {
      const value = log.meta?.[key];
      if (value !== undefined && value !== null && value !== "") {
        return value;
      }
    }
    return null;
  };
  const failedLog = reversed.find((log) => log.status === "failed");
  const cleanupLog = reversed.find((log) => log.stage === "stage2.5-4-probe-failed-destroy" && log.status === "ok");
  const detail = typeof failedLog?.meta?.detail === "string" ? failedLog.meta.detail : null;
  const cloudServerCreated = didProvisionAttemptCreateCloudServer(stageLogs);

  return {
    vpsId: toStringOrNull(latestMetaValue("vpsId")),
    ip: toStringOrNull(latestMetaValue("ip")),
    probeRunId: toStringOrNull(latestMetaValue("probeRunId")),
    cleanupConfirmed: Boolean(cleanupLog),
    cloudServerCreated,
    failureReason: detail || failedLog?.message || null,
  };
}

export function didProvisionAttemptCreateCloudServer(stageLogs: ProvisionAttemptStageLog[]) {
  return stageLogs.some((log) =>
    log.stage === "stage1-3-vps-create" &&
    log.status === "ok" &&
    log.message === "Create VPS through cloud provider API"
  );
}

export function calculateProvisionAttemptCloudCost(provider: string | null | undefined, stageLogs: ProvisionAttemptStageLog[]) {
  return didProvisionAttemptCreateCloudServer(stageLogs) ? getProviderStartupCostUsd(provider) : 0;
}

function toStringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
