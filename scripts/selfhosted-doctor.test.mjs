import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildDoctorReport,
  buildLocalReport,
  buildRemoteReport,
  formatLocalSummary,
  formatRemoteSummary,
  getVerdictLabel,
  parseArgs,
  parseKeyValueLines,
  stagingCommand,
} = require("./selfhosted-doctor.js");

const completeEnv = {
  CLOUD_PROVIDER: "vultr",
  PROVISION_SERVER_TOKEN: "strong-provision-token-0123456789",
  API_SECRET: "strong-api-secret-0123456789-abcdef",
  POSTGRES_PASSWORD: "strong-postgres-password",
  REDIS_PASSWORD: "strong-redis-password",
  FRONTEND_URL: "http://localhost:30000",
  ALLOWED_ORIGINS: "http://localhost:30000",
  VPS_REGION: "nrt",
  VPS_PLAN: "vhf-1c-1gb",
  VULTR_API_KEY: "vultr-real-token",
};

describe("self-hosted doctor helpers", () => {
  it("parses command-line arguments", () => {
    expect(parseArgs(["--env-file", ".env.prod", "--remote", "--strict", "--json"])).toEqual({
      envFile: ".env.prod",
      remote: true,
      remoteDir: "/opt/anixops-selfhosted",
      strict: true,
      allowPlaceholders: false,
      json: true,
    });
  });

  it("parses remote-dir argument", () => {
    expect(parseArgs(["--remote", "--remote-dir", "/srv/anixops"])).toMatchObject({
      remote: true,
      remoteDir: "/srv/anixops",
    });
  });

  it("parses key=value lines from command output", () => {
    expect(parseKeyValueLines("api_health_http=200\nprovision_health=ok\n")).toEqual({
      api_health_http: "200",
      provision_health: "ok",
    });
  });

  it("builds a staging command for the remote repository directory", () => {
    const command = stagingCommand("/srv/anixops");

    expect(command).toContain("staging_dir='/srv/anixops'");
    expect(command).toContain("staging_env_uploaded=false");
  });

  it("builds a ready local report for a complete env", () => {
    const report = buildLocalReport(completeEnv);

    expect(report.ok).toBe(true);
    expect(report.shapeOnly).toBe(false);
    expect(report.provider).toBe("vultr");
    expect(report.issues).toEqual([]);
  });

  it("supports a chain-disabled local report when chain vars are not present", () => {
    const report = buildLocalReport(completeEnv);

    expect(report.summary.chain.enabled).toBe(false);
    expect(report.summary.chain.cryptoTopup).toBe("disabled");
    expect(report.summary.chain.auditAnchor).toBe("disabled");
  });

  it("builds a blocked local report when required values are missing", () => {
    const report = buildDoctorReport({
      envFile: ".env.selfhosted",
      envFileExists: false,
      env: {},
      remote: false,
    });

    expect(report.ok).toBe(false);
    expect(report.local.issues).toContain("Env file not found: .env.selfhosted");
    expect(report.local.issues).toContain("Run `npm run selfhosted:init-env` to generate .env.selfhosted before deploy.");
  });

  it("points missing env-file reports at local secret initialization when local secrets exist", () => {
    const report = buildDoctorReport({
      envFile: ".env.selfhosted",
      envFileExists: false,
      env: {},
      localCredentials: { VULTR_API_KEY: "vultr-real-token" },
      localCredentialsPresent: true,
      remote: false,
    });

    expect(report.ok).toBe(false);
    expect(report.local.issues).toContain("Local secret files were found; run `npm run selfhosted:init-env` to generate .env.selfhosted from them.");
  });

  it("applies local secret file overrides to the doctor local report", () => {
    const report = buildDoctorReport({
      envFile: ".env.selfhosted",
      envFileExists: true,
      env: {
        ...completeEnv,
        VULTR_API_KEY: "",
      },
      localCredentials: {
        VULTR_API_KEY: "vultr-from-local-file",
      },
      remote: false,
    });

    expect(report.ok).toBe(true);
    expect(report.local.issues).toEqual([]);
  });

  it("builds a ready remote report when health output is complete", () => {
    const report = buildRemoteReport(
      [
        "api_health_http=200",
        "web_root_http=200",
        "private_web_http=200",
        "provision_container_present=true",
        "scheduler_container_present=true",
        "scheduler_health=healthy",
        "api_network_mode=host",
        "provision_url=http://127.0.0.1:3001",
        "provision_health=ok",
      ].join("\n"),
      "network_mode=host",
      "",
      [
        "staging_dir_present=true",
        "staging_file_count=146",
        "staging_env_uploaded=false",
      ].join("\n"),
    );

    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.staging.staging_file_count).toBe("146");
  });

  it("builds a blocked remote report when provision is missing or misconfigured", () => {
    const report = buildRemoteReport(
      [
        "api_health_http=200",
        "web_root_http=200",
        "private_web_http=200",
        "provision_container_present=false",
        "scheduler_container_present=false",
        "scheduler_health=unhealthy",
        "api_network_mode=anixops-audit",
        "provision_url=http://127.0.0.1:3001",
        "provision_url_warning=loopback_url_inside_container_network",
        "provision_health=failed",
      ].join("\n"),
      "",
      "Remote command failed with exit code 1",
    );

    expect(report.ok).toBe(false);
    expect(report.issues).toContain("No AnixOps provision container was detected on the remote host");
    expect(report.issues).toContain("No AnixOps scheduler container was detected on the remote host");
    expect(report.issues).toContain("Scheduler health is unhealthy");
    expect(report.issues).toContain("PROVISION_SERVER_URL points at localhost/127.0.0.1 while the API is running inside Docker networking");
    expect(report.issues).toContain("Provision health is failed");
  });

  it("formats local and remote summaries for human-readable output", () => {
    const localLines = formatLocalSummary(buildLocalReport(completeEnv));
    const remoteLines = formatRemoteSummary(buildRemoteReport(
      [
        "api_health_http=200",
        "web_root_http=200",
        "private_web_http=200",
        "provision_container_present=true",
        "scheduler_container_present=true",
        "scheduler_health=healthy",
        "api_network_mode=host",
        "provision_url=http://127.0.0.1:3001",
        "provision_health=ok",
      ].join("\n"),
      [
        "status_CLOUD_PROVIDER=vultr",
        "status_VPS_REGION=nrt",
        "status_VPS_PLAN=vhf-1c-1gb",
        "status_CHAIN_ENVIRONMENT=testnet",
        "status_CRYPTO_ALERT_WEBHOOK=configured",
        "status_AUDIT_ANCHOR_ALERT_WEBHOOK=missing",
        "status_scheduler_container=anixops-scheduler-audit",
      ].join("\n"),
    ));

    expect(localLines[0]).toBe("Local env: ready");
    expect(remoteLines[0]).toBe("Remote runtime: ready");
    expect(remoteLines.some((line) => line.includes("cloud provider: vultr"))).toBe(true);
    expect(remoteLines.some((line) => line.includes("provider target: nrt/vhf-1c-1gb"))).toBe(true);
    expect(remoteLines.some((line) => line.includes("chain environment: testnet"))).toBe(true);
    expect(remoteLines.some((line) => line.includes("crypto alert webhook: configured"))).toBe(true);
    expect(remoteLines.some((line) => line.includes("audit anchor alert webhook: missing"))).toBe(true);
    expect(remoteLines.some((line) => line.includes("scheduler container present: true"))).toBe(true);
    expect(remoteLines.some((line) => line.includes("scheduler health: healthy"))).toBe(true);
    expect(remoteLines.some((line) => line.includes("scheduler container: anixops-scheduler-audit"))).toBe(true);
  });

  it("shows chain missing keys and testnet hints in local doctor output", () => {
    const local = buildLocalReport({
      ...completeEnv,
      CHAIN_ENVIRONMENT: "testnet",
      CHAIN_TESTNET_WHITELIST_EMAILS: "qa@example.com",
      CRYPTO_ALERT_WEBHOOK_URL: "https://alerts.example/crypto",
      CRYPTO_TOPUP_CHAIN: "base",
      CRYPTO_TOPUP_ASSET: "USDT",
      CRYPTO_TOPUP_CONFIRMATIONS_REQUIRED: "12",
      CRYPTO_TOPUP_RPC_URL: "https://rpc.example",
    });
    const lines = formatLocalSummary(local);

    expect(lines.some((line) => line.includes("crypto topup missing:"))).toBe(true);
    expect(lines.some((line) => line.includes("bootstrap-evm-testnet.js"))).toBe(true);
    expect(lines.some((line) => line.includes("--deploy-mock-usdt"))).toBe(true);
  });

  it("shows scheduler hints when chain automation is fully configured", () => {
    const local = buildLocalReport({
      ...completeEnv,
      CHAIN_ENVIRONMENT: "testnet",
      CHAIN_TESTNET_WHITELIST_EMAILS: "qa@example.com",
      CRYPTO_ALERT_WEBHOOK_URL: "https://alerts.example/crypto",
      CRYPTO_TOPUP_CHAIN: "base",
      CRYPTO_TOPUP_ASSET: "USDT",
      CRYPTO_TOPUP_CONFIRMATIONS_REQUIRED: "12",
      CRYPTO_TOPUP_RPC_URL: "https://rpc.example",
      CRYPTO_TOPUP_RECEIVER_ADDRESS: "0x" + "1".repeat(40),
      CRYPTO_TOPUP_TOKEN_ADDRESS: "0x" + "2".repeat(40),
      CRYPTO_TOPUP_TOKEN_DECIMALS: "6",
      AUDIT_ANCHOR_CHAIN: "base",
      AUDIT_ANCHOR_RPC_URL: "https://rpc.example",
      AUDIT_ANCHOR_ALERT_WEBHOOK_URL: "https://alerts.example/audit",
      AUDIT_ANCHOR_SIGNER_PRIVATE_KEY: "0x" + "3".repeat(64),
      AUDIT_ANCHOR_TARGET_ADDRESS: "0x" + "4".repeat(40),
    });
    const lines = formatLocalSummary(local);

    expect(lines.some((line) => line.includes("scheduler will enable crypto topup scans"))).toBe(true);
    expect(lines.some((line) => line.includes("scheduler will enable audit anchor runs"))).toBe(true);
    expect(lines.some((line) => line.includes("crypto alert webhook: configured"))).toBe(true);
    expect(lines.some((line) => line.includes("audit anchor alert webhook: configured"))).toBe(true);
  });

  it("uses shape-ok verdict for placeholder-tolerant local checks", () => {
    const local = buildLocalReport(completeEnv, { allowPlaceholders: true });
    const report = { ok: true, local, remote: null };

    expect(formatLocalSummary(local)[0]).toBe("Local env: shape-ok");
    expect(getVerdictLabel(report)).toBe("shape-ok");
  });

  it("suggests init-env when baseline local secrets are missing", () => {
    const local = buildLocalReport({
      CLOUD_PROVIDER: "vultr",
      VULTR_API_KEY: "",
    });
    const lines = formatLocalSummary(local);

    expect(lines.some((line) => line.includes("selfhosted:init-env"))).toBe(true);
  });
});
