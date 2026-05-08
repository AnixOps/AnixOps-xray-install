import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  parseArgs,
  parseEnvList,
  sanitizeContainer,
  sanitizeEnv,
  sanitizeInspectPayload,
} = require("./remote-baseline.js");

describe("remote baseline helpers", () => {
  it("parses CLI arguments", () => {
    expect(parseArgs(["--out", "docs/remote-baseline.json"])).toEqual({
      out: "docs/remote-baseline.json",
    });
  });

  it("parses docker env lists", () => {
    expect(parseEnvList(["PORT=8787", "PROVISION_SERVER_URL=http://provision:3001"])).toEqual({
      PORT: "8787",
      PROVISION_SERVER_URL: "http://provision:3001",
    });
  });

  it("redacts sensitive env values and keeps safe previews", () => {
    const env = sanitizeEnv({
      PORT: "8787",
      ADMIN_EMAILS: "ops@example.com",
      PROVISION_SERVER_URL: "http://provision:3001",
      CLOUD_PROVIDER: "vultr",
      VPS_REGION: "nrt",
      VPS_PLAN: "vhf-1c-1gb",
      CHAIN_ENVIRONMENT: "testnet",
      API_SECRET: "secret",
      VULTR_API_KEY: "token",
    });

    expect(env.preview).toEqual({
      PORT: "8787",
      ADMIN_EMAILS: "ops@example.com",
      PROVISION_SERVER_URL: "http://provision:3001",
      CLOUD_PROVIDER: "vultr",
      VPS_REGION: "nrt",
      VPS_PLAN: "vhf-1c-1gb",
      CHAIN_ENVIRONMENT: "testnet",
    });
    expect(env.secretKeys).toEqual(["API_SECRET", "VULTR_API_KEY"]);
  });

  it("sanitizes docker inspect payloads", () => {
    const payload = sanitizeInspectPayload([
      {
        Name: "/anixops-audit-api",
        Created: "2026-05-05T09:00:00Z",
        RestartCount: 2,
        Config: {
          Image: "node:22-slim",
          User: "node",
          WorkingDir: "/app",
          Cmd: ["node", "dist/index.js"],
          Entrypoint: [],
          ExposedPorts: { "8787/tcp": {} },
          Env: [
            "PORT=8787",
            "PROVISION_SERVER_URL=http://127.0.0.1:3001",
            "API_SECRET=secret",
          ],
        },
        State: {
          Status: "running",
          Running: true,
          StartedAt: "2026-05-05T09:00:05Z",
        },
        HostConfig: {
          NetworkMode: "anixops-audit",
          RestartPolicy: { Name: "unless-stopped" },
          PortBindings: { "8787/tcp": [{ HostPort: "8787" }] },
        },
        NetworkSettings: {
          Networks: {
            "anixops-audit": {},
          },
        },
        Mounts: [
          {
            Type: "bind",
            Source: "/opt/anixops-api-audit",
            Destination: "/app",
            Mode: "",
            RW: true,
          },
        ],
      },
    ]);

    expect(payload[0]).toMatchObject({
      name: "anixops-audit-api",
      image: "node:22-slim",
      state: {
        status: "running",
        running: true,
      },
      hostConfig: {
        networkMode: "anixops-audit",
      },
      env: {
        preview: {
          PORT: "8787",
          PROVISION_SERVER_URL: "http://127.0.0.1:3001",
        },
        secretKeys: ["API_SECRET"],
      },
    });
  });

  it("sanitizes a single container helper the same way", () => {
    const container = sanitizeContainer({
      Name: "/anixops-ui-audit",
      Config: {
        Image: "node:22-slim",
        Env: ["PORT=30000", "HOSTNAME=0.0.0.0"],
      },
      State: {
        Status: "running",
        Running: true,
      },
      HostConfig: {
        NetworkMode: "anixops-audit",
        RestartPolicy: { Name: "unless-stopped" },
      },
      NetworkSettings: { Networks: { "anixops-audit": {} } },
      Mounts: [],
    });

    expect(container.name).toBe("anixops-ui-audit");
    expect(container.env.preview).toEqual({
      PORT: "30000",
      HOSTNAME: "0.0.0.0",
    });
  });
});
