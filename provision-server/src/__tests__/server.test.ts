import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("provision server health check logic", () => {
  const originalEnv = process.env;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, NODE_ENV: "test" };
  });

  afterEach(() => {
    process.env = originalEnv;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("reports 'ok' when all required env vars are present for vultr", async () => {
    process.env.CLOUD_PROVIDER = "vultr";
    process.env.SERVER_TOKEN = "test-token-at-least-32-chars-long";
    process.env.VULTR_API_KEY = "vultr-key";

    // The server module validates env vars at import time
    // We need to test the health endpoint logic indirectly
    const { server } = await import("../server");
    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeTruthy();
  });

  it("throws at startup when required env vars are missing", async () => {
    process.env.CLOUD_PROVIDER = "vultr";
    process.env.SERVER_TOKEN = "test-token-at-least-32-chars-long";
    // VULTR_API_KEY intentionally missing; server throws at startup.

    await expect(import("../server")).rejects.toThrow(
      "Missing or placeholder environment variable: VULTR_API_KEY"
    );
  });

  it("throws at startup when provider credentials are placeholders", async () => {
    process.env.CLOUD_PROVIDER = "vultr";
    process.env.SERVER_TOKEN = "test-token-at-least-32-chars-long";
    process.env.VULTR_API_KEY = "your-vultr-api-key";

    await expect(import("../server")).rejects.toThrow(
      "Missing or placeholder environment variable: VULTR_API_KEY"
    );
  });

  it("throws at startup for unsupported providers", async () => {
    process.env.CLOUD_PROVIDER = "linode";
    process.env.SERVER_TOKEN = "test-token-at-least-32-chars-long";

    await expect(import("../server")).rejects.toThrow(
      "Unsupported CLOUD_PROVIDER: linode"
    );
  });

  it("accepts legacy DO_API_TOKEN for digitalocean startup validation", async () => {
    process.env.CLOUD_PROVIDER = "digitalocean";
    process.env.SERVER_TOKEN = "test-token-at-least-32-chars-long";
    process.env.DO_API_TOKEN = "do-legacy-token";

    const { server } = await import("../server");
    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
  });

  it("returns 401 without auth token on provision endpoint", async () => {
    process.env.CLOUD_PROVIDER = "vultr";
    process.env.SERVER_TOKEN = "test-token-at-least-32-chars-long";
    process.env.VULTR_API_KEY = "vultr-key";

    const { server } = await import("../server");
    const response = await server.inject({
      method: "POST",
      url: "/api/provision",
      body: { rentalId: "test", protocol: "vless-reality" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns 400 for invalid protocol on provision endpoint", async () => {
    process.env.CLOUD_PROVIDER = "vultr";
    process.env.SERVER_TOKEN = "test-token-at-least-32-chars-long";
    process.env.VULTR_API_KEY = "vultr-key";

    const { server } = await import("../server");
    const response = await server.inject({
      method: "POST",
      url: "/api/provision",
      headers: { Authorization: "Bearer test-token-at-least-32-chars-long" },
      body: { rentalId: "test", protocol: "invalid-protocol" },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.payload);
    expect(body.error).toBe("Invalid protocol");
  });

  it("rejects hysteria2 in formal release mode", async () => {
    process.env.CLOUD_PROVIDER = "vultr";
    process.env.SERVER_TOKEN = "test-token-at-least-32-chars-long";
    process.env.VULTR_API_KEY = "vultr-key";
    process.env.NEXT_PUBLIC_RELEASE_PROFILE = "formal";

    const { server } = await import("../server");
    const response = await server.inject({
      method: "POST",
      url: "/api/provision",
      headers: { Authorization: "Bearer test-token-at-least-32-chars-long" },
      body: { rentalId: "test", protocol: "hysteria2" },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.payload);
    expect(body.error).toBe("Invalid protocol");
  });

  it("returns 400 for missing fields on provision endpoint", async () => {
    process.env.CLOUD_PROVIDER = "vultr";
    process.env.SERVER_TOKEN = "test-token-at-least-32-chars-long";
    process.env.VULTR_API_KEY = "vultr-key";

    const { server } = await import("../server");
    const response = await server.inject({
      method: "POST",
      url: "/api/provision",
      headers: { Authorization: "Bearer test-token-at-least-32-chars-long" },
      body: {},
    });

    expect(response.statusCode).toBe(400);
  });
});
