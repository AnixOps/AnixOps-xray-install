import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  auditAnchorSmokeCommand,
  auditAnchorRecoverCommand,
  adminDestroyRentalCommand,
  adminSearchCommand,
  deployCommand,
  diagnoseProvisionUrl,
  healthCommand,
  isLoopbackUrl,
  jobCommand,
  logsCommand,
  rechargeCommand,
  parseSshConfig,
  psCommand,
  restartCommand,
  smokeCommand,
  statusCommand,
  redeemCommand,
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

  it("builds a compose-based remote deploy command", () => {
    const command = deployCommand("/opt/anixops-selfhosted");

    expect(command).toContain("cd '/opt/anixops-selfhosted'");
    expect(command).toContain("docker compose --env-file .env.selfhosted -f docker-compose.selfhosted.yml up -d --build --remove-orphans");
    expect(command).toContain("--- compose ps ---");
  });

  it("builds a ps command that includes exited anixops containers", () => {
    expect(psCommand()).toContain('docker ps -a --filter name=anixops --format "{{.Names}} | {{.Image}} | {{.Status}} | {{.Ports}}"');
  });

  it("builds logs command that includes scheduler logs", () => {
    const command = logsCommand(80);

    expect(command).toContain("--- anixops-audit-api logs ---");
    expect(command).toContain("--- anixops-ui-audit logs ---");
    expect(command).toContain("--- anixops-scheduler-audit logs ---");
    expect(command).toContain("scheduler container missing");
    expect(command).toContain("--- provision container logs ---");
  });

  it("builds a status command that inspects API and provision env separately", () => {
    const command = statusCommand();

    expect(command).toContain('status_CHAIN_ENVIRONMENT');
    expect(command).toContain('status_CHAIN_TESTNET_WHITELIST_EMAILS');
    expect(command).toContain('status_CRYPTO_ALERT_WEBHOOK');
    expect(command).toContain('status_AUDIT_ANCHOR_ALERT_WEBHOOK');
    expect(command).toContain('status_scheduler_container');
    expect(command).toContain('"$provision_container" | awk -F=');
    expect(command).toContain('status_CLOUD_PROVIDER');
    expect(command).toContain('status_AWS_REGION');
  });

  it("builds a health command that checks scheduler health", () => {
    const command = healthCommand(true);

    expect(command).toContain("scheduler_container_present=true");
    expect(command).toContain("scheduler_health=$scheduler_health");
    expect(command).toContain('[ "$scheduler_health" = "healthy" ] || health_failed=1');
  });

  it("builds remote worker commands for the known cron-friendly jobs", () => {
    const command = jobCommand("crypto-topups", "/opt/anixops-selfhosted");

    expect(command).toContain("docker exec -w /app 'anixops-scheduler-audit' node scripts/crypto-topup-worker.js --json");
    expect(command).toContain("node scripts/crypto-topup-worker.js --json");
    expect(() => jobCommand("unknown")).toThrow("Job name must be billing, crypto-topups, audit-anchor, or compliance-stats.");
  });

  it("builds restart commands for scheduler and all managed runtime containers", () => {
    expect(restartCommand("scheduler")).toContain("anixops-scheduler-audit");
    expect(restartCommand("all")).toContain("anixops-scheduler-audit");
    expect(() => restartCommand("unknown")).toThrow("scheduler");
  });

  it("builds a smoke command for console and auth routes", () => {
    const command = smokeCommand();

    expect(command).toContain("console_http");
    expect(command).toContain("private_console_http");
    expect(command).toContain("api_console_unauth");
    expect(command).toContain("billing_tick_http");
    expect(command).toContain("crypto_topup_scan_http");
    expect(command).toContain("compliance_sync_http");
    expect(command).toContain("smoke_auth_register=ok");
    expect(command).toContain("auth_console_${path}=$code");
    expect(command).toContain("crypto_topup_http=$crypto_code");
    expect(command).toContain('chain_environment=${chain_env:-unknown}');
  });

  it("builds a recharge command that runs the dedicated smoke verifier", () => {
    const command = rechargeCommand("/opt/anixops-selfhosted");

    expect(command).toContain("docker exec -w /app 'anixops-scheduler-audit' node scripts/recharge-smoke.js --json");
    expect(command).toContain("node scripts/recharge-smoke.js --json");
  });

  it("builds a redeem smoke command that runs the dedicated verifier", () => {
    const command = redeemCommand("/opt/anixops-selfhosted");

    expect(command).toContain("docker exec -w /app 'anixops-scheduler-audit' node scripts/redeem-smoke.js --json");
    expect(command).toContain("node scripts/redeem-smoke.js --json");
  });

  it("builds an audit anchor smoke command that runs the dedicated verifier", () => {
    const command = auditAnchorSmokeCommand("/opt/anixops-selfhosted");

    expect(command).toContain("docker exec -w /app 'anixops-scheduler-audit' node scripts/audit-anchor-smoke.js --confirmation-mode synthetic --json");
    expect(command).toContain("node scripts/audit-anchor-smoke.js --confirmation-mode synthetic --json");
  });

  it("builds an audit anchor recovery command that reuses an existing tx hash", () => {
    const command = auditAnchorRecoverCommand("f03cda6f5156219b2ebc090835eb944406295039d6928ba0b870e0450bd879ea");

    expect(command).toContain("docker exec -w /app 'anixops-scheduler-audit' node scripts/audit-anchor-worker.js --tx-hash '0xf03cda6f5156219b2ebc090835eb944406295039d6928ba0b870e0450bd879ea' --json");
    expect(() => auditAnchorRecoverCommand("not-a-hash")).toThrow("transaction hash");
  });

  it("builds admin search and destroy commands that use the API secret", () => {
    const searchCommand = adminSearchCommand("kalijerryuk@gmail.com");
    const destroyCommand = adminDestroyRentalCommand("rental-123");

    expect(searchCommand).toContain("/api/admin/search?q=kalijerryuk%40gmail.com");
    expect(searchCommand).toContain("API_SECRET");
    expect(destroyCommand).toContain("/api/admin/rentals/rental-123/destroy");
    expect(destroyCommand).toContain("API_SECRET");
  });
});
