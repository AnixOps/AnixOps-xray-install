#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { runRemote, shellQuote } = require("./remote-ops.js");

const SENSITIVE_ENV_PATTERN = /(SECRET|TOKEN|PASSWORD|PASS|API_KEY|PRIVATE_KEY|WEBHOOK_SECRET|SMTP_PASS)/i;
const ENV_PREVIEW_ALLOWLIST = new Set([
  "ADMIN_EMAILS",
  "ALLOWED_ORIGINS",
  "API_PROXY_TIMEOUT_MS",
  "API_URL",
  "AWS_REGION",
  "CHAIN_ENVIRONMENT",
  "CLOUD_PROVIDER",
  "FRONTEND_URL",
  "HOST",
  "HOSTNAME",
  "NEXT_PUBLIC_WORKER_URL",
  "NODE_ENV",
  "PORT",
  "PROVISION_SERVER_URL",
  "SMTP_FROM",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "VPS_PLAN",
  "VPS_REGION",
]);

function parseArgs(argv) {
  const args = {
    out: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      args.out = argv[i + 1];
      i += 1;
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
  node scripts/remote-baseline.js [--out docs/remote-baseline.json]

Captures a redacted baseline of the current remote AnixOps runtime for audit and rollback planning.`);
}

function parseEnvList(list) {
  const env = {};
  for (const entry of list || []) {
    const index = String(entry).indexOf("=");
    if (index === -1) continue;
    const key = entry.slice(0, index);
    const value = entry.slice(index + 1);
    env[key] = value;
  }
  return env;
}

function sanitizeEnv(env) {
  const names = Object.keys(env).sort();
  const preview = {};
  const secretKeys = [];

  for (const key of names) {
    if (SENSITIVE_ENV_PATTERN.test(key)) {
      secretKeys.push(key);
      continue;
    }
    if (ENV_PREVIEW_ALLOWLIST.has(key)) {
      preview[key] = env[key];
    }
  }

  return {
    names,
    preview,
    secretKeys,
  };
}

function sanitizeContainer(container) {
  const env = parseEnvList(container.Config?.Env || []);
  const mounts = (container.Mounts || []).map((mount) => ({
    type: mount.Type,
    source: mount.Source,
    destination: mount.Destination,
    mode: mount.Mode || "",
    rw: Boolean(mount.RW),
  }));

  return {
    name: container.Name?.replace(/^\//, "") || "",
    image: container.Config?.Image || "",
    created: container.Created || "",
    state: {
      status: container.State?.Status || "",
      running: Boolean(container.State?.Running),
      startedAt: container.State?.StartedAt || "",
      restartCount: container.RestartCount || 0,
    },
    hostConfig: {
      networkMode: container.HostConfig?.NetworkMode || "",
      restartPolicy: container.HostConfig?.RestartPolicy?.Name || "",
      portBindings: container.HostConfig?.PortBindings || {},
    },
    config: {
      user: container.Config?.User || "",
      workingDir: container.Config?.WorkingDir || "",
      cmd: container.Config?.Cmd || [],
      entrypoint: container.Config?.Entrypoint || [],
      exposedPorts: container.Config?.ExposedPorts || {},
    },
    networkNames: Object.keys(container.NetworkSettings?.Networks || {}),
    mounts,
    env: sanitizeEnv(env),
  };
}

function sanitizeInspectPayload(inspectData) {
  return (inspectData || []).map(sanitizeContainer);
}

async function collectRemoteJson(command) {
  const result = await runRemote(command, { stdoutWriter: null, stderrWriter: null });
  const text = String(result.stdout || "").trim();
  if (!text) {
    return null;
  }
  return JSON.parse(text);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const containerNamesResult = await runRemote(
    `docker ps --filter name=anixops --format '{{.Names}}'`,
    { stdoutWriter: null, stderrWriter: null },
  );
  const names = String(containerNamesResult.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const inspectCommand = names.length > 0
    ? `docker inspect ${names.map((name) => shellQuote(name)).join(" ")}`
    : "printf '[]'";
  const inspectData = await collectRemoteJson(inspectCommand);

  const statusResult = await runRemote(
    [
      "set -eu",
      'printf "status_host=%s\\n" "$(hostname 2>/dev/null || echo unknown)"',
      'printf "status_date=%s\\n" "$(date -Is 2>/dev/null || date)"',
      "if command -v ss >/dev/null 2>&1; then",
      "  ss -ltnp 2>/dev/null | grep -E ':(30000|8787|3001) ' || true",
      "elif command -v netstat >/dev/null 2>&1; then",
      "  netstat -ltnp 2>/dev/null | grep -E ':(30000|8787|3001) ' || true",
      "fi",
    ].join("\n"),
    { stdoutWriter: null, stderrWriter: null },
  );

  const baseline = {
    capturedAt: new Date().toISOString(),
    remote: {
      hostSummary: String(statusResult.stdout || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      containers: sanitizeInspectPayload(inspectData),
    },
  };

  const text = `${JSON.stringify(baseline, null, 2)}\n`;
  if (args.out) {
    const outPath = path.resolve(process.cwd(), args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, text, "utf8");
    console.log(`Remote baseline written to ${args.out}`);
  } else {
    process.stdout.write(text);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  parseEnvList,
  sanitizeContainer,
  sanitizeEnv,
  sanitizeInspectPayload,
};
