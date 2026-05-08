#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Client } = require("ssh2");
const { loadSshConfig } = require("./remote-ops.js");
const { loadProvisionEnv, validateProvisionEnv } = require("./provision-env-check.js");

const ROOT_FILES = [
  "docker-compose.selfhosted.yml",
  "Dockerfile.scheduler",
  "Dockerfile.web",
  "next.config.mjs",
  "next-env.d.ts",
  "package.json",
  "package-lock.json",
  "postcss.config.js",
  "tailwind.config.js",
  "tsconfig.json",
  "versions.json",
];

const ROOT_DIRS = ["app", "web", "server", "provision-server", "scripts"];
const EXCLUDED_DIR_NAMES = new Set([".git", ".next", "node_modules", "dist", "coverage"]);
const EXCLUDED_FILE_NAMES = new Set([
  ".env.local",
  ".env.production",
  ".env.selfhosted",
  "tsconfig.tsbuildinfo",
]);
const DEPLOY_PORTS = [30000, 8787];
const DEFAULT_REPLACEABLE_CONTAINERS = ["anixops-audit-api", "anixops-ui-audit", "anixops-scheduler-audit"];
const DEFAULT_COMPOSE_PROJECT = "anixops-selfhosted";
const TARGET_CONTAINER_NAMES = {
  api: "anixops-audit-api",
  web: "anixops-ui-audit",
  postgres: "anixops-audit-postgres",
  redis: "anixops-audit-redis",
  provision: "anixops-provision-audit",
  scheduler: "anixops-scheduler-audit",
};

function parseArgs(argv) {
  const args = {
    envFile: ".env.selfhosted",
    remoteDir: "/opt/anixops-selfhosted",
    dryRun: false,
    allowPlaceholders: false,
    replaceLive: false,
    skipHealth: false,
    syncOnly: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--env-file" || arg === "--file") {
      args.envFile = argv[i + 1];
      i += 1;
    } else if (arg === "--remote-dir") {
      args.remoteDir = argv[i + 1];
      i += 1;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--allow-placeholders") {
      args.allowPlaceholders = true;
    } else if (arg === "--replace-live") {
      args.replaceLive = true;
    } else if (arg === "--skip-health") {
      args.skipHealth = true;
    } else if (arg === "--sync-only") {
      args.syncOnly = true;
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
  node scripts/selfhosted-deploy.js [--file .env.selfhosted] [--remote-dir /opt/anixops-selfhosted] [--dry-run] [--allow-placeholders] [--replace-live] [--skip-health] [--sync-only]

Uploads the self-hosted stack to a remote host, after validating env shape and checking for port conflicts.`);
}

function validateDeployMode(args) {
  if (args.allowPlaceholders && !args.dryRun) {
    throw new Error("--allow-placeholders is only allowed with --dry-run; real deployments require concrete credentials.");
  }
  if (args.syncOnly && args.replaceLive) {
    throw new Error("--sync-only cannot be combined with --replace-live.");
  }
  if (args.syncOnly && args.skipHealth) {
    throw new Error("--sync-only cannot be combined with --skip-health because no health check is run.");
  }
}

function formatEnvValidationFailure(validation) {
  const issues = Array.isArray(validation?.issues) ? validation.issues : [];
  const lines = [
    "Self-hosted deploy blocked by env validation:",
    ...issues.map((issue) => `- ${issue}`),
  ];

  if (
    issues.some((issue) => /^(Missing|[A-Z0-9_]+ is empty or placeholder)/.test(issue))
    && issues.some((issue) => /(PROVISION_SERVER_TOKEN|API_SECRET|POSTGRES_PASSWORD|REDIS_PASSWORD|FRONTEND_URL|ALLOWED_ORIGINS|VULTR_API_KEY|DIGITALOCEAN_TOKEN|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SECURITY_GROUP_ID)/.test(issue))
  ) {
    lines.push("hint: run `npm run selfhosted:init-env` to regenerate baseline env values and merge local secret files.");
  }

  if (issues.some((issue) => issue.includes("detected configured credentials for"))) {
    lines.push("hint: align `CLOUD_PROVIDER` with the credential set you actually supplied, or rerun `npm run selfhosted:init-env` so provider defaults are refreshed.");
  }

  if (
    issues.some((issue) => /VPS_PLAN looks like a Vultr slug|VPS_REGION looks like a Vultr region|AWS_REGION should match VPS_REGION/.test(issue))
  ) {
    lines.push("hint: the region/plan defaults still match a different provider; update `.env.selfhosted` or rerun `npm run selfhosted:init-env -- --provider <provider>`.");
  }

  return lines.join("\n");
}

function normalizeRelativePath(value) {
  return value.replace(/\\/g, "/");
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function shouldIncludePath(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => EXCLUDED_DIR_NAMES.has(part))) {
    return false;
  }
  const basename = parts[parts.length - 1] || "";
  if (EXCLUDED_FILE_NAMES.has(basename)) {
    return false;
  }
  if (basename.startsWith(".env")) {
    return false;
  }
  return true;
}

function isManagedUploadPath(relativePath) {
  const normalized = normalizeRelativePath(String(relativePath || ""))
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
  if (!normalized || !shouldIncludePath(normalized)) {
    return false;
  }
  if (ROOT_FILES.includes(normalized)) {
    return true;
  }
  return ROOT_DIRS.some((dir) => normalized === dir || normalized.startsWith(`${dir}/`));
}

function walkFiles(rootDir, currentDir, results) {
  const fullDir = path.join(rootDir, currentDir);
  if (!fs.existsSync(fullDir)) {
    return;
  }

  const entries = fs.readdirSync(fullDir, { withFileTypes: true });
  for (const entry of entries) {
    const relative = normalizeRelativePath(path.join(currentDir, entry.name));
    if (!shouldIncludePath(relative)) {
      continue;
    }
    const fullPath = path.join(rootDir, relative);
    if (entry.isDirectory()) {
      walkFiles(rootDir, relative, results);
    } else if (entry.isFile()) {
      results.push(relative);
    }
  }
}

function buildUploadManifest(repoRoot) {
  const files = [];
  for (const file of ROOT_FILES) {
    if (fs.existsSync(path.join(repoRoot, file)) && shouldIncludePath(file)) {
      files.push(normalizeRelativePath(file));
    }
  }
  for (const dir of ROOT_DIRS) {
    walkFiles(repoRoot, dir, files);
  }
  return files.sort();
}

function collectExpectedRemoteRelativePaths(uploadTargets, remoteDir) {
  return Array.from(new Set(
    (uploadTargets || [])
      .map((target) => normalizeRelativePath(path.posix.relative(remoteDir, target.remotePath)))
      .filter((relativePath) => isManagedUploadPath(relativePath)),
  )).sort();
}

function summarizeManifest(repoRoot, manifest) {
  const totalBytes = manifest.reduce((sum, relativePath) => {
    return sum + fs.statSync(path.join(repoRoot, relativePath)).size;
  }, 0);

  return {
    fileCount: manifest.length,
    totalBytes,
  };
}

function parsePortConflicts(output, ports = DEPLOY_PORTS) {
  const conflicts = [];
  const lines = String(output || "").split(/\r?\n/);
  const portSet = new Set(ports.map((port) => String(port)));

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^([^ ]+)\s+(.+)$/);
    if (!match) continue;
    const container = match[1];
    const portsBlob = match[2];
    const matchedPorts = Array.from(new Set(
      Array.from(portsBlob.matchAll(/:(\d+)->/g))
        .map((item) => item[1])
        .filter((port) => portSet.has(port)),
    ));
    if (matchedPorts.length > 0) {
      conflicts.push({ container, ports: matchedPorts.map(Number) });
    }
  }

  return conflicts;
}

function parseHostPortListeners(output, ports = DEPLOY_PORTS) {
  const listeners = [];
  const lines = String(output || "").split(/\r?\n/);
  const portSet = new Set(ports.map((port) => String(port)));

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const portMatch = trimmed.match(/:(\d+)\b/);
    if (!portMatch || !portSet.has(portMatch[1])) {
      continue;
    }

    const ssProcessMatch = trimmed.match(/users:\(\("([^"]+)"/);
    const netstatProcessMatch = trimmed.match(/\b\d+\/([^\s]+)$/);
    const processName = ssProcessMatch?.[1] || netstatProcessMatch?.[1];
    if (!processName) {
      continue;
    }

    listeners.push({
      port: Number(portMatch[1]),
      process: processName,
      raw: trimmed,
    });
  }

  return listeners;
}

function runSshCommand(conn, command) {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      let stdout = "";
      let stderr = "";
      stream.on("close", (code) => {
        if (code) {
          const error = new Error(`Remote command failed with exit code ${code}`);
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      });
      stream.on("data", (data) => {
        stdout += data.toString();
      });
      stream.stderr.on("data", (data) => {
        stderr += data.toString();
      });
    });
  });
}

function connectSsh(config) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on("ready", () => resolve(conn))
      .on("keyboard-interactive", (_name, _instructions, _lang, _prompts, finish) => {
        finish(config.password ? [config.password] : []);
      })
      .on("error", (error) => reject(error))
      .connect({
        host: config.host,
        port: config.port,
        username: config.username,
        ...(config.privateKey ? { privateKey: config.privateKey } : {}),
        ...(config.password ? { password: config.password } : {}),
        readyTimeout: 20000,
        tryKeyboard: true,
      });
  });
}

function getSftp(conn) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(sftp);
    });
  });
}

function ensureRemoteDir(sftp, remoteDir) {
  const parts = remoteDir.split("/").filter(Boolean);
  let current = remoteDir.startsWith("/") ? "/" : "";

  return parts.reduce((promise, part) => {
    return promise.then(() => new Promise((resolve, reject) => {
      current = current === "/" ? `/${part}` : path.posix.join(current, part);
      sftp.stat(current, (statError) => {
        if (!statError) {
          resolve();
          return;
        }
        sftp.mkdir(current, (mkdirError) => {
          if (mkdirError && mkdirError.code !== 4) {
            reject(mkdirError);
            return;
          }
          resolve();
        });
      });
    }));
  }, Promise.resolve());
}

function uploadFile(sftp, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function buildManagedRemoteListingCommand(remoteDir) {
  return [
    "set -eu",
    `cd ${shellEscape(remoteDir)}`,
    `for file in ${ROOT_FILES.map((file) => shellEscape(file)).join(" ")}; do`,
    '  if [ -f "$file" ]; then printf "%s\\n" "$file"; fi',
    "done",
    `for dir in ${ROOT_DIRS.map((dir) => shellEscape(dir)).join(" ")}; do`,
    '  if [ -d "$dir" ]; then find "$dir" -type f -print; fi',
    "done",
  ].join("\n");
}

function parseManagedRemotePaths(output) {
  return Array.from(new Set(
    String(output || "")
      .split(/\r?\n/)
      .map((line) => normalizeRelativePath(line.trim()))
      .filter(Boolean)
      .filter((relativePath) => isManagedUploadPath(relativePath)),
  )).sort();
}

function computeStaleRemotePaths(expectedRelativePaths, remoteRelativePaths) {
  const expected = new Set((expectedRelativePaths || []).map((value) => normalizeRelativePath(value)));
  return Array.from(new Set(
    (remoteRelativePaths || [])
      .map((value) => normalizeRelativePath(value))
      .filter((relativePath) => isManagedUploadPath(relativePath) && !expected.has(relativePath)),
  )).sort();
}

function buildRemotePruneCommand(remoteDir, staleRelativePaths) {
  const stalePaths = Array.from(new Set(
    (staleRelativePaths || [])
      .map((value) => normalizeRelativePath(value))
      .filter((relativePath) => isManagedUploadPath(relativePath)),
  )).sort();
  if (stalePaths.length === 0) {
    return "";
  }
  return [
    "set -eu",
    `cd ${shellEscape(remoteDir)}`,
    ...stalePaths.map((relativePath) => `rm -f -- ${shellEscape(relativePath)}`),
    `for dir in ${ROOT_DIRS.map((dir) => shellEscape(dir)).join(" ")}; do`,
    '  if [ -d "$dir" ]; then',
    '    find "$dir" -depth -type d -empty -exec rmdir {} \\; 2>/dev/null || true',
    "  fi",
    "done",
  ].join("\n");
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function partitionConflicts(conflicts, replaceableContainers = DEFAULT_REPLACEABLE_CONTAINERS) {
  const replaceable = new Set(replaceableContainers);
  return {
    replaceable: conflicts.filter((conflict) => replaceable.has(conflict.container)),
    blocking: conflicts.filter((conflict) => !replaceable.has(conflict.container)),
  };
}

function parseContainerNames(output) {
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function findNameCollisions(existingNames, targetNames = Object.values(TARGET_CONTAINER_NAMES)) {
  const existing = new Set(existingNames);
  return targetNames.filter((name) => existing.has(name));
}

function parseInspectJson(output) {
  const text = String(output || "").trim();
  if (!text) {
    return [];
  }
  return JSON.parse(text);
}

function parseContainerEnv(envEntries = []) {
  const result = {};
  for (const entry of envEntries || []) {
    const index = String(entry).indexOf("=");
    if (index === -1) {
      continue;
    }
    result[String(entry).slice(0, index)] = String(entry).slice(index + 1);
  }
  return result;
}

function getInspectContainerName(container) {
  return String(container?.Name || "").replace(/^\//, "");
}

function isSelfHostedComposeContainer(container, projectName = DEFAULT_COMPOSE_PROJECT) {
  const labels = container?.Config?.Labels || {};
  return labels["com.docker.compose.project"] === projectName;
}

function filterUnmanagedContainers(inspectData, names, projectName = DEFAULT_COMPOSE_PROJECT) {
  const managed = new Set(
    (inspectData || [])
      .filter((container) => isSelfHostedComposeContainer(container, projectName))
      .map((container) => getInspectContainerName(container))
      .filter(Boolean),
  );
  return names.filter((name) => !managed.has(name));
}

function extractUrlPassword(value) {
  try {
    const parsed = new URL(value);
    return parsed.password ? decodeURIComponent(parsed.password) : "";
  } catch {
    return "";
  }
}

function extractDataMountOverrides(inspectData) {
  const overrides = {};
  for (const container of inspectData || []) {
    const name = getInspectContainerName(container);
    const mounts = Array.isArray(container.Mounts) ? container.Mounts : [];
    const env = parseContainerEnv(container.Config?.Env);
    if (name === TARGET_CONTAINER_NAMES.api) {
      const postgresPassword = extractUrlPassword(env.DATABASE_URL || "");
      if (postgresPassword) {
        overrides.POSTGRES_PASSWORD = postgresPassword;
      }
    }
    if (name === TARGET_CONTAINER_NAMES.postgres) {
      const mount = mounts.find((item) => item.Destination === "/var/lib/postgresql/data");
      if (mount?.Source) {
        overrides.POSTGRES_DATA_PATH = mount.Source;
      }
    }
    if (name === TARGET_CONTAINER_NAMES.redis) {
      const mount = mounts.find((item) => item.Destination === "/data");
      if (mount?.Source) {
        overrides.REDIS_DATA_PATH = mount.Source;
      }
    }
    if (name === TARGET_CONTAINER_NAMES.provision) {
      const mount = mounts.find((item) => item.Destination === "/app/.ssh");
      if (mount?.Source) {
        overrides.PROVISION_SSH_PATH = mount.Source;
      }
    }
  }
  return overrides;
}

function serializeEnvEntries(entries) {
  return `${Object.entries(entries)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}

function replaceEnvUploadTarget(uploadTargets, remoteDir, entries) {
  const tempEnvPath = path.join(os.tmpdir(), `anixops-selfhosted-${Date.now()}-${process.pid}.env`);
  fs.writeFileSync(tempEnvPath, serializeEnvEntries(entries), "utf8");

  for (const target of uploadTargets) {
    if (target.temp && path.posix.basename(target.remotePath) === ".env.selfhosted") {
      try {
        fs.unlinkSync(target.localPath);
      } catch {}
    }
  }

  return [
    ...uploadTargets.filter((target) => path.posix.basename(target.remotePath) !== ".env.selfhosted"),
    {
      localPath: tempEnvPath,
      remotePath: path.posix.join(remoteDir, ".env.selfhosted"),
      temp: true,
    },
  ];
}

function loadSshConfigForMode({ dryRun }) {
  if (!dryRun) {
    return loadSshConfig();
  }

  try {
    return loadSshConfig();
  } catch {
    return {
      host: "not-configured",
      port: 22,
      username: "unknown",
      password: "",
      privateKey: null,
      privateKeyPath: "",
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  validateDeployMode(args);

  const repoRoot = path.resolve(__dirname, "..");
  const manifest = buildUploadManifest(repoRoot);
  const summary = summarizeManifest(repoRoot, manifest);
  const config = loadSshConfigForMode(args);
  let remoteEnvEntries = {};
  let validation = { provider: "not-required", issues: [] };
  let uploadTargets = [
    ...manifest.map((relativePath) => ({
      localPath: path.join(repoRoot, relativePath),
      remotePath: path.posix.join(args.remoteDir, normalizeRelativePath(relativePath)),
    })),
  ];

  if (!args.syncOnly) {
    const env = loadProvisionEnv(args.envFile, { cwd: repoRoot });
    validation = validateProvisionEnv(env, { allowPlaceholders: args.allowPlaceholders });
    if (validation.issues.length > 0) {
      throw new Error(formatEnvValidationFailure(validation));
    }

    remoteEnvEntries = { ...env };
    uploadTargets = replaceEnvUploadTarget(uploadTargets, args.remoteDir, remoteEnvEntries);
  }

  if (args.dryRun) {
    const uploadBytes = uploadTargets.reduce((total, target) => total + fs.statSync(target.localPath).size, 0);
    console.log(`Self-hosted deploy plan
remote_host=${config.host}
remote_dir=${args.remoteDir}
provider=${validation.provider}
upload_files=${uploadTargets.length}
upload_size=${formatBytes(uploadBytes)}
sync_only=${args.syncOnly}
replace_live=${args.replaceLive}
health_check=${args.syncOnly ? "not-run" : args.skipHealth ? "skipped" : "enabled"}`);
    uploadTargets.slice(0, 20).forEach((target) => {
      console.log(`- ${normalizeRelativePath(path.relative(repoRoot, target.localPath))} -> ${target.remotePath}`);
    });
    if (uploadTargets.length > 20) {
      console.log(`... ${uploadTargets.length - 20} more files`);
    }
    for (const target of uploadTargets) {
      if (target.temp) {
        try {
          fs.unlinkSync(target.localPath);
        } catch {}
      }
    }
    return;
  }

  const conn = await connectSsh(config);
  try {
    let legacyContainerNames = [];

    if (!args.syncOnly) {
      const portCheck = await runSshCommand(
        conn,
        'docker ps --format "{{.Names}} {{.Ports}}"',
      );
      const conflicts = parsePortConflicts(portCheck.stdout);
      const containerNamesResult = await runSshCommand(
        conn,
        'docker ps -a --format "{{.Names}}"',
      );
      const existingNames = parseContainerNames(containerNamesResult.stdout);
      const listenerCheck = await runSshCommand(
        conn,
        [
          "set -eu",
          "if command -v ss >/dev/null 2>&1; then",
          "  ss -ltnp 2>/dev/null || true",
          "elif command -v netstat >/dev/null 2>&1; then",
          "  netstat -ltnp 2>/dev/null || true",
          "fi",
        ].join("\n"),
      );
      const hostListeners = parseHostPortListeners(listenerCheck.stdout)
        .filter((listener) => listener.process !== "docker-proxy");
      const conflictGroups = partitionConflicts(conflicts);
      const nameCollisions = findNameCollisions(existingNames);

      if (conflictGroups.blocking.length > 0 || hostListeners.length > 0) {
        throw new Error(
          `Remote port conflicts detected:\n${[
            ...conflictGroups.blocking.map((conflict) => `- container ${conflict.container} uses ${conflict.ports.join(", ")}`),
            ...hostListeners.map((listener) => `- process ${listener.process} is listening on ${listener.port}`),
          ].join("\n")}`,
        );
      }

      if ((conflictGroups.replaceable.length > 0 || nameCollisions.length > 0) && !args.replaceLive) {
        throw new Error(
          `Remote live containers currently conflict with the target self-hosted stack:\n${[
            ...conflictGroups.replaceable.map((conflict) => `- ${conflict.container} uses ${conflict.ports.join(", ")}`),
            ...nameCollisions.map((name) => `- container name already exists: ${name}`),
          ].join("\n")}\nRe-run with --replace-live to stop and rename these legacy containers during cutover.`,
        );
      }

      const candidateContainerNames = args.replaceLive
        ? Array.from(new Set([
            ...conflictGroups.replaceable.map((conflict) => conflict.container),
            ...nameCollisions,
          ]))
        : [];

      if (candidateContainerNames.length > 0) {
        const inspectResult = await runSshCommand(
          conn,
          `docker inspect ${candidateContainerNames.map((name) => `'${name}'`).join(" ")}`,
        );
        const inspectData = parseInspectJson(inspectResult.stdout);
        legacyContainerNames = filterUnmanagedContainers(
          inspectData,
          candidateContainerNames,
          path.posix.basename(args.remoteDir) || DEFAULT_COMPOSE_PROJECT,
        );
        remoteEnvEntries = {
          ...remoteEnvEntries,
          ...extractDataMountOverrides(inspectData),
        };
        uploadTargets = replaceEnvUploadTarget(uploadTargets, args.remoteDir, remoteEnvEntries);
      }
    }

    const sftp = await getSftp(conn);
    await ensureRemoteDir(sftp, args.remoteDir);

    try {
      for (const target of uploadTargets) {
        await ensureRemoteDir(sftp, path.posix.dirname(target.remotePath));
        await uploadFile(sftp, target.localPath, target.remotePath);
      }

      const expectedRemoteRelativePaths = collectExpectedRemoteRelativePaths(uploadTargets, args.remoteDir);
      const remoteListing = await runSshCommand(conn, buildManagedRemoteListingCommand(args.remoteDir));
      const staleRemotePaths = computeStaleRemotePaths(
        expectedRemoteRelativePaths,
        parseManagedRemotePaths(remoteListing.stdout),
      );
      if (staleRemotePaths.length > 0) {
        const pruneResult = await runSshCommand(conn, buildRemotePruneCommand(args.remoteDir, staleRemotePaths));
        console.log(`remote_prune_removed=${staleRemotePaths.length}`);
        if (pruneResult.stdout) {
          process.stdout.write(pruneResult.stdout);
        }
        if (pruneResult.stderr) {
          process.stderr.write(pruneResult.stderr);
        }
      }

      if (args.syncOnly) {
        console.log(`Self-hosted sync-only upload completed to ${config.host}:${args.remoteDir}`);
        return;
      }

      const containersToReplace = legacyContainerNames;
      if (args.replaceLive && containersToReplace.length > 0) {
        const stopResult = await runSshCommand(
          conn,
          [
            "set -eu",
            "rename_suffix=$(date +%Y%m%d%H%M%S)",
            `for container in ${containersToReplace.map((name) => `'${name}'`).join(" ")}; do`,
            '  docker stop "$container" >/dev/null 2>&1 || true',
            '  docker rename "$container" "${container}-legacy-${rename_suffix}"',
            "done",
          ].join("\n"),
        );
        process.stdout.write(stopResult.stdout);
        if (stopResult.stderr) {
          process.stderr.write(stopResult.stderr);
        }
      }

      const deployCommand = [
        "set -eu",
        `cd ${args.remoteDir}`,
        "docker compose --env-file .env.selfhosted -f docker-compose.selfhosted.yml up -d --build --remove-orphans",
        ...(args.skipHealth
          ? []
          : [
              "api_code=000",
              "web_code=000",
              "for attempt in $(seq 1 30); do",
              "  api_code=$(curl -sS -o /tmp/anixops-selfhosted-api-health.out -w \"%{http_code}\" --max-time 8 http://127.0.0.1:8787/health || true)",
              "  web_code=$(curl -sS -o /tmp/anixops-selfhosted-web-root.out -w \"%{http_code}\" --max-time 8 http://127.0.0.1:30000/ || true)",
              "  if [ \"$api_code\" = \"200\" ] && [ \"$web_code\" = \"200\" ]; then",
              "    break",
              "  fi",
              "  echo \"health_attempt=$attempt api_http=$api_code web_http=$web_code\"",
              "  sleep 3",
              "done",
              "if [ \"$api_code\" != \"200\" ] || [ \"$web_code\" != \"200\" ]; then",
              "  echo \"Self-hosted health check failed: api_http=$api_code web_http=$web_code\"",
              "  echo \"--- api health body ---\"",
              "  cat /tmp/anixops-selfhosted-api-health.out 2>/dev/null || true",
              "  echo \"--- compose ps ---\"",
              "  docker compose --env-file .env.selfhosted -f docker-compose.selfhosted.yml ps -a || true",
              "  echo \"--- api logs ---\"",
              "  docker logs --tail 120 anixops-audit-api 2>&1 || true",
              "  echo \"--- provision logs ---\"",
              "  docker logs --tail 120 anixops-provision-audit 2>&1 || true",
              "  exit 1",
              "fi",
            ]),
      ].join("\n");

      try {
        const result = await runSshCommand(conn, deployCommand);
        process.stdout.write(result.stdout);
        if (result.stderr) {
          process.stderr.write(result.stderr);
        }
      } catch (error) {
        if (error && typeof error === "object") {
          if (error.stdout) {
            process.stdout.write(error.stdout);
          }
          if (error.stderr) {
            process.stderr.write(error.stderr);
          }
        }
        if (args.replaceLive && containersToReplace.length > 0) {
          const rollbackCommand = [
            "set +e",
            `cd ${args.remoteDir} && docker compose --env-file .env.selfhosted -f docker-compose.selfhosted.yml down || true`,
            `for container in ${containersToReplace.map((name) => `'${name}'`).join(" ")}; do`,
            '  legacy=$(docker ps -a --format "{{.Names}}" | grep "^${container}-legacy-" | tail -n 1 || true)',
            '  if [ -n "$legacy" ]; then',
            '    docker rename "$legacy" "$container" || true',
            '    docker start "$container" || true',
            "  fi",
            "done",
          ].join("\n");
          const rollbackResult = await runSshCommand(conn, rollbackCommand).catch((rollbackError) => ({
            stdout: rollbackError.stdout || "",
            stderr: rollbackError.stderr || rollbackError.message || "",
          }));
          process.stderr.write("Self-hosted deploy failed; attempted rollback to legacy containers.\n");
          if (rollbackResult.stdout) {
            process.stdout.write(rollbackResult.stdout);
          }
          if (rollbackResult.stderr) {
            process.stderr.write(rollbackResult.stderr);
          }
        }
        throw error;
      }
      console.log(`Self-hosted deploy completed to ${config.host}:${args.remoteDir}`);
    } finally {
      for (const target of uploadTargets) {
        if (target.temp) {
          try {
            fs.unlinkSync(target.localPath);
          } catch {}
        }
      }
    }
  } finally {
    conn.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  buildUploadManifest,
  buildManagedRemoteListingCommand,
  buildRemotePruneCommand,
  collectExpectedRemoteRelativePaths,
  computeStaleRemotePaths,
  extractDataMountOverrides,
  filterUnmanagedContainers,
  findNameCollisions,
  formatBytes,
  isManagedUploadPath,
  parseArgs,
  parseContainerNames,
  parseInspectJson,
  parseManagedRemotePaths,
  parseHostPortListeners,
  parsePortConflicts,
  partitionConflicts,
  serializeEnvEntries,
  shouldIncludePath,
  summarizeManifest,
  loadSshConfigForMode,
  formatEnvValidationFailure,
  validateDeployMode,
};
