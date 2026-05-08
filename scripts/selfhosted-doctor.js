#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { readLocalCredentialOverrides } = require("./local-secret-files.js");
const { loadProvisionEnv, summarizeProvisionEnv, validateProvisionEnv } = require("./provision-env-check.js");
const { healthCommand, runRemote, shellQuote, statusCommand } = require("./remote-ops.js");
const { parseHostPortListeners } = require("./selfhosted-deploy.js");

const DEFAULT_REMOTE_DIR = "/opt/anixops-selfhosted";

function parseArgs(argv) {
  const args = {
    envFile: ".env.selfhosted",
    remote: false,
    remoteDir: DEFAULT_REMOTE_DIR,
    strict: false,
    allowPlaceholders: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--env-file" || arg === "--file") {
      args.envFile = argv[i + 1];
      i += 1;
    } else if (arg === "--remote") {
      args.remote = true;
    } else if (arg === "--remote-dir") {
      args.remoteDir = argv[i + 1];
      i += 1;
    } else if (arg === "--strict") {
      args.strict = true;
    } else if (arg === "--allow-placeholders") {
      args.allowPlaceholders = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function usage() {
  console.log(`Usage:
  node scripts/selfhosted-doctor.js [--file .env.selfhosted] [--remote] [--remote-dir /opt/anixops-selfhosted] [--strict] [--allow-placeholders] [--json]

Runs a self-hosted readiness audit without printing secret values.`);
}

function stagingCommand(remoteDir = DEFAULT_REMOTE_DIR) {
  return [
    "set -eu",
    `staging_dir=${shellQuote(remoteDir)}`,
    'echo "--- staging ---"',
    'if [ -d "$staging_dir" ]; then',
    '  echo "staging_dir_present=true"',
    '  printf "staging_file_count="',
    '  find "$staging_dir" -type f | wc -l',
    '  if [ -f "$staging_dir/.env.selfhosted" ]; then',
    '    echo "staging_env_uploaded=true"',
    "  else",
    '    echo "staging_env_uploaded=false"',
    "  fi",
    "else",
    '  echo "staging_dir_present=false"',
    '  echo "staging_file_count=0"',
    '  echo "staging_env_uploaded=false"',
    "fi",
  ].join("\n");
}

function parseKeyValueLines(output) {
  const map = {};
  String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const index = line.indexOf("=");
      if (index === -1) return;
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim();
      if (key) {
        map[key] = value;
      }
    });
  return map;
}

function parseStatusSummary(output) {
  const allowedKeys = new Set([
    "status_host",
    "status_date",
    "status_network_mode",
    "status_PROVISION_SERVER_URL",
    "status_ADMIN_EMAILS",
    "status_CLOUD_PROVIDER",
    "status_VPS_REGION",
    "status_VPS_PLAN",
    "status_AWS_REGION",
    "status_CHAIN_ENVIRONMENT",
    "status_CRYPTO_ALERT_WEBHOOK",
    "status_AUDIT_ANCHOR_ALERT_WEBHOOK",
    "status_provision_container",
    "status_scheduler_container",
  ]);

  return Object.fromEntries(
    Object.entries(parseKeyValueLines(output)).filter(([key]) => allowedKeys.has(key)),
  );
}

function buildLocalReport(env, options = {}) {
  const summary = summarizeProvisionEnv(env);
  const validation = validateProvisionEnv(env, {
    allowPlaceholders: options.allowPlaceholders,
  });

  return {
    ok: validation.issues.length === 0,
    shapeOnly: Boolean(options.allowPlaceholders),
    provider: summary.provider,
    issues: validation.issues,
    summary,
  };
}

function buildRemoteReport(healthOutput, statusOutput = "", commandError = "", stagingOutput = "") {
  const health = parseKeyValueLines(healthOutput);
  const status = parseStatusSummary(statusOutput);
  const staging = parseKeyValueLines(stagingOutput);
  const hostListeners = parseHostPortListeners(statusOutput, [3001])
    .filter((listener) => listener.process !== "docker-proxy");
  const issues = [];

  if (commandError) {
    issues.push(commandError);
  }

  if (!health.api_health_http) {
    issues.push("Remote health output did not include api_health_http");
  } else if (health.api_health_http !== "200") {
    issues.push(`Remote API health returned ${health.api_health_http}`);
  }

  if (!health.web_root_http) {
    issues.push("Remote health output did not include web_root_http");
  } else if (health.web_root_http !== "200") {
    issues.push(`Remote Web root returned ${health.web_root_http}`);
  }

  if (!health.private_web_http) {
    issues.push("Remote health output did not include private_web_http");
  } else if (health.private_web_http !== "200") {
    issues.push(`Remote private Web root returned ${health.private_web_http}`);
  }

  if (health.provision_container_present === "false") {
    issues.push("No AnixOps provision container was detected on the remote host");
  }
  if (health.scheduler_container_present === "false") {
    issues.push("No AnixOps scheduler container was detected on the remote host");
  }
  if (health.scheduler_health && health.scheduler_health !== "healthy") {
    issues.push(`Scheduler health is ${health.scheduler_health}`);
  }

  if (health.provision_url_warning === "loopback_url_inside_container_network") {
    issues.push("PROVISION_SERVER_URL points at localhost/127.0.0.1 while the API is running inside Docker networking");
  }

  if (health.provision_health !== "ok") {
    const detail = health.provision_health
      ? `Provision health is ${health.provision_health}`
      : "Provision health did not report ok";
    issues.push(detail);
  }

  return {
    ok: issues.length === 0,
    issues,
    health,
    hostListeners,
    staging,
    status,
  };
}

function buildDoctorReport({
  envFile,
  envFileExists,
  env,
  localCredentials = {},
  localCredentialsPresent = false,
  allowPlaceholders = false,
  remote = false,
}) {
  const local = envFileExists
    ? buildLocalReport(
      {
        ...env,
        ...localCredentials,
      },
      { allowPlaceholders },
    )
    : {
        ok: false,
        shapeOnly: false,
        provider: "unknown",
        issues: [
          `Env file not found: ${envFile}`,
          localCredentialsPresent
            ? "Local secret files were found; run `npm run selfhosted:init-env` to generate .env.selfhosted from them."
            : "Run `npm run selfhosted:init-env` to generate .env.selfhosted before deploy.",
        ],
        summary: null,
      };

  return {
    ok: local.ok && !remote,
    local,
    remote: null,
  };
}

function formatLocalSummary(report) {
  const lines = [
    `Local env: ${report.ok ? (report.shapeOnly ? "shape-ok" : "ready") : "blocked"}`,
    `  provider: ${report.provider}`,
  ];

  if (report.summary) {
    const requiredEntries = Object.entries(report.summary.entries)
      .filter(([, meta]) => meta.required);
    const readyCount = requiredEntries.filter(([, meta]) => meta.present && !meta.placeholder).length;
    lines.push(`  required keys ready: ${readyCount}/${requiredEntries.length}`);
    if (report.summary.chain) {
      lines.push(`  chain enabled: ${report.summary.chain.enabled ? "yes" : "no"}`);
      lines.push(`  chain environment: ${report.summary.chain.environment}`);
      lines.push(`  testnet whitelist: ${report.summary.chain.whitelistConfigured ? "configured" : "missing"}`);
      const cryptoAlertConfigured = report.summary.entries.CRYPTO_ALERT_WEBHOOK_URL?.present
        && !report.summary.entries.CRYPTO_ALERT_WEBHOOK_URL?.placeholder;
      const auditAlertConfigured = report.summary.entries.AUDIT_ANCHOR_ALERT_WEBHOOK_URL?.present
        && !report.summary.entries.AUDIT_ANCHOR_ALERT_WEBHOOK_URL?.placeholder;
      lines.push(`  crypto alert webhook: ${cryptoAlertConfigured ? "configured" : "missing"}`);
      lines.push(`  audit anchor alert webhook: ${auditAlertConfigured ? "configured" : "missing"}`);
      lines.push(`  crypto topup chain: ${report.summary.chain.cryptoTopup}`);
      if (report.summary.chain.cryptoTopupMissingKeys?.length) {
        lines.push(`  crypto topup missing: ${report.summary.chain.cryptoTopupMissingKeys.join(", ")}`);
      } else if (report.summary.chain.cryptoTopup === "ready") {
        lines.push("  hint: self-hosted scheduler will enable crypto topup scans in auto mode");
      }
      lines.push(`  audit anchor chain: ${report.summary.chain.auditAnchor}`);
      if (report.summary.chain.auditAnchorMissingKeys?.length) {
        lines.push(`  audit anchor missing: ${report.summary.chain.auditAnchorMissingKeys.join(", ")}`);
      } else if (report.summary.chain.auditAnchor === "ready") {
        lines.push("  hint: self-hosted scheduler will enable audit anchor runs in auto mode");
      }
    }
  }

  if (report.issues.length > 0) {
    lines.push("  blockers:");
    for (const issue of report.issues) {
      lines.push(`  - ${issue}`);
    }
    if (report.issues.some((issue) => /^Missing (PROVISION_SERVER_TOKEN|API_SECRET|POSTGRES_PASSWORD|REDIS_PASSWORD|FRONTEND_URL|ALLOWED_ORIGINS)\b/.test(issue))) {
      lines.push("  hint: run `npm run selfhosted:init-env` to generate local secrets and baseline URLs");
    }
    if (report.summary?.chain?.environment === "testnet" && report.summary?.chain?.cryptoTopup === "partial") {
      lines.push("  hint: run `node scripts/bootstrap-evm-testnet.js --whitelist-emails <qa-email> --write-env` to generate test wallets and update the local env file");
    }
    if (report.summary?.chain?.cryptoTopupMissingKeys?.includes("CRYPTO_TOPUP_TOKEN_ADDRESS")) {
      lines.push("  hint: re-run bootstrap with `--deploy-mock-usdt --deployer-private-key <funded-key>` to fill the test token address");
    }
  }

  return lines;
}

function formatRemoteSummary(report) {
  const lines = [`Remote runtime: ${report.ok ? "ready" : "blocked"}`];
  if (report.health.api_network_mode) {
    lines.push(`  api network mode: ${report.health.api_network_mode}`);
  }
  if (report.status.status_CLOUD_PROVIDER) {
    lines.push(`  cloud provider: ${report.status.status_CLOUD_PROVIDER}`);
  }
  if (report.status.status_VPS_REGION || report.status.status_VPS_PLAN) {
    lines.push(`  provider target: ${(report.status.status_VPS_REGION || "unknown")}/${(report.status.status_VPS_PLAN || "unknown")}`);
  }
  if (report.status.status_AWS_REGION) {
    lines.push(`  aws region: ${report.status.status_AWS_REGION}`);
  }
  if (report.status.status_CHAIN_ENVIRONMENT) {
    lines.push(`  chain environment: ${report.status.status_CHAIN_ENVIRONMENT}`);
  }
  if (report.status.status_CRYPTO_ALERT_WEBHOOK) {
    lines.push(`  crypto alert webhook: ${report.status.status_CRYPTO_ALERT_WEBHOOK}`);
  }
  if (report.status.status_AUDIT_ANCHOR_ALERT_WEBHOOK) {
    lines.push(`  audit anchor alert webhook: ${report.status.status_AUDIT_ANCHOR_ALERT_WEBHOOK}`);
  }
  if (report.health.provision_url) {
    lines.push(`  provision url: ${report.health.provision_url}`);
  }
  if (report.health.provision_container_present) {
    lines.push(`  provision container present: ${report.health.provision_container_present}`);
  }
  if (report.health.scheduler_container_present) {
    lines.push(`  scheduler container present: ${report.health.scheduler_container_present}`);
  }
  if (report.health.scheduler_health) {
    lines.push(`  scheduler health: ${report.health.scheduler_health}`);
  }
  if (report.status.status_scheduler_container) {
    lines.push(`  scheduler container: ${report.status.status_scheduler_container}`);
  }
  if (report.hostListeners?.length) {
    for (const listener of report.hostListeners) {
      lines.push(`  host listener: ${listener.process} on ${listener.port}`);
    }
  }
  if (report.staging?.staging_dir_present) {
    lines.push(`  staging dir present: ${report.staging.staging_dir_present}`);
  }
  if (report.staging?.staging_file_count) {
    lines.push(`  staging files: ${report.staging.staging_file_count}`);
  }
  if (report.staging?.staging_env_uploaded) {
    lines.push(`  staging env uploaded: ${report.staging.staging_env_uploaded}`);
  }
  if (report.issues.length > 0) {
    lines.push("  blockers:");
    for (const issue of report.issues) {
      lines.push(`  - ${issue}`);
    }
  }
  return lines;
}

function getVerdictLabel(report) {
  if (!report.ok) {
    return "blocked";
  }
  if (!report.remote && report.local.shapeOnly) {
    return "shape-ok";
  }
  return "ready";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const envFile = path.resolve(process.cwd(), args.envFile);
  const envFileExists = fs.existsSync(envFile);
  const localCredentials = readLocalCredentialOverrides({ cwd: process.cwd() });
  const env = envFileExists ? loadProvisionEnv(args.envFile, { cwd: process.cwd() }) : {};
  const report = buildDoctorReport({
    envFile: args.envFile,
    envFileExists,
    env,
    localCredentials,
    localCredentialsPresent: Object.keys(localCredentials).length > 0,
    allowPlaceholders: args.allowPlaceholders,
    remote: args.remote,
  });

  if (args.remote) {
    let statusResult = { stdout: "", stderr: "" };
    let healthResult = { stdout: "", stderr: "" };
    let stagingResult = { stdout: "", stderr: "" };
    let commandError = "";

    try {
      statusResult = await runRemote(statusCommand(), { stdoutWriter: null, stderrWriter: null });
    } catch (error) {
      commandError = error instanceof Error ? error.message : String(error);
      if (error && typeof error === "object" && error.result) {
        statusResult = error.result;
      }
    }

    try {
      healthResult = await runRemote(healthCommand(), { stdoutWriter: null, stderrWriter: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      commandError = commandError ? `${commandError}; ${message}` : message;
      if (error && typeof error === "object" && error.result) {
        healthResult = error.result;
      }
    }

    try {
      stagingResult = await runRemote(stagingCommand(args.remoteDir), { stdoutWriter: null, stderrWriter: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      commandError = commandError ? `${commandError}; ${message}` : message;
      if (error && typeof error === "object" && error.result) {
        stagingResult = error.result;
      }
    }

    report.remote = buildRemoteReport(
      healthResult.stdout,
      statusResult.stdout,
      [commandError, statusResult.stderr, healthResult.stderr, stagingResult.stderr].filter(Boolean).join(" ").trim(),
      stagingResult.stdout,
    );
    report.ok = report.local.ok && report.remote.ok;
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const lines = ["Self-hosted doctor"];
    lines.push(...formatLocalSummary(report.local));
    if (report.remote) {
      lines.push(...formatRemoteSummary(report.remote));
    } else {
      lines.push("Remote runtime: skipped");
    }
    lines.push(`Verdict: ${getVerdictLabel(report)}`);
    console.log(lines.join("\n"));
  }

  if (args.strict && !report.ok) {
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  buildDoctorReport,
  buildLocalReport,
  buildRemoteReport,
  formatLocalSummary,
  formatRemoteSummary,
  getVerdictLabel,
  parseArgs,
  parseKeyValueLines,
  parseStatusSummary,
  stagingCommand,
};
