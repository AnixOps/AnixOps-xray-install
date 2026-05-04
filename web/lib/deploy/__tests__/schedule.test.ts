import { describe, expect, it } from "vitest";
import {
  DEFAULT_SELF_HOSTED_CLEANUP_HOURS,
  resolveSelfHostedCleanupAt,
} from "../schedule";

describe("resolveSelfHostedCleanupAt", () => {
  it("defaults to 24 hours when nothing is provided", () => {
    const now = Date.UTC(2026, 4, 4, 12, 0, 0);
    const cleanupAt = resolveSelfHostedCleanupAt({ now });

    expect(cleanupAt).toBe(new Date(now + DEFAULT_SELF_HOSTED_CLEANUP_HOURS * 3_600_000).toISOString());
  });

  it("builds cleanup time from duration hours", () => {
    const now = Date.UTC(2026, 4, 4, 12, 0, 0);
    const cleanupAt = resolveSelfHostedCleanupAt({ cleanupHours: 6, now });

    expect(cleanupAt).toBe(new Date(now + 6 * 3_600_000).toISOString());
  });

  it("normalizes an explicit cleanup time", () => {
    const cleanupAt = resolveSelfHostedCleanupAt({
      cleanupAt: "2026-05-05T12:30:00+08:00",
      now: Date.UTC(2026, 4, 4, 0, 0, 0),
    });

    expect(cleanupAt).toBe("2026-05-05T04:30:00.000Z");
  });

  it("rejects cleanup times that are too soon", () => {
    const now = Date.UTC(2026, 4, 4, 12, 0, 0);

    expect(() =>
      resolveSelfHostedCleanupAt({
        cleanupAt: new Date(now + 2 * 60_000).toISOString(),
        now,
      }),
    ).toThrow(/at least 5 minutes/i);
  });

  it("rejects non-positive durations", () => {
    expect(() => resolveSelfHostedCleanupAt({ cleanupHours: 0 })).toThrow(/greater than 0/i);
  });
});
