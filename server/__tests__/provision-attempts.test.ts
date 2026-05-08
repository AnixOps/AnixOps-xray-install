import { describe, expect, it } from "vitest";
import {
  buildProvisionAttemptId,
  calculateProvisionAttemptCloudCost,
  didProvisionAttemptCreateCloudServer,
  getProvisionAttemptNo,
  getProvisionMaxAttempts,
  summarizeProvisionAttemptStageLogs,
} from "../src/lib/provision-attempts.js";

describe("provision attempt helpers", () => {
  it("derives stable attempt identity from BullMQ retry metadata", () => {
    expect(getProvisionAttemptNo({ attemptsMade: 0, opts: { attempts: 5 } })).toBe(1);
    expect(getProvisionAttemptNo({ attemptsMade: 2, opts: { attempts: 5 } })).toBe(3);
    expect(getProvisionMaxAttempts({ attemptsMade: 2, opts: { attempts: 5 } })).toBe(5);
    expect(getProvisionMaxAttempts({ attemptsMade: 2, opts: {} })).toBe(1);
    expect(buildProvisionAttemptId("rental-1", 3)).toBe("rental-1:attempt:3");
  });

  it("summarizes failed probe attempts and destroy confirmation from stage logs", () => {
    const summary = summarizeProvisionAttemptStageLogs([
      {
        stage: "stage1-5-vps-created",
        status: "ok",
        message: "VPS created with public IP",
        meta: { vpsId: "vps-1", ip: "203.0.113.10" },
      },
      {
        stage: "stage2.5-3-probe-failed",
        status: "failed",
        message: "Delivery connectivity probe failed",
        meta: {
          probeRunId: "probe-1",
          ip: "203.0.113.10",
          detail: "tcp timeout from mainland probes",
        },
      },
      {
        stage: "stage2.5-4-probe-failed-destroy",
        status: "ok",
        message: "Delete VPS after failed delivery connectivity probe",
        meta: { vpsId: "vps-1", ip: "203.0.113.10" },
      },
    ]);

    expect(summary).toEqual({
      vpsId: "vps-1",
      ip: "203.0.113.10",
      probeRunId: "probe-1",
      cleanupConfirmed: true,
      cloudServerCreated: false,
      failureReason: "tcp timeout from mainland probes",
    });
  });

  it("records Vultr startup cost only after cloud server creation succeeds", () => {
    const createdLogs = [
      {
        stage: "stage1-3-vps-create",
        status: "ok",
        message: "Create VPS through cloud provider API",
      },
    ];
    const reusedLogs = [
      {
        stage: "stage1-3-vps-create",
        status: "ok",
        message: "Reusing existing VPS by rental label",
      },
    ];

    expect(didProvisionAttemptCreateCloudServer(createdLogs)).toBe(true);
    expect(calculateProvisionAttemptCloudCost("vultr", createdLogs)).toBe(0.01);
    expect(calculateProvisionAttemptCloudCost("vultr", reusedLogs)).toBe(0);
    expect(calculateProvisionAttemptCloudCost("digitalocean", createdLogs)).toBe(0);
  });
});
