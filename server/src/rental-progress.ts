export type RentalProgressStageStatus = "started" | "ok" | "failed" | "info" | "warn" | string;

export type RentalProgressStageLog = {
  id?: number;
  rentalId?: string | null;
  stage: string;
  status: RentalProgressStageStatus;
  message: string;
  meta?: Record<string, unknown>;
  createdAt?: Date | string | null;
};

export type RentalProgressRental = {
  id: string;
  status: string;
  protocol?: string | null;
  ip?: string | null;
  vpsId?: string | null;
  expiresAt?: Date | string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
};

export type RentalProgressPayload = {
  rentalId: string;
  status: string;
  stage: string;
  message: string;
  percent: number;
  updatedAt: string | null;
  attempt: {
    attemptNo: number | null;
    maxAttempts: number | null;
    ip: string | null;
    vpsId: string | null;
  };
  probe: {
    status: string;
    probeRunId: string | null;
    completedNodes: number | null;
    requiredNodes: number | null;
    passRatio: number | null;
  } | null;
  billing: {
    remainingMinutes: number;
    expiresAt: string | null;
  };
  stageLogs: RentalProgressStageLog[];
};

function toTime(value: Date | string | null | undefined) {
  if (!value) {
    return 0;
  }
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function toIso(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }
  const time = toTime(value);
  return time > 0 ? new Date(time).toISOString() : null;
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toStringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function defaultStageForStatus(status: string) {
  switch (status) {
    case "pending_payment":
      return "stage0-0-payment-pending";
    case "pending":
      return "stage0-1-queued";
    case "provisioning":
      return "stage1-0-provider-pending";
    case "probing":
      return "stage2.5-0-probe-pending";
    case "configuring":
      return "stage3-0-configuring";
    case "active":
      return "stage4-3-db-active";
    case "paused":
      return "stage4-4-paused";
    case "destroying":
      return "stage5-0-destroy-pending";
    case "destroyed":
      return "stage5-6-api-destroy-complete";
    case "expired":
      return "stage6-4-expired";
    case "failed":
      return "stage0-9-failed";
    case "released":
      return "stage0-8-released";
    default:
      return "stage0-0-unknown";
  }
}

function defaultMessageForStatus(status: string) {
  switch (status) {
    case "pending_payment":
      return "Waiting for payment confirmation";
    case "pending":
      return "Rental is queued";
    case "provisioning":
      return "Allocating cloud resource";
    case "probing":
      return "Testing network quality";
    case "configuring":
      return "Configuring node";
    case "active":
      return "Node is ready";
    case "paused":
      return "Rental is paused";
    case "destroying":
      return "Destroying cloud resource";
    case "destroyed":
      return "Rental has been destroyed";
    case "expired":
      return "Rental has expired";
    case "failed":
      return "Rental delivery failed";
    case "released":
      return "Rental was released";
    default:
      return "Rental status is being tracked";
  }
}

function percentForStage(stage: string) {
  if (stage.startsWith("stage0-")) return 10;
  if (stage.startsWith("stage1-")) return 25;
  if (stage.startsWith("stage2.5-")) return 55;
  if (stage.startsWith("stage2-")) return 40;
  if (stage.startsWith("stage3-")) return 75;
  if (stage.startsWith("stage4-0") || stage.startsWith("stage4-1")) return 85;
  if (stage.startsWith("stage4-2")) return 92;
  if (stage.startsWith("stage4-3")) return 100;
  if (stage.startsWith("stage5-")) return 90;
  if (stage.startsWith("stage6-")) return 100;
  return 25;
}

function percentForStatus(status: string, stage: string) {
  switch (status) {
    case "pending_payment":
      return 5;
    case "pending":
      return 10;
    case "active":
    case "paused":
    case "destroyed":
    case "expired":
    case "failed":
    case "released":
      return 100;
    case "destroying":
      return Math.max(90, percentForStage(stage));
    default:
      return percentForStage(stage);
  }
}

function getLatestStageLog(stageLogs: RentalProgressStageLog[]) {
  return stageLogs.length > 0 ? stageLogs[stageLogs.length - 1] : null;
}

function normalizeStageLogs(stageLogs: RentalProgressStageLog[]) {
  return [...stageLogs].sort((a, b) => {
    const delta = toTime(a.createdAt) - toTime(b.createdAt);
    if (delta !== 0) {
      return delta;
    }
    return (a.id ?? 0) - (b.id ?? 0);
  });
}

function getLatestMetaValue(stageLogs: RentalProgressStageLog[], key: string) {
  for (const log of [...stageLogs].reverse()) {
    const value = log.meta?.[key];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return null;
}

function buildAttempt(rental: RentalProgressRental, stageLogs: RentalProgressStageLog[]) {
  return {
    attemptNo: toNumber(getLatestMetaValue(stageLogs, "attempt")),
    maxAttempts: toNumber(getLatestMetaValue(stageLogs, "maxAttempts")),
    ip: toStringOrNull(getLatestMetaValue(stageLogs, "ip")) || rental.ip || null,
    vpsId: toStringOrNull(getLatestMetaValue(stageLogs, "vpsId")) || rental.vpsId || null,
  };
}

function buildProbe(stageLogs: RentalProgressStageLog[]) {
  const latestProbe = [...stageLogs].reverse().find((log) => log.stage.startsWith("stage2.5-"));
  if (!latestProbe) {
    return null;
  }

  const meta = latestProbe.meta || {};
  return {
    status: latestProbe.status,
    probeRunId: toStringOrNull(meta.probeRunId),
    completedNodes: toNumber(meta.completedNodes),
    requiredNodes: toNumber(meta.requiredNodes),
    passRatio: toNumber(meta.passRatio),
  };
}

function getRemainingMinutes(expiresAt: Date | string | null | undefined, now: number) {
  const expiresTime = toTime(expiresAt);
  if (!expiresTime) {
    return 0;
  }
  return Math.max(0, Math.floor((expiresTime - now) / 60000));
}

export function buildRentalProgressPayload(
  rental: RentalProgressRental,
  stageLogs: RentalProgressStageLog[],
  now = Date.now(),
): RentalProgressPayload {
  const normalizedStageLogs = normalizeStageLogs(stageLogs);
  const latestLog = getLatestStageLog(normalizedStageLogs);
  const stage = latestLog?.stage || defaultStageForStatus(rental.status);
  const message = latestLog?.message || defaultMessageForStatus(rental.status);

  return {
    rentalId: rental.id,
    status: rental.status,
    stage,
    message,
    percent: percentForStatus(rental.status, stage),
    updatedAt: toIso(rental.updatedAt || rental.createdAt),
    attempt: buildAttempt(rental, normalizedStageLogs),
    probe: buildProbe(normalizedStageLogs),
    billing: {
      remainingMinutes: getRemainingMinutes(rental.expiresAt, now),
      expiresAt: toIso(rental.expiresAt),
    },
    stageLogs: normalizedStageLogs,
  };
}
