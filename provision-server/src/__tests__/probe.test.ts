import { createServer } from "net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getConnectivityProbeConfig, localTcpProbe, runConnectivityProbe } from "../probe.js";

describe("delivery connectivity probes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is disabled by default", () => {
    expect(getConnectivityProbeConfig({} as NodeJS.ProcessEnv)).toMatchObject({
      enabled: false,
      mode: "disabled",
      timeoutMs: 5000,
      minNodes: 3,
      passRatio: 0.7,
    });
  });

  it("uses external mode when a probe service URL is configured", () => {
    expect(getConnectivityProbeConfig({
      PROBE_SERVICE_URL: "http://probe.internal",
      PROBE_SERVICE_TOKEN: "probe-token",
      PROBE_MIN_NODES: "5",
      PROBE_PASS_RATIO: "0.8",
    } as NodeJS.ProcessEnv)).toMatchObject({
      enabled: true,
      mode: "external",
      serviceUrl: "http://probe.internal",
      serviceToken: "probe-token",
      minNodes: 5,
      passRatio: 0.8,
    });
  });

  it("skips probe execution when disabled", async () => {
    await expect(runConnectivityProbe({
      rentalId: "rental-1",
      ip: "203.0.113.5",
      port: 443,
      protocol: "vless-reality",
    }, {
      enabled: false,
      mode: "disabled",
      timeoutMs: 100,
      pollIntervalMs: 1,
      maxPolls: 1,
      minNodes: 3,
      passRatio: 0.7,
    })).resolves.toEqual({
      decision: "skipped",
      mode: "disabled",
      detail: "Connectivity probe is disabled",
    });
  });

  it("runs a local TCP probe", async () => {
    const server = createServer((socket) => socket.end());
    const listenError = await new Promise<Error | null>((resolve) => {
      server.once("error", resolve);
      server.listen(0, "127.0.0.1", () => resolve(null));
    });
    if (listenError) {
      if ((listenError as NodeJS.ErrnoException).code === "EPERM") {
        return;
      }
      throw listenError;
    }
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind local test server");
    }

    try {
      const result = await localTcpProbe("127.0.0.1", address.port, 1000);
      expect(result.ok).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("creates and polls an external probe run", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ probeRunId: "probe-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "completed",
        decision: "pass",
        completedNodes: 3,
        requiredNodes: 3,
        passRatio: 1,
      }), { status: 200 }));

    await expect(runConnectivityProbe({
      rentalId: "rental-1",
      attemptId: "attempt-1",
      attemptNo: 2,
      maxAttempts: 5,
      ip: "203.0.113.5",
      port: 443,
      protocol: "vless-reality",
    }, {
      enabled: true,
      mode: "external",
      serviceUrl: "http://probe.internal",
      serviceToken: "probe-token",
      timeoutMs: 1000,
      pollIntervalMs: 1,
      maxPolls: 2,
      minNodes: 3,
      passRatio: 0.7,
    }, fetchImpl)).resolves.toEqual({
      decision: "pass",
      mode: "external",
      probeRunId: "probe-1",
      completedNodes: 3,
      requiredNodes: 3,
      passRatio: 1,
      detail: undefined,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "http://probe.internal/internal/probes/runs",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toMatchObject({
      rentalId: "rental-1",
      attemptId: "attempt-1",
      attemptNo: 2,
      maxAttempts: 5,
      ip: "203.0.113.5",
      port: 443,
      protocol: "vless-reality",
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "http://probe.internal/internal/probes/runs/probe-1",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer probe-token" }) }),
    );
  });

  it("fails closed when the external probe service reports a blocked IP", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ probeRunId: "probe-2" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "completed",
        decision: "fail",
        completedNodes: 3,
        requiredNodes: 3,
        passRatio: 0,
        detail: "tcp timeout from mainland probes",
      }), { status: 200 }));

    await expect(runConnectivityProbe({
      rentalId: "rental-2",
      ip: "198.51.100.10",
      port: 443,
      protocol: "hysteria2",
    }, {
      enabled: true,
      mode: "external",
      serviceUrl: "http://probe.internal",
      timeoutMs: 1000,
      pollIntervalMs: 1,
      maxPolls: 2,
      minNodes: 3,
      passRatio: 0.7,
    }, fetchImpl)).resolves.toMatchObject({
      decision: "fail",
      mode: "external",
      reason: "timeout",
      probeRunId: "probe-2",
      completedNodes: 3,
      requiredNodes: 3,
      passRatio: 0,
      detail: "tcp timeout from mainland probes",
    });
  });
});
