export type ProbeStageStatus = "started" | "ok" | "failed" | "info" | "warn" | string;

export type ProbeStageLog = {
  id?: number;
  rentalId?: string | null;
  stage: string;
  status: ProbeStageStatus;
  message: string;
  meta?: Record<string, unknown>;
  createdAt?: Date | string | null;
};

export type ProbeEvent = {
  id: number | null;
  rentalId: string | null;
  stage: string;
  status: ProbeStageStatus;
  message: string;
  createdAt: string | null;
  meta: Record<string, string | number | boolean | null>;
};

export type ProbeRunDecision = "pass" | "fail" | "skipped" | null;
export type ProbeRunStatus = "running" | "passed" | "failed" | "skipped" | "unknown";

export type ProbeRunSummary = {
  rentalId: string | null;
  probeRunId: string | null;
  status: ProbeRunStatus;
  decision: ProbeRunDecision;
  mode: string | null;
  protocol: string | null;
  ip: string | null;
  port: number | null;
  completedNodes: number | null;
  requiredNodes: number | null;
  passRatio: number | null;
  latencyMs: number | null;
  detail: string | null;
  stage: string;
  message: string;
  startedAt: string | null;
  completedAt: string | null;
  lastEventAt: string | null;
  cleanup: {
    stage: string;
    status: ProbeStageStatus;
    message: string;
    createdAt: string | null;
  } | null;
  events: ProbeEvent[];
};

export type RentalProbePayload = {
  rentalId: string;
  status: string;
  ip: string | null;
  vpsId: string | null;
  current: ProbeRunSummary | null;
  summary: {
    totalRuns: number;
    passedRuns: number;
    failedRuns: number;
    skippedRuns: number;
    runningRuns: number;
    latestDecision: ProbeRunDecision;
  };
  runs: ProbeRunSummary[];
  events: ProbeEvent[];
};

type ProbeRental = {
  id: string;
  status: string;
  ip?: string | null;
  vpsId?: string | null;
};

type ProbeRunBuilder = {
  rentalId: string | null;
  probeRunId: string | null;
  events: ProbeEvent[];
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

function normalizeStageLogs(stageLogs: ProbeStageLog[]) {
  return stageLogs
    .filter((log) => log.stage.startsWith("stage2.5-"))
    .sort((a, b) => {
      const delta = toTime(a.createdAt) - toTime(b.createdAt);
      if (delta !== 0) {
        return delta;
      }
      return (a.id ?? 0) - (b.id ?? 0);
    });
}

function sanitizeMeta(meta: Record<string, unknown> | undefined) {
  const sanitized: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(meta || {})) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (
      normalizedKey.includes("token")
      || normalizedKey.includes("secret")
      || normalizedKey.includes("password")
      || normalizedKey.includes("credential")
      || normalizedKey.includes("authorization")
      || normalizedKey === "key"
      || (normalizedKey.endsWith("key") && normalizedKey !== "publickey")
    ) {
      sanitized[key] = "[redacted]";
    } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function toProbeEvent(log: ProbeStageLog): ProbeEvent {
  return {
    id: log.id ?? null,
    rentalId: log.rentalId ?? null,
    stage: log.stage,
    status: log.status,
    message: log.message,
    createdAt: toIso(log.createdAt),
    meta: sanitizeMeta(log.meta),
  };
}

function isStartStage(event: ProbeEvent) {
  return event.stage === "stage2.5-1-probe-start";
}

function isTerminalStage(event: ProbeEvent) {
  return event.stage === "stage2.5-0-probe-skipped"
    || event.stage === "stage2.5-2-probe-result"
    || event.stage === "stage2.5-3-probe-failed";
}

function isCleanupStage(event: ProbeEvent) {
  return event.stage === "stage2.5-4-probe-failed-destroy";
}

function eventTime(event: ProbeEvent) {
  return event.createdAt ? Date.parse(event.createdAt) : 0;
}

function addEvent(builder: ProbeRunBuilder, event: ProbeEvent) {
  builder.events.push(event);
  const probeRunId = toStringOrNull(event.meta.probeRunId);
  if (probeRunId) {
    builder.probeRunId = probeRunId;
  }
  if (!builder.rentalId && event.rentalId) {
    builder.rentalId = event.rentalId;
  }
}

function latestEvent(builder: ProbeRunBuilder) {
  return builder.events[builder.events.length - 1] || null;
}

function latestTerminalEvent(builder: ProbeRunBuilder) {
  return [...builder.events].reverse().find(isTerminalStage) || null;
}

function firstStartEvent(builder: ProbeRunBuilder) {
  return builder.events.find(isStartStage) || null;
}

function latestCleanupEvent(builder: ProbeRunBuilder) {
  return [...builder.events].reverse().find(isCleanupStage) || null;
}

function getRunStatus(terminal: ProbeEvent | null): { status: ProbeRunStatus; decision: ProbeRunDecision } {
  if (!terminal) {
    return { status: "running", decision: null };
  }

  if (terminal.stage === "stage2.5-0-probe-skipped") {
    return { status: "skipped", decision: "skipped" };
  }
  if (terminal.stage === "stage2.5-2-probe-result" && terminal.status === "ok") {
    return { status: "passed", decision: "pass" };
  }
  if (terminal.stage === "stage2.5-3-probe-failed" || terminal.status === "failed") {
    return { status: "failed", decision: "fail" };
  }
  return { status: "unknown", decision: null };
}

function valueFromEvents(events: ProbeEvent[], key: string) {
  for (const event of [...events].reverse()) {
    const value = event.meta[key];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return null;
}

function buildProbeRun(builder: ProbeRunBuilder): ProbeRunSummary {
  const events = [...builder.events].sort((a, b) => {
    const delta = eventTime(a) - eventTime(b);
    if (delta !== 0) {
      return delta;
    }
    return (a.id ?? 0) - (b.id ?? 0);
  });
  const terminal = latestTerminalEvent({ ...builder, events });
  const latest = events[events.length - 1] || terminal;
  const start = firstStartEvent({ ...builder, events }) || events[0] || null;
  const cleanup = latestCleanupEvent({ ...builder, events });
  const state = getRunStatus(terminal);

  return {
    rentalId: builder.rentalId,
    probeRunId: builder.probeRunId || toStringOrNull(valueFromEvents(events, "probeRunId")),
    status: state.status,
    decision: state.decision,
    mode: toStringOrNull(valueFromEvents(events, "mode")),
    protocol: toStringOrNull(valueFromEvents(events, "protocol")),
    ip: toStringOrNull(valueFromEvents(events, "ip")),
    port: toNumber(valueFromEvents(events, "port")),
    completedNodes: toNumber(valueFromEvents(events, "completedNodes")),
    requiredNodes: toNumber(valueFromEvents(events, "requiredNodes")),
    passRatio: toNumber(valueFromEvents(events, "passRatio")),
    latencyMs: toNumber(valueFromEvents(events, "latencyMs")),
    detail: toStringOrNull(valueFromEvents(events, "detail")),
    stage: latest?.stage || "stage2.5-unknown",
    message: latest?.message || "Probe status is unavailable",
    startedAt: start?.createdAt || null,
    completedAt: terminal?.createdAt || null,
    lastEventAt: latest?.createdAt || null,
    cleanup: cleanup
      ? {
        stage: cleanup.stage,
        status: cleanup.status,
        message: cleanup.message,
        createdAt: cleanup.createdAt,
      }
      : null,
    events,
  };
}

export function buildProbeRunSummaries(stageLogs: ProbeStageLog[]) {
  const events = normalizeStageLogs(stageLogs).map(toProbeEvent);
  const builders: ProbeRunBuilder[] = [];
  const currentByRentalId = new Map<string, ProbeRunBuilder>();
  const latestByRentalId = new Map<string, ProbeRunBuilder>();
  const byProbeRunId = new Map<string, ProbeRunBuilder>();

  const createBuilder = (event: ProbeEvent) => {
    const builder: ProbeRunBuilder = {
      rentalId: event.rentalId,
      probeRunId: toStringOrNull(event.meta.probeRunId),
      events: [],
    };
    builders.push(builder);
    if (builder.probeRunId) {
      byProbeRunId.set(builder.probeRunId, builder);
    }
    return builder;
  };

  for (const event of events) {
    const rentalKey = event.rentalId || "unknown";
    const probeRunId = toStringOrNull(event.meta.probeRunId);

    if (isStartStage(event)) {
      const builder = createBuilder(event);
      addEvent(builder, event);
      currentByRentalId.set(rentalKey, builder);
      latestByRentalId.set(rentalKey, builder);
      continue;
    }

    if (isTerminalStage(event)) {
      let builder = probeRunId ? byProbeRunId.get(probeRunId) : undefined;
      if (!builder) {
        builder = currentByRentalId.get(rentalKey) || createBuilder(event);
      }
      addEvent(builder, event);
      if (probeRunId) {
        byProbeRunId.set(probeRunId, builder);
      }
      currentByRentalId.delete(rentalKey);
      latestByRentalId.set(rentalKey, builder);
      continue;
    }

    if (isCleanupStage(event)) {
      const builder = latestByRentalId.get(rentalKey) || currentByRentalId.get(rentalKey) || createBuilder(event);
      addEvent(builder, event);
      latestByRentalId.set(rentalKey, builder);
      continue;
    }

    const builder = currentByRentalId.get(rentalKey) || latestByRentalId.get(rentalKey) || createBuilder(event);
    addEvent(builder, event);
    latestByRentalId.set(rentalKey, builder);
  }

  return builders
    .filter((builder) => builder.events.length > 0)
    .map(buildProbeRun)
    .sort((a, b) => {
      const delta = Date.parse(a.lastEventAt || "") - Date.parse(b.lastEventAt || "");
      if (Number.isFinite(delta) && delta !== 0) {
        return delta;
      }
      return 0;
    });
}

export function buildRentalProbePayload(rental: ProbeRental, stageLogs: ProbeStageLog[]): RentalProbePayload {
  const events = normalizeStageLogs(stageLogs).map(toProbeEvent);
  const runs = buildProbeRunSummaries(stageLogs);
  const current = runs[runs.length - 1] || null;

  return {
    rentalId: rental.id,
    status: rental.status,
    ip: rental.ip || null,
    vpsId: rental.vpsId || null,
    current,
    summary: {
      totalRuns: runs.length,
      passedRuns: runs.filter((run) => run.status === "passed").length,
      failedRuns: runs.filter((run) => run.status === "failed").length,
      skippedRuns: runs.filter((run) => run.status === "skipped").length,
      runningRuns: runs.filter((run) => run.status === "running").length,
      latestDecision: current?.decision ?? null,
    },
    runs,
    events,
  };
}
