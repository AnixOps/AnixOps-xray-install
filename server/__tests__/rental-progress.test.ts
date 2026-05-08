import { describe, expect, it } from "vitest";
import { buildRentalProgressPayload, type RentalProgressStageLog } from "../src/rental-progress.js";

describe("rental progress payloads", () => {
  it("builds a default provisioning progress response without stage logs", () => {
    const payload = buildRentalProgressPayload({
      id: "rental-1",
      status: "provisioning",
      protocol: "vless-reality",
      expiresAt: "2026-05-06T12:00:00.000Z",
      createdAt: "2026-05-06T10:00:00.000Z",
    }, [], Date.parse("2026-05-06T11:00:00.000Z"));

    expect(payload).toMatchObject({
      rentalId: "rental-1",
      status: "provisioning",
      stage: "stage1-0-provider-pending",
      message: "Allocating cloud resource",
      percent: 25,
      probe: null,
      billing: {
        remainingMinutes: 60,
        expiresAt: "2026-05-06T12:00:00.000Z",
      },
    });
  });

  it("uses the latest stage log and returns logs in chronological order", () => {
    const logs: RentalProgressStageLog[] = [
      {
        id: 2,
        stage: "stage3-1-deploy-start",
        status: "started",
        message: "Starting protocol deployment",
        createdAt: "2026-05-06T11:02:00.000Z",
      },
      {
        id: 1,
        stage: "stage1-3-vps-create",
        status: "ok",
        message: "Create VPS through cloud provider API",
        createdAt: "2026-05-06T11:01:00.000Z",
      },
    ];

    const payload = buildRentalProgressPayload({
      id: "rental-2",
      status: "provisioning",
      protocol: "vless-reality",
    }, logs);

    expect(payload.stage).toBe("stage3-1-deploy-start");
    expect(payload.message).toBe("Starting protocol deployment");
    expect(payload.percent).toBe(75);
    expect(payload.stageLogs.map((log) => log.stage)).toEqual([
      "stage1-3-vps-create",
      "stage3-1-deploy-start",
    ]);
  });

  it("summarizes mainland probe stage metadata", () => {
    const payload = buildRentalProgressPayload({
      id: "rental-3",
      status: "probing",
      ip: "203.0.113.5",
      vpsId: "vps-123",
    }, [
      {
        id: 1,
        stage: "stage2.5-2-mainland-tcp-probe",
        status: "info",
        message: "Testing TCP 443 from mainland probes",
        createdAt: "2026-05-06T11:00:00.000Z",
        meta: {
          probeRunId: "probe-1",
          completedNodes: 2,
          requiredNodes: 3,
          passRatio: 0.66,
          attempt: 2,
          maxAttempts: 5,
          ip: "203.0.113.5",
          vpsId: "vps-123",
        },
      },
    ]);

    expect(payload.percent).toBe(55);
    expect(payload.attempt).toEqual({
      attemptNo: 2,
      maxAttempts: 5,
      ip: "203.0.113.5",
      vpsId: "vps-123",
    });
    expect(payload.probe).toEqual({
      status: "info",
      probeRunId: "probe-1",
      completedNodes: 2,
      requiredNodes: 3,
      passRatio: 0.66,
    });
  });

  it("marks active rentals as complete regardless of earlier stage", () => {
    const payload = buildRentalProgressPayload({
      id: "rental-4",
      status: "active",
      expiresAt: new Date("2026-05-06T11:30:00.000Z"),
      updatedAt: new Date("2026-05-06T11:00:00.000Z"),
    }, [
      {
        id: 1,
        stage: "stage4-3-db-active",
        status: "ok",
        message: "API marked rental active",
        createdAt: "2026-05-06T11:00:00.000Z",
      },
    ], Date.parse("2026-05-06T11:15:00.000Z"));

    expect(payload.status).toBe("active");
    expect(payload.percent).toBe(100);
    expect(payload.billing.remainingMinutes).toBe(15);
    expect(payload.updatedAt).toBe("2026-05-06T11:00:00.000Z");
  });

  it("keeps attempt metadata when later stage logs do not repeat it", () => {
    const payload = buildRentalProgressPayload({
      id: "rental-5",
      status: "provisioning",
      ip: "203.0.113.12",
    }, [
      {
        id: 1,
        stage: "stage4-0-api-job-start",
        status: "started",
        message: "API worker started provision job",
        createdAt: "2026-05-06T11:00:00.000Z",
        meta: {
          attempt: 3,
          maxAttempts: 10,
          attemptId: "rental-5:attempt:3",
        },
      },
      {
        id: 2,
        stage: "stage3-1-deploy-start",
        status: "started",
        message: "Starting protocol deployment",
        createdAt: "2026-05-06T11:05:00.000Z",
        meta: {
          ip: "203.0.113.12",
        },
      },
    ]);

    expect(payload.stage).toBe("stage3-1-deploy-start");
    expect(payload.attempt).toEqual({
      attemptNo: 3,
      maxAttempts: 10,
      ip: "203.0.113.12",
      vpsId: null,
    });
  });
});
