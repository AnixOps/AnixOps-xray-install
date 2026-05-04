export const DEFAULT_SELF_HOSTED_CLEANUP_HOURS = 24;
export const MIN_SELF_HOSTED_CLEANUP_MINUTES = 5;
export const MAX_SELF_HOSTED_CLEANUP_HOURS = 24 * 365;

interface ResolveSelfHostedCleanupAtOptions {
  cleanupAt?: string | null;
  cleanupHours?: number | string | null;
  now?: number;
}

export function resolveSelfHostedCleanupAt({
  cleanupAt,
  cleanupHours,
  now = Date.now(),
}: ResolveSelfHostedCleanupAtOptions): string {
  if (cleanupAt) {
    const parsed = Date.parse(cleanupAt);
    if (Number.isNaN(parsed)) {
      throw new Error("Cleanup time is invalid");
    }

    if (parsed < now + MIN_SELF_HOSTED_CLEANUP_MINUTES * 60_000) {
      throw new Error(`Cleanup time must be at least ${MIN_SELF_HOSTED_CLEANUP_MINUTES} minutes from now`);
    }

    return new Date(parsed).toISOString();
  }

  if (cleanupHours === undefined || cleanupHours === null || cleanupHours === "") {
    return new Date(now + DEFAULT_SELF_HOSTED_CLEANUP_HOURS * 3_600_000).toISOString();
  }

  const hours = typeof cleanupHours === "string" ? Number(cleanupHours) : cleanupHours;

  if (!Number.isFinite(hours)) {
    throw new Error("Cleanup duration must be a number");
  }

  if (hours <= 0) {
    throw new Error("Cleanup duration must be greater than 0");
  }

  if (hours > MAX_SELF_HOSTED_CLEANUP_HOURS) {
    throw new Error(`Cleanup duration cannot exceed ${MAX_SELF_HOSTED_CLEANUP_HOURS} hours`);
  }

  if (hours * 60 < MIN_SELF_HOSTED_CLEANUP_MINUTES) {
    throw new Error(`Cleanup duration must be at least ${MIN_SELF_HOSTED_CLEANUP_MINUTES} minutes`);
  }

  return new Date(now + hours * 3_600_000).toISOString();
}
