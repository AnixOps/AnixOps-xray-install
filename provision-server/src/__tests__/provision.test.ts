import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const commands: string[] = [];
  const instances: Array<{ connected: boolean; commands: string[] }> = [];

  const provider = {
    listServersByTag: vi.fn(async () => []),
    createServer: vi.fn(async () => ({
      id: "instance-1",
      ip: "203.0.113.10",
      status: "active",
    })),
    getServer: vi.fn(async () => ({
      id: "instance-1",
      ip: "203.0.113.10",
      status: "active",
    })),
    deleteServer: vi.fn(async () => undefined),
  };

  class MockNodeSSH {
    connected = false;
    commands: string[] = [];

    constructor() {
      instances.push(this);
    }

    async connect() {
      this.connected = true;
    }

    async execCommand(command: string) {
      if (!this.connected) {
        throw new Error("SSH client was not connected");
      }

      this.commands.push(command);
      commands.push(command);

      if (command === "echo ready") {
        return { code: 0, signal: null, stdout: "ready", stderr: "" };
      }

      if (command.startsWith("cat > /tmp/anixops-install.sh")) {
        return { code: 0, signal: null, stdout: "", stderr: "" };
      }

      if (command === "chmod +x /tmp/anixops-install.sh") {
        return { code: 0, signal: null, stdout: "", stderr: "" };
      }

      if (command.startsWith("/tmp/anixops-install.sh")) {
        return {
          code: 0,
          signal: null,
          stdout: "PUBLIC_KEY=ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAItest\n",
          stderr: "",
        };
      }

      if (command.includes("compliance-policy.json")) {
        return { code: 0, signal: null, stdout: "", stderr: "" };
      }

      return { code: 0, signal: null, stdout: "", stderr: "" };
    }

    dispose() {
      this.connected = false;
    }
  }

  return { commands, instances, provider, MockNodeSSH };
});

vi.mock("node-ssh", () => ({
  NodeSSH: mocks.MockNodeSSH,
}));

vi.mock("../providers/vultr.js", () => ({
  createVultrProvider: () => mocks.provider,
}));

describe("provision flow", () => {
  const originalEnv = process.env;
  let sshDir = "";

  beforeEach(() => {
    vi.resetModules();
    mocks.commands.length = 0;
    mocks.instances.length = 0;
    mocks.provider.listServersByTag.mockClear();
    mocks.provider.createServer.mockClear();
    mocks.provider.getServer.mockClear();
    mocks.provider.deleteServer.mockClear();

    process.env = { ...originalEnv, NODE_ENV: "test" };
    sshDir = mkdtempSync(join(tmpdir(), "anixops-ssh-"));
    writeFileSync(join(sshDir, "anixops_rsa"), "PRIVATE_KEY");
    writeFileSync(join(sshDir, "anixops_rsa.pub"), "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCTest anixops");

    process.env.SSH_KEY_DIR = sshDir;
    process.env.CLOUD_PROVIDER = "vultr";
    process.env.VULTR_API_KEY = "vultr-key";
    process.env.INSTALL_MODE = "ssh";
  });

  afterEach(() => {
    process.env = originalEnv;
    if (sshDir) {
      rmSync(sshDir, { recursive: true, force: true });
      sshDir = "";
    }
  });

  it("parses the VLESS config before applying compliance and emits a safe multiline compliance command", async () => {
    const { provisionNode } = await import("../provision.js");

    const result = await provisionNode("rental-1", "vless-reality", {
      compliancePolicy: {
        profileId: "restricted-egress",
        version: "2026-05-07.restricted.v1",
        mode: "restricted",
        allowedPorts: [53, 80, 443],
        allowedCidrs: ["0.0.0.0/0"],
        blockedProtocols: [],
      },
    });

    expect(result.config.protocol).toBe("vless-reality");
    expect(result.config.publicKey).toBe("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAItest");

    const stageNames = result.debug.stageLogs.map((entry) => entry.stage);
    const configParseIndex = stageNames.indexOf("stage3-6-config-parse");
    const complianceIndex = stageNames.indexOf("stage3-6-compliance-policy");
    expect(configParseIndex).toBeGreaterThan(-1);
    expect(complianceIndex).toBeGreaterThan(-1);
    expect(configParseIndex).toBeLessThan(complianceIndex);

    const complianceCommand = mocks.commands.find((command) => command.includes("compliance-policy.json"));
    expect(complianceCommand).toBeTruthy();
    expect(complianceCommand).not.toContain("then;");
    expect(complianceCommand).toContain("cat > /etc/anixops/compliance-policy.json <<'JSON'");
    expect(complianceCommand).toContain("JSON\nif command -v iptables >/dev/null 2>&1; then\n");
  });

  it("uses the selected recovery region and plan when creating a VPS", async () => {
    const { provisionNode } = await import("../provision.js");

    await provisionNode("rental-region-1", "vless-reality", {
      attemptNo: 2,
      maxAttempts: 10,
      provider: "vultr",
      region: "sgp",
      plan: "vhf-2c-2gb",
    });

    expect(mocks.provider.createServer).toHaveBeenCalledWith(expect.objectContaining({
      region: "sgp",
      plan: "vhf-2c-2gb",
      tag: "rental-region-1",
    }));
  });
});
