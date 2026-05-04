import { describe, it, expect, beforeEach } from "vitest";
import { deployments, cleanupDeployments } from "../self-hosted-state";

describe("self-hosted state", () => {
  beforeEach(() => {
    deployments.clear();
  });

  it("starts empty", () => {
    expect(deployments.size).toBe(0);
  });

  it("stores deployment state", () => {
    deployments.set("test-id", {
      status: "running",
      progress: 50,
      createdAt: Date.now(),
    });

    expect(deployments.has("test-id")).toBe(true);
    expect(deployments.get("test-id")!.status).toBe("running");
    expect(deployments.get("test-id")!.progress).toBe(50);
  });

  it("tracks config and error fields", () => {
    deployments.set("test-id", {
      status: "success",
      progress: 100,
      config: { protocol: "vless-reality", ip: "1.2.3.4" },
      createdAt: Date.now(),
    });

    expect(deployments.get("test-id")!.config).toEqual({
      protocol: "vless-reality",
      ip: "1.2.3.4",
    });
  });

  it("cleanupDeployments removes entries older than 1 hour", () => {
    const oldTimestamp = Date.now() - 7200000; // 2 hours ago
    const freshTimestamp = Date.now() - 30000; // 30 seconds ago

    deployments.set("old-id", { status: "running", progress: 50, createdAt: oldTimestamp });
    deployments.set("fresh-id", { status: "running", progress: 50, createdAt: freshTimestamp });

    cleanupDeployments();

    expect(deployments.has("old-id")).toBe(false);
    expect(deployments.has("fresh-id")).toBe(true);
  });

  it("cleanupDeployments handles empty map", () => {
    expect(() => cleanupDeployments()).not.toThrow();
    expect(deployments.size).toBe(0);
  });

  it("supports multiple concurrent deployments", () => {
    deployments.set("deploy-1", { status: "running", progress: 10, createdAt: Date.now() });
    deployments.set("deploy-2", { status: "running", progress: 30, createdAt: Date.now() });
    deployments.set("deploy-3", { status: "success", progress: 100, createdAt: Date.now() });

    expect(deployments.size).toBe(3);

    const runningCount = Array.from(deployments.values()).filter(
      (d) => d.status === "running"
    ).length;
    expect(runningCount).toBe(2);
  });
});
