import { describe, expect, it } from "vitest";
import { buildProbeRunSummaries, buildRentalProbePayload, type ProbeStageLog } from "../src/probe-observability.js";

describe("probe observability payloads", () => {
  it("groups probe start and result events into one run", () => {
    const runs = buildProbeRunSummaries([
      {
        id: 2,
        rentalId: "rental-1",
        stage: "stage2.5-2-probe-result",
        status: "ok",
        message: "Delivery connectivity probe passed",
        createdAt: "2026-05-06T11:01:00.000Z",
        meta: {
          probeRunId: "probe-1",
          mode: "external",
          ip: "203.0.113.5",
          port: 443,
          protocol: "vless-reality",
          completedNodes: 3,
          requiredNodes: 3,
          passRatio: 1,
        },
      },
      {
        id: 1,
        rentalId: "rental-1",
        stage: "stage2.5-1-probe-start",
        status: "started",
        message: "Running delivery connectivity probe",
        createdAt: "2026-05-06T11:00:00.000Z",
        meta: {
          mode: "external",
          serviceToken: "secret-value",
          ip: "203.0.113.5",
          port: 443,
          protocol: "vless-reality",
        },
      },
    ]);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      rentalId: "rental-1",
      probeRunId: "probe-1",
      status: "passed",
      decision: "pass",
      mode: "external",
      ip: "203.0.113.5",
      port: 443,
      completedNodes: 3,
      requiredNodes: 3,
      passRatio: 1,
      startedAt: "2026-05-06T11:00:00.000Z",
      completedAt: "2026-05-06T11:01:00.000Z",
    });
    expect(runs[0].events.map((event) => event.stage)).toEqual([
      "stage2.5-1-probe-start",
      "stage2.5-2-probe-result",
    ]);
    expect(runs[0].events[0].meta.serviceToken).toBe("[redacted]");
  });

  it("attaches failed-probe cleanup to the failed run", () => {
    const runs = buildProbeRunSummaries([
      {
        id: 1,
        rentalId: "rental-2",
        stage: "stage2.5-1-probe-start",
        status: "started",
        message: "Running delivery connectivity probe",
        createdAt: "2026-05-06T11:00:00.000Z",
        meta: { mode: "local", ip: "203.0.113.8", port: 443, protocol: "hysteria2" },
      },
      {
        id: 2,
        rentalId: "rental-2",
        stage: "stage2.5-3-probe-failed",
        status: "failed",
        message: "Delivery connectivity probe failed",
        createdAt: "2026-05-06T11:01:00.000Z",
        meta: { mode: "local", ip: "203.0.113.8", port: 443, detail: "timeout" },
      },
      {
        id: 3,
        rentalId: "rental-2",
        stage: "stage2.5-4-probe-failed-destroy",
        status: "ok",
        message: "Delete VPS after failed delivery connectivity probe",
        createdAt: "2026-05-06T11:02:00.000Z",
        meta: { ip: "203.0.113.8", vpsId: "vps-2" },
      },
    ]);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: "failed",
      decision: "fail",
      detail: "timeout",
      cleanup: {
        stage: "stage2.5-4-probe-failed-destroy",
        status: "ok",
      },
    });
    expect(runs[0].lastEventAt).toBe("2026-05-06T11:02:00.000Z");
  });

  it("builds a rental-level probe summary from skipped and running events", () => {
    const logs: ProbeStageLog[] = [
      {
        id: 1,
        rentalId: "rental-3",
        stage: "stage2.5-0-probe-skipped",
        status: "info",
        message: "Mainland connectivity probe disabled",
        createdAt: "2026-05-06T11:00:00.000Z",
        meta: { ip: "203.0.113.9", port: 443, protocol: "vless-reality" },
      },
      {
        id: 2,
        rentalId: "rental-3",
        stage: "stage2.5-1-probe-start",
        status: "started",
        message: "Running delivery connectivity probe",
        createdAt: "2026-05-06T11:05:00.000Z",
        meta: { mode: "external", ip: "203.0.113.10", port: 443, protocol: "vless-reality" },
      },
    ];

    const payload = buildRentalProbePayload({
      id: "rental-3",
      status: "probing",
      ip: "203.0.113.10",
      vpsId: "vps-3",
    }, logs);

    expect(payload.summary).toEqual({
      totalRuns: 2,
      passedRuns: 0,
      failedRuns: 0,
      skippedRuns: 1,
      runningRuns: 1,
      latestDecision: null,
    });
    expect(payload.current?.status).toBe("running");
    expect(payload.events).toHaveLength(2);
  });
});
