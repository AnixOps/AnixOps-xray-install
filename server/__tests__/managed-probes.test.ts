import { beforeAll, describe, expect, it } from "vitest";

let buildGlobalpingCreatePayload: typeof import("../src/managed-probes.js").buildGlobalpingCreatePayload;
let getManagedProbeConfig: typeof import("../src/managed-probes.js").getManagedProbeConfig;
let mapGlobalpingMeasurement: typeof import("../src/managed-probes.js").mapGlobalpingMeasurement;

beforeAll(async () => {
  process.env.DATABASE_URL ||= "postgresql://anixops:test@localhost:5432/anixops";
  process.env.REDIS_URL ||= "redis://localhost:6379";
  ({ buildGlobalpingCreatePayload, getManagedProbeConfig, mapGlobalpingMeasurement } = await import("../src/managed-probes.js"));
});

describe("managed probe adapters", () => {
  it("builds a Globalping TCP ping request for mainland probes", () => {
    const config = getManagedProbeConfig({
      PROBE_PROVIDER: "globalping",
      PROBE_GLOBALPING_COUNTRY: "cn",
    } as NodeJS.ProcessEnv);

    expect(buildGlobalpingCreatePayload({
      ip: "203.0.113.5",
      port: 443,
      minNodes: 3,
    }, config)).toEqual({
      target: "203.0.113.5",
      type: "ping",
      inProgressUpdates: true,
      locations: [
        { country: "CN", tags: ["eyeball-network"], limit: 2 },
        { country: "CN", tags: ["datacenter-network"], limit: 1 },
      ],
      measurementOptions: {
        protocol: "TCP",
        port: 443,
      },
    });
  });

  it("maps Globalping terminal probe results into normalized observations", () => {
    const snapshot = mapGlobalpingMeasurement({
      status: "finished",
      results: [
        {
          probe: {
            version: "0.1.0",
            region: "Eastern Asia",
            country: "CN",
            state: "BJ",
            city: "Beijing",
            asn: 4134,
            network: "China Telecom",
            tags: ["cn", "telecom"],
          },
          result: {
            status: "finished",
            stats: { avg: 48.3 },
            rawOutput: "tcp connect ok",
          },
        },
        {
          probe: {
            version: "0.1.0",
            region: "Eastern Asia",
            country: "CN",
            state: "SH",
            city: "Shanghai",
            asn: 4837,
            network: "China Unicom",
            tags: ["cn", "unicom"],
          },
          result: {
            status: "offline",
            rawOutput: "probe offline",
          },
        },
      ],
    });

    expect(snapshot.status).toBe("finished");
    expect(snapshot.observations).toHaveLength(2);
    expect(snapshot.observations[0]).toEqual(expect.objectContaining({
      ok: true,
      latencyMs: 48,
      region: "Eastern Asia",
      province: "BJ",
      city: "Beijing",
      endpoint: "China Telecom",
    }));
    expect(snapshot.observations[1]).toEqual(expect.objectContaining({
      ok: false,
      status: "offline",
      city: "Shanghai",
      endpoint: "China Unicom",
    }));
  });
});
