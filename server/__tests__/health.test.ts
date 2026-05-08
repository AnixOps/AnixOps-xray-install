import { describe, expect, it } from "vitest";
import { checkProvisionServerHealth, runHealthChecks } from "../src/health.js";

describe("server health checks", () => {
  it("reports healthy dependencies", async () => {
    await expect(runHealthChecks([
      { name: "database", check: async () => true },
      { name: "redis", check: async () => "PONG" },
    ])).resolves.toEqual([
      { name: "database", ok: true },
      { name: "redis", ok: true },
    ]);
  });

  it("captures dependency failure messages", async () => {
    await expect(runHealthChecks([
      { name: "database", check: async () => { throw new Error("connection refused"); } },
    ])).resolves.toEqual([
      { name: "database", ok: false, error: "connection refused" },
    ]);
  });

  it("accepts a healthy JSON provision server response", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    await expect(checkProvisionServerHealth("http://provision:3001", fetchImpl)).resolves.toEqual({ status: "ok" });
  });

  it("rejects a non-JSON provision health response", async () => {
    const fetchImpl = async () => new Response("<html></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });

    await expect(checkProvisionServerHealth("http://wrong-service:3001", fetchImpl)).rejects.toThrow("non-JSON");
  });

  it("rejects degraded provision health", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ status: "degraded" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    await expect(checkProvisionServerHealth("http://provision:3001", fetchImpl)).rejects.toThrow("degraded");
  });
});
