import { logger } from "./logger.js";

export type StageStatus = "started" | "ok" | "failed" | "info" | "warn";
export type StageMeta = Record<string, string | number | boolean | null>;

export interface ProvisionStageLog {
  stage: string;
  status: StageStatus;
  message: string;
  timestamp: string;
  meta?: StageMeta;
}

export class ProvisionStageError extends Error {
  stage: string;
  logs: ProvisionStageLog[];

  constructor(stage: string, message: string, logs: ProvisionStageLog[], cause?: unknown) {
    super(`${stage}: ${message}${cause ? `: ${getErrorMessage(cause)}` : ""}`);
    this.name = "ProvisionStageError";
    this.stage = stage;
    this.logs = logs;
  }
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

function scrubMeta(meta: StageMeta | undefined): StageMeta | undefined {
  if (!meta) {
    return undefined;
  }

  const next: StageMeta = {};
  for (const [key, value] of Object.entries(meta)) {
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
      next[key] = "[redacted]";
    } else {
      next[key] = value;
    }
  }
  return next;
}

export class StageRecorder {
  readonly logs: ProvisionStageLog[] = [];

  constructor(
    private readonly rentalId: string,
    private readonly operation: "provision" | "destroy",
  ) {}

  record(stage: string, status: StageStatus, message: string, meta?: StageMeta) {
    const entry: ProvisionStageLog = {
      stage,
      status,
      message,
      timestamp: new Date().toISOString(),
      ...(meta ? { meta: scrubMeta(meta) } : {}),
    };
    this.logs.push(entry);

    const logMeta = {
      rentalId: this.rentalId,
      operation: this.operation,
      stage,
      status,
      ...(entry.meta || {}),
    };
    if (status === "failed") {
      logger.error(message, logMeta);
    } else if (status === "warn") {
      logger.warn(message, logMeta);
    } else {
      logger.info(message, logMeta);
    }

    return entry;
  }

  fail(stage: string, message: string, error: unknown, meta?: StageMeta): never {
    const detail = getErrorMessage(error);
    this.record(stage, "failed", message, { ...(meta || {}), detail: detail.slice(0, 240) });
    throw new ProvisionStageError(stage, message, this.logs, error);
  }
}

export async function runStage<T>(
  recorder: StageRecorder,
  stage: string,
  message: string,
  task: () => Promise<T>,
  meta?: StageMeta,
) {
  recorder.record(stage, "started", message, meta);
  try {
    const result = await task();
    recorder.record(stage, "ok", message, meta);
    return result;
  } catch (error) {
    recorder.fail(stage, message, error, meta);
  }
}
