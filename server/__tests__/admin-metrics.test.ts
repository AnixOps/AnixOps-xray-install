import { describe, expect, it } from "vitest";
import { buildBillingMetrics, buildProbeMetrics, buildProvisioningMetrics } from "../src/admin-metrics.js";
import type { ProbeRunSummary } from "../src/probe-observability.js";

describe("admin metrics helpers", () => {
  it("summarizes provisioning status, attempts, and queue counts", () => {
    const metrics = buildProvisioningMetrics({
      rentalStatusRows: [
        { key: "active", count: 4 },
        { key: "provisioning", count: "2" },
        { key: "failed", count: 1 },
      ],
      attemptStatusRows: [
        { key: "succeeded", count: 6, amount: 0.06 },
        { key: "failed_destroyed", count: 2, amount: 0.02 },
        { key: "running", count: 1 },
      ],
      queueCounts: { waiting: 3, active: "1" },
      generatedAt: "2026-05-06T12:00:00.000Z",
    });

    expect(metrics.rentals.activeLike).toBe(6);
    expect(metrics.attempts.terminal).toBe(8);
    expect(metrics.attempts.successRate).toBe(0.75);
    expect(metrics.attempts.cloudCost.total).toBe(0.08);
    expect(metrics.queue).toEqual({ waiting: 3, active: 1 });
  });

  it("summarizes wallet billing, topups, ticks, and wallet rentals", () => {
    const metrics = buildBillingMetrics({
      ledgerRows: [
        { key: "topup", count: 2, amount: 20 },
        { key: "billing_tick", count: 3, amount: -2.75 },
      ],
      tickRows: [
        { key: "charged", count: 3, amount: 2.75 },
      ],
      topupRows: [
        { key: "completed", count: 2, amount: 20 },
        { key: "pending", count: 1, amount: 5 },
      ],
      walletRentalRows: [
        { key: "active", count: 2 },
        { key: "destroying", count: 1 },
      ],
      generatedAt: "2026-05-06T12:00:00.000Z",
    });

    expect(metrics.wallet.grossCredits).toBe(20);
    expect(metrics.wallet.grossDebits).toBe(2.75);
    expect(metrics.wallet.net).toBe(17.25);
    expect(metrics.billingTicks.chargedCount).toBe(3);
    expect(metrics.topups.pendingAmount).toBe(5);
    expect(metrics.walletRentals.activeLike).toBe(3);
  });

  it("summarizes probe run pass rates and averages", () => {
    const baseRun = {
      rentalId: null,
      probeRunId: null,
      decision: null,
      mode: null,
      protocol: null,
      ip: null,
      port: null,
      completedNodes: null,
      requiredNodes: null,
      detail: null,
      stage: "stage2.5-test",
      message: "test",
      startedAt: null,
      completedAt: null,
      lastEventAt: null,
      cleanup: null,
      events: [],
    } satisfies Omit<ProbeRunSummary, "status" | "passRatio" | "latencyMs">;

    const metrics = buildProbeMetrics({
      scannedEvents: 8,
      runs: [
        { ...baseRun, status: "passed", decision: "pass", passRatio: 0.8, latencyMs: 120 },
        { ...baseRun, status: "failed", decision: "fail", passRatio: 0.4, latencyMs: 260 },
        { ...baseRun, status: "running", decision: null, passRatio: null, latencyMs: null },
      ],
      generatedAt: "2026-05-06T12:00:00.000Z",
    });

    expect(metrics.scannedEvents).toBe(8);
    expect(metrics.runs.byStatus).toEqual({ passed: 1, failed: 1, running: 1 });
    expect(metrics.runs.passRate).toBe(0.5);
    expect(metrics.runs.averagePassRatio).toBe(0.6);
    expect(metrics.runs.averageLatencyMs).toBe(190);
  });
});
