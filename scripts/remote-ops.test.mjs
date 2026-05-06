import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  diagnoseProvisionUrl,
  isLoopbackUrl,
  parseSshConfig,
  validateEmail,
  validateTail,
} = require("./remote-ops.js");

describe("remote-ops helpers", () => {
  it("parses ssh.txt style connection details", () => {
    const config = parseSshConfig(["ip: 145.239.90.226", "port: 22", "password: secret"].join("\n"));

    expect(config).toEqual({
      host: "145.239.90.226",
      port: 22,
      username: "root",
      password: "secret",
      privateKeyPath: "",
    });
  });

  it("supports explicit username and host aliases", () => {
    const config = parseSshConfig([
      "host=example.com",
      "username=deploy",
      "password=secret",
      "identityfile=.ssh/anixops_remote_ed25519",
    ].join("\n"));

    expect(config.host).toBe("example.com");
    expect(config.username).toBe("deploy");
    expect(config.port).toBe(22);
    expect(config.privateKeyPath).toBe(".ssh/anixops_remote_ed25519");
  });

  it("supports the unified SSH_* secret bundle keys", () => {
    const config = parseSshConfig([
      "SSH_HOST=example.org",
      "SSH_PORT=2222",
      "SSH_USER=deploy",
      "SSH_PASSWORD=secret",
      "SSH_PRIVATE_KEY_FILE=.ssh/anixops_remote_ed25519",
    ].join("\n"));

    expect(config).toEqual({
      host: "example.org",
      port: 2222,
      username: "deploy",
      password: "secret",
      privateKeyPath: ".ssh/anixops_remote_ed25519",
    });
  });

  it("normalizes and validates admin email input", () => {
    expect(validateEmail("KalijerryUK@gmail.com")).toBe("kalijerryuk@gmail.com");
    expect(() => validateEmail("not-an-email")).toThrow("valid admin email");
  });

  it("bounds log tail input", () => {
    expect(validateTail("200")).toBe(200);
    expect(validateTail()).toBe(120);
    expect(() => validateTail("0")).toThrow("between 1 and 1000");
    expect(() => validateTail("1001")).toThrow("between 1 and 1000");
  });

  it("detects loopback provision URLs", () => {
    expect(isLoopbackUrl("http://127.0.0.1:3001")).toBe(true);
    expect(isLoopbackUrl("https://localhost:8443")).toBe(true);
    expect(isLoopbackUrl("http://anixops-provision-audit:3001")).toBe(false);
  });

  it("flags loopback provision URLs when the API is not using host networking", () => {
    expect(diagnoseProvisionUrl("", "anixops-audit")).toBe("missing");
    expect(diagnoseProvisionUrl("http://127.0.0.1:3001", "anixops-audit")).toBe("loopback_in_container_network");
    expect(diagnoseProvisionUrl("http://127.0.0.1:3001", "host")).toBe("ok");
    expect(diagnoseProvisionUrl("http://anixops-provision-audit:3001", "anixops-audit")).toBe("ok");
  });
});
