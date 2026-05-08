#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { Client } = require("ssh2");

const DEFAULT_UNIFIED_SECRETS_FILE = path.resolve(__dirname, "..", ".local-secrets.env");
const DEFAULT_SSH_FILE = path.resolve(__dirname, "..", "ssh.txt");
const SSH_FILE = process.env.ANIXOPS_SSH_FILE
  ? path.resolve(process.cwd(), process.env.ANIXOPS_SSH_FILE)
  : fs.existsSync(DEFAULT_UNIFIED_SECRETS_FILE)
    ? DEFAULT_UNIFIED_SECRETS_FILE
    : DEFAULT_SSH_FILE;
const DEFAULT_PRIVATE_KEY_FILE = path.resolve(__dirname, "..", ".ssh", "anixops_remote_ed25519");
const API_CONTAINER = "anixops-audit-api";
const WEB_CONTAINER = "anixops-ui-audit";
const SCHEDULER_CONTAINER = "anixops-scheduler-audit";
const PROVISION_CONTAINER_REGEX = "anixops.*provision|provision.*anixops";
const DEFAULT_REMOTE_DIR = "/opt/anixops-selfhosted";
const JOB_SCRIPTS = {
  billing: "scripts/billing-tick-worker.js --json",
  "crypto-topups": "scripts/crypto-topup-worker.js --json",
  "audit-anchor": "scripts/audit-anchor-worker.js --json",
  "compliance-stats": "scripts/compliance-stats-worker.js --json",
};

function parseSshConfig(raw) {
  const read = (keys, fallback = "") => {
    for (const key of keys) {
      const match = raw.match(new RegExp(`^\\s*${key}\\s*[:=]\\s*(.+?)\\s*$`, "im"));
      if (match) return match[1].trim();
    }
    return fallback;
  };

  return {
    host: read(["ip", "host", "hostname", "SSH_HOST", "SSH_IP", "REMOTE_HOST"]),
    port: Number(read(["port", "SSH_PORT", "REMOTE_PORT"], "22")),
    username: read(["user", "username", "SSH_USER", "SSH_USERNAME", "REMOTE_USER"], "root"),
    password: read(["password", "pass", "SSH_PASSWORD", "SSH_PASS", "REMOTE_PASSWORD"]),
    privateKeyPath: read([
      "key",
      "keyfile",
      "identityfile",
      "identity_file",
      "privatekey",
      "private_key",
      "SSH_PRIVATE_KEY_FILE",
      "SSH_KEY_FILE",
      "REMOTE_PRIVATE_KEY_FILE",
    ]),
  };
}

function loadSshConfig() {
  if (!fs.existsSync(SSH_FILE)) {
    throw new Error(`Missing ${path.relative(process.cwd(), SSH_FILE)}; remote ops require local SSH credentials.`);
  }

  const config = parseSshConfig(fs.readFileSync(SSH_FILE, "utf8"));
  const configuredKeyPath = config.privateKeyPath
    ? path.resolve(path.dirname(SSH_FILE), config.privateKeyPath)
    : DEFAULT_PRIVATE_KEY_FILE;
  const privateKey = fs.existsSync(configuredKeyPath) ? fs.readFileSync(configuredKeyPath) : null;

  if (!config.host || (!config.password && !privateKey)) {
    throw new Error(".local-secrets.env or ssh.txt must include ip/host and either password or a usable SSH private key.");
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error(".local-secrets.env or ssh.txt contains an invalid port.");
  }
  return { ...config, privateKey, privateKeyPath: privateKey ? configuredKeyPath : "" };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\"'\"'")}'`;
}

function validateEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized)) {
    throw new Error("Expected a valid admin email address.");
  }
  return normalized;
}

function validateTail(value) {
  const tail = Number(value || 120);
  if (!Number.isInteger(tail) || tail < 1 || tail > 1000) {
    throw new Error("Log tail must be an integer between 1 and 1000.");
  }
  return tail;
}

function isLoopbackUrl(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized.startsWith("http://127.0.0.1:")
    || normalized.startsWith("https://127.0.0.1:")
    || normalized.startsWith("http://localhost:")
    || normalized.startsWith("https://localhost:");
}

function diagnoseProvisionUrl(value, networkMode = "") {
  if (!String(value || "").trim()) {
    return "missing";
  }
  if (isLoopbackUrl(value) && String(networkMode || "").trim() !== "host") {
    return "loopback_in_container_network";
  }
  return "ok";
}

function resolveProvisionContainerCommand(varName = "provision_container") {
  return `${varName}=$(docker ps -a --format "{{.Names}}" | grep -E '${PROVISION_CONTAINER_REGEX}' | head -n 1 || true)`;
}

function runRemote(command, { stdoutWriter = process.stdout, stderrWriter = process.stderr } = {}) {
  const config = loadSshConfig();
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const stdoutChunks = [];
    const stderrChunks = [];
    conn
      .on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            conn.end();
            reject(err);
            return;
          }
          stream.on("close", (code) => {
            conn.end();
            const result = {
              stdout: stdoutChunks.join(""),
              stderr: stderrChunks.join(""),
              code: code || 0,
            };
            if (code) {
              const error = new Error(`Remote command failed with exit code ${code}`);
              error.result = result;
              reject(error);
              return;
            }
            resolve(result);
          });
          stream.on("data", (data) => {
            const text = data.toString();
            stdoutChunks.push(text);
            if (stdoutWriter) {
              stdoutWriter.write(text);
            }
          });
          stream.stderr.on("data", (data) => {
            const text = data.toString();
            stderrChunks.push(text);
            if (stderrWriter) {
              stderrWriter.write(text);
            }
          });
        });
      })
      .on("keyboard-interactive", (_name, _instructions, _lang, _prompts, finish) => {
        finish(config.password ? [config.password] : []);
      })
      .on("error", (err) => reject(err))
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

function statusCommand() {
  return [
    "set -eu",
    resolveProvisionContainerCommand(),
    `scheduler_container=$(docker ps -a --filter name="^/${SCHEDULER_CONTAINER}$" --format "{{.Names}}" | head -n 1 || true)`,
    'printf "status_host=%s\\n" "$(hostname 2>/dev/null || echo unknown)"',
    'printf "status_date=%s\\n" "$(date -Is 2>/dev/null || date)"',
    'echo "--- containers ---"',
    'docker ps --filter name=anixops --format "{{.Names}} | {{.Image}} | {{.Status}} | {{.Ports}}"',
    'echo "--- ports ---"',
    "if command -v ss >/dev/null 2>&1; then",
    "  ss -ltnp 2>/dev/null | grep -E ':(30000|8787|3001) ' || true",
    "elif command -v netstat >/dev/null 2>&1; then",
    "  netstat -ltnp 2>/dev/null | grep -E ':(30000|8787|3001) ' || true",
    "else",
    '  echo "no ss/netstat available"',
    "fi",
    'echo "--- api network ---"',
    `docker inspect -f 'status_network_mode={{.HostConfig.NetworkMode}}' ${shellQuote(API_CONTAINER)} 2>/dev/null || true`,
    'echo "--- admin env ---"',
    `if docker inspect ${shellQuote(API_CONTAINER)} >/dev/null 2>&1; then`,
    `  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' ${shellQuote(API_CONTAINER)} | awk -F= '$1=="ADMIN_EMAILS" {print "status_ADMIN_EMAILS="$2} $1=="PROVISION_SERVER_URL" {print "status_PROVISION_SERVER_URL="$2} $1=="CHAIN_ENVIRONMENT" {print "status_CHAIN_ENVIRONMENT="$2} $1=="CHAIN_TESTNET_WHITELIST_EMAILS" {print "status_CHAIN_TESTNET_WHITELIST_EMAILS="$2} $1=="CRYPTO_ALERT_WEBHOOK_URL" {print "status_CRYPTO_ALERT_WEBHOOK=" (substr($0, index($0, "=")+1) != "" ? "configured" : "missing")} $1=="AUDIT_ANCHOR_ALERT_WEBHOOK_URL" {print "status_AUDIT_ANCHOR_ALERT_WEBHOOK=" (substr($0, index($0, "=")+1) != "" ? "configured" : "missing")}'`,
    "fi",
    'echo "--- provision container ---"',
    'if [ -n "$provision_container" ]; then',
    '  printf "status_provision_container=%s\\n" "$provision_container"',
    '  docker ps --filter name="^/${provision_container}$" --format "{{.Names}} | {{.Status}} | {{.Ports}}"',
    '  docker inspect -f \'{{range .Config.Env}}{{println .}}{{end}}\' "$provision_container" | awk -F= \'$1=="CLOUD_PROVIDER" {print "status_CLOUD_PROVIDER="$2} $1=="VPS_REGION" {print "status_VPS_REGION="$2} $1=="VPS_PLAN" {print "status_VPS_PLAN="$2} $1=="AWS_REGION" {print "status_AWS_REGION="$2}\'',
    "else",
    '  echo "status_provision_container=missing"',
    "fi",
    'echo "--- scheduler container ---"',
    'if [ -n "$scheduler_container" ]; then',
    '  printf "status_scheduler_container=%s\\n" "$scheduler_container"',
    '  docker ps --filter name="^/${scheduler_container}$" --format "{{.Names}} | {{.Status}}"',
    "else",
    '  echo "status_scheduler_container=missing"',
    "fi",
  ].join("\n");
}

function healthCommand(strict = false) {
  return [
    "set -eu",
    `strict=${strict ? "true" : "false"}`,
    "health_failed=0",
    resolveProvisionContainerCommand(),
    `scheduler_container=$(docker ps -a --filter name="^/${SCHEDULER_CONTAINER}$" --format "{{.Names}}" | head -n 1 || true)`,
    'echo "--- health ---"',
    `provision_url=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' ${shellQuote(API_CONTAINER)} 2>/dev/null | awk -F= '$1=="PROVISION_SERVER_URL" {print $2}' || true)`,
    `api_network_mode=$(docker inspect -f '{{.HostConfig.NetworkMode}}' ${shellQuote(API_CONTAINER)} 2>/dev/null || echo unknown)`,
    'if [ -n "$provision_container" ]; then',
    '  echo "provision_container_present=true"',
    "else",
    '  echo "provision_container_present=false"',
    "fi",
    'if [ -n "$scheduler_container" ]; then',
    '  echo "scheduler_container_present=true"',
    '  scheduler_health=$(docker inspect -f \'{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}\' "$scheduler_container" 2>/dev/null || echo unknown)',
    '  echo "scheduler_health=$scheduler_health"',
    '  [ "$scheduler_health" = "healthy" ] || health_failed=1',
    "else",
    '  echo "scheduler_container_present=false"',
    "  health_failed=1",
    "fi",
    'echo "api_network_mode=$api_network_mode"',
    "if command -v curl >/dev/null 2>&1; then",
    '  api_code=$(curl -sS -o /tmp/anixops-api-health.out -w "%{http_code}" --max-time 8 http://127.0.0.1:8787/health || true)',
    '  web_code=$(curl -sS -o /tmp/anixops-web-root.out -w "%{http_code}" --max-time 10 http://127.0.0.1:30000/ || true)',
    '  private_web_code=$(curl -sS -o /tmp/anixops-private-web-root.out -w "%{http_code}" --max-time 10 http://10.100.0.130:30000/ || true)',
    '  echo "api_health_http=$api_code"',
    '  echo "web_root_http=$web_code"',
    '  echo "private_web_http=$private_web_code"',
    '  [ "$api_code" = "200" ] || health_failed=1',
    '  [ "$web_code" = "200" ] || health_failed=1',
    '  [ "$private_web_code" = "200" ] || health_failed=1',
    '  if [ -n "$provision_url" ]; then',
    '    echo "provision_url=$provision_url"',
    '    case "$provision_url" in',
    '      http://127.0.0.1:*|https://127.0.0.1:*|http://localhost:*|https://localhost:*)',
    '        if [ "$api_network_mode" != "host" ]; then',
    '          echo "provision_url_warning=loopback_url_inside_container_network"',
    "        fi",
    "        ;;",
    "    esac",
    `    docker exec ${shellQuote(API_CONTAINER)} node -e "const url = process.argv[1]; fetch(url, { signal: AbortSignal.timeout(8000) }).then(async (res) => { process.stdout.write(String(res.status) + '\\n'); process.stdout.write(String(res.headers.get('content-type') || '') + '\\n'); process.stdout.write(await res.text()); }).catch((error) => { console.error(error.message); process.exit(1); });" "$provision_url/health" >/tmp/anixops-provision-health.out 2>/tmp/anixops-provision-health.err || true`,
    '    provision_code=$(sed -n "1p" /tmp/anixops-provision-health.out 2>/dev/null || echo failed)',
    '    provision_type=$(sed -n "2p" /tmp/anixops-provision-health.out 2>/dev/null || true)',
    '    tail -n +3 /tmp/anixops-provision-health.out >/tmp/anixops-provision-health.body 2>/dev/null || true',
    '    if [ "$provision_code" = "200" ] && printf "%s" "$provision_type" | grep -qi "application/json" && grep -q \'"status"[[:space:]]*:[[:space:]]*"ok"\' /tmp/anixops-provision-health.body 2>/dev/null; then',
    '      echo "provision_health=ok"',
    '    else',
    '      provision_error=$(tr "\\n" " " </tmp/anixops-provision-health.err 2>/dev/null | sed "s/[[:space:]]\\+/ /g" | sed "s/^ //; s/ $//" || true)',
    '      if [ -n "$provision_error" ]; then',
    '        echo "provision_health=failed http=${provision_code:-unknown} content_type=${provision_type:-unknown} url=$provision_url via=api_container error=$provision_error"',
    '      else',
    '        echo "provision_health=failed http=${provision_code:-unknown} content_type=${provision_type:-unknown} url=$provision_url via=api_container"',
    '      fi',
    '      health_failed=1',
    '    fi',
    '  else',
    '    echo "provision_health=failed reason=missing_PROVISION_SERVER_URL"',
    '    health_failed=1',
    '  fi',
    "elif command -v wget >/dev/null 2>&1; then",
    "  wget -q -T 8 -O /tmp/anixops-api-health.out http://127.0.0.1:8787/health && echo api_health_http=200 || { echo api_health_http=failed; health_failed=1; }",
    "  wget -q -T 10 -O /tmp/anixops-web-root.out http://127.0.0.1:30000/ && echo web_root_http=200 || { echo web_root_http=failed; health_failed=1; }",
    '  echo "provision_health=unknown reason=curl_unavailable"',
    "else",
    '  echo "no curl/wget available"',
    "  health_failed=1",
    "fi",
    'if [ "$strict" = "true" ] && [ "$health_failed" -ne 0 ]; then',
    "  exit 1",
    "fi",
  ].join("\n");
}

function logsCommand(tail) {
  return [
    "set -eu",
    `tail=${tail}`,
    resolveProvisionContainerCommand(),
    `scheduler_container=$(docker ps -a --filter name="^/${SCHEDULER_CONTAINER}$" --format "{{.Names}}" | head -n 1 || true)`,
    `echo "--- ${API_CONTAINER} logs ---"`,
    `docker logs --tail "$tail" ${shellQuote(API_CONTAINER)} 2>&1 || true`,
    `echo "--- ${WEB_CONTAINER} logs ---"`,
    `docker logs --tail "$tail" ${shellQuote(WEB_CONTAINER)} 2>&1 || true`,
    `echo "--- ${SCHEDULER_CONTAINER} logs ---"`,
    'if [ -n "$scheduler_container" ]; then',
    '  docker logs --tail "$tail" "$scheduler_container" 2>&1 || true',
    "else",
    '  echo "scheduler container missing"',
    "fi",
    'echo "--- provision container logs ---"',
    'if [ -n "$provision_container" ]; then',
    '  docker logs --tail "$tail" "$provision_container" 2>&1 || true',
    "else",
    '  echo "provision container missing"',
    "fi",
  ].join("\n");
}

function psCommand() {
  return [
    "set -eu",
    'docker ps -a --filter name=anixops --format "{{.Names}} | {{.Image}} | {{.Status}} | {{.Ports}}"',
  ].join("\n");
}

function smokeCommand() {
  return [
    "set -eu",
    'check_http() {',
    '  label="$1"',
    '  url="$2"',
    '  expected="$3"',
    '  code=$(curl -sS -o /tmp/anixops-smoke.out -w "%{http_code}" --max-time 10 "$url" || true)',
    '  echo "$label=$code"',
    '  [ "$code" = "$expected" ]',
    '}',
    'check_http console_http http://127.0.0.1:30000/console 200',
    'check_http private_console_http http://10.100.0.130:30000/console 200',
    'check_http api_console_unauth http://127.0.0.1:8787/api/console/overview 401',
    'check_http web_console_unauth http://127.0.0.1:30000/api/console/overview 401',
    'check_http compliance_profiles_http http://127.0.0.1:8787/api/compliance/profiles 200',
    `api_secret=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' ${shellQuote(API_CONTAINER)} | awk -F= '$1=="API_SECRET" {print substr($0, index($0, "=")+1)}' | tail -n 1)`,
    'if [ -z "$api_secret" ]; then',
    '  echo "api_secret=missing"',
    '  exit 1',
    "fi",
    'billing_code=$(curl -sS -o /tmp/anixops-smoke-billing.out -w "%{http_code}" --max-time 15 -X POST -H "X-API-Secret: $api_secret" http://127.0.0.1:8787/internal/billing/tick || true)',
    'echo "billing_tick_http=$billing_code"',
    '[ "$billing_code" = "200" ] || exit 1',
    'crypto_scan_code=$(curl -sS -o /tmp/anixops-smoke-crypto-scan.out -w "%{http_code}" --max-time 20 -X POST -H "Content-Type: application/json" -H "X-API-Secret: $api_secret" -d "{\"limit\":1,\"lookbackBlocks\":100}" http://127.0.0.1:8787/internal/crypto-topups/scan || true)',
    'echo "crypto_topup_scan_http=$crypto_scan_code"',
    '[ "$crypto_scan_code" = "200" ] || exit 1',
    'compliance_sync_code=$(curl -sS -o /tmp/anixops-smoke-compliance.out -w "%{http_code}" --max-time 30 -X POST -H "Content-Type: application/json" -H "X-API-Secret: $api_secret" -d "{\"limit\":1}" http://127.0.0.1:8787/internal/compliance/stats/sync || true)',
    'echo "compliance_sync_http=$compliance_sync_code"',
    '[ "$compliance_sync_code" = "200" ] || exit 1',
    'smoke_email="smoke.$(date +%s)@example.com"',
    'auth_payload=$(printf \'{"email":"%s"}\' "$smoke_email")',
    'auth_body=$(curl -sS --max-time 10 -X POST http://127.0.0.1:8787/api/auth/register -H "Content-Type: application/json" -d "$auth_payload")',
    'token=$(printf "%s" "$auth_body" | sed -n \'s/.*"token":"\\([^"]*\\)".*/\\1/p\')',
    'if [ -z "$token" ]; then',
    '  echo "smoke_auth_register=failed"',
    '  printf "%s\\n" "$auth_body"',
    '  exit 1',
    "fi",
    'echo "smoke_auth_register=ok"',
    'for path in overview nodes wallet audit referrals; do',
    '  code=$(curl -sS -o /tmp/anixops-smoke-auth.out -w "%{http_code}" --max-time 10 -H "Authorization: Bearer $token" "http://127.0.0.1:8787/api/console/$path" || true)',
    '  echo "auth_console_${path}=$code"',
    '  [ "$code" = "200" ] || exit 1',
    "done",
    'wallet_body=$(curl -sS --max-time 10 -H "Authorization: Bearer $token" http://127.0.0.1:8787/api/wallet)',
    'chain_env=$(printf "%s" "$wallet_body" | sed -n \'s/.*"environment":"\\([^"]*\\)".*/\\1/p\' | head -n 1)',
    'chain_allowlisted=$(printf "%s" "$wallet_body" | sed -n \'s/.*"allowlisted":\\(true\\|false\\).*/\\1/p\' | head -n 1)',
    'echo "chain_environment=${chain_env:-unknown}"',
    'echo "chain_allowlisted=${chain_allowlisted:-unknown}"',
    'crypto_code=$(curl -sS -o /tmp/anixops-smoke-crypto.out -w "%{http_code}" --max-time 10 -X POST -H "Authorization: Bearer $token" -H "Content-Type: application/json" -d "{\"amount\":10,\"asset\":\"USDT\",\"network\":\"POLYGON\"}" http://127.0.0.1:8787/api/wallet/crypto-topups || true)',
    'echo "crypto_topup_http=$crypto_code"',
    'if [ "${chain_env:-}" = "testnet" ] && [ "${chain_allowlisted:-}" = "false" ]; then',
    '  [ "$crypto_code" = "403" ] || exit 1',
    "else",
    '  [ "$crypto_code" = "200" ] || exit 1',
    "fi",
  ].join("\n");
}

function rechargeCommand(remoteDir = DEFAULT_REMOTE_DIR) {
  return [
    "set -eu",
    `docker exec -w /app ${shellQuote(SCHEDULER_CONTAINER)} node scripts/recharge-smoke.js --json`,
  ].join("\n");
}

function auditAnchorSmokeCommand(remoteDir = DEFAULT_REMOTE_DIR) {
  return [
    "set -eu",
    `docker exec -w /app ${shellQuote(SCHEDULER_CONTAINER)} node scripts/audit-anchor-smoke.js --confirmation-mode synthetic --json`,
  ].join("\n");
}

function adminSearchCommand(query) {
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) {
    throw new Error("Admin search query is required.");
  }
  const encodedQuery = encodeURIComponent(normalizedQuery);
  return [
    "set -eu",
    `api_secret=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' ${shellQuote(API_CONTAINER)} | awk -F= '$1=="API_SECRET" {print substr($0, index($0, "=")+1)}' | tail -n 1)`,
    'if [ -z "$api_secret" ]; then',
    '  echo "api_secret=missing"',
    '  exit 1',
    "fi",
    `curl -sS --max-time 20 -H "X-API-Secret: $api_secret" "http://127.0.0.1:8787/api/admin/search?q=${encodedQuery}"`,
  ].join("\n");
}

function adminDestroyRentalCommand(rentalId) {
  const normalizedRentalId = String(rentalId || "").trim();
  if (!normalizedRentalId) {
    throw new Error("Rental id is required.");
  }
  const encodedRentalId = encodeURIComponent(normalizedRentalId);
  return [
    "set -eu",
    `api_secret=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' ${shellQuote(API_CONTAINER)} | awk -F= '$1=="API_SECRET" {print substr($0, index($0, "=")+1)}' | tail -n 1)`,
    'if [ -z "$api_secret" ]; then',
    '  echo "api_secret=missing"',
    '  exit 1',
    "fi",
    `curl -sS --max-time 20 -X POST -H "X-API-Secret: $api_secret" "http://127.0.0.1:8787/api/admin/rentals/${encodedRentalId}/destroy"`,
  ].join("\n");
}

function restartCommand(target) {
  if (target === "provision") {
    return [
      "set -eu",
      resolveProvisionContainerCommand(),
      'if [ -z "$provision_container" ]; then',
      '  echo "Provision container not found."',
      "  exit 1",
      "fi",
      'echo "Restarting $provision_container"',
      'docker restart "$provision_container"',
      "sleep 5",
      healthCommand(),
      'echo "--- running containers ---"',
      'docker ps --filter name=anixops --format "{{.Names}} {{.Status}} {{.Ports}}"',
    ].join("\n");
  }

  const containers =
    target === "all"
      ? [API_CONTAINER, WEB_CONTAINER, SCHEDULER_CONTAINER]
      : target === "api"
        ? [API_CONTAINER]
        : target === "web"
          ? [WEB_CONTAINER]
          : target === "scheduler"
            ? [SCHEDULER_CONTAINER]
          : null;

  if (!containers) {
    throw new Error("Restart target must be api, web, scheduler, provision, or all.");
  }

  return [
    "set -eu",
    ...(target === "all" ? [resolveProvisionContainerCommand()] : []),
    `for container in ${containers.map(shellQuote).join(" ")}; do`,
    '  echo "Restarting $container"',
    '  docker restart "$container"',
    "done",
    ...(target === "all"
      ? [
          'if [ -n "$provision_container" ]; then',
          '  echo "Restarting $provision_container"',
          '  docker restart "$provision_container"',
          "else",
          '  echo "Provision container not found; skipping."',
          "fi",
        ]
      : []),
    "sleep 5",
    healthCommand(),
    'echo "--- running containers ---"',
    'docker ps --filter name=anixops --format "{{.Names}} {{.Status}} {{.Ports}}"',
  ].join("\n");
}

function deployCommand(remoteDir = DEFAULT_REMOTE_DIR) {
  const normalizedRemoteDir = String(remoteDir || "").trim() || DEFAULT_REMOTE_DIR;
  return [
    "set -eu",
    `cd ${shellQuote(normalizedRemoteDir)}`,
    "docker compose --env-file .env.selfhosted -f docker-compose.selfhosted.yml up -d --build --remove-orphans",
    "sleep 5",
    healthCommand(true),
    'echo "--- compose ps ---"',
    "docker compose --env-file .env.selfhosted -f docker-compose.selfhosted.yml ps",
  ].join("\n");
}

function jobCommand(jobName, remoteDir = DEFAULT_REMOTE_DIR) {
  const normalizedJob = String(jobName || "").trim();
  const script = JOB_SCRIPTS[normalizedJob];
  if (!script) {
    throw new Error("Job name must be billing, crypto-topups, audit-anchor, or compliance-stats.");
  }
  return [
    "set -eu",
    `docker exec -w /app ${shellQuote(SCHEDULER_CONTAINER)} node ${script}`,
  ].join("\n");
}

function checkAdminCommand(email) {
  const quotedEmail = shellQuote(validateEmail(email));
  return [
    "set -eu",
    `admin_email=${quotedEmail}`,
    `current=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' ${shellQuote(API_CONTAINER)} | awk -F= '$1=="ADMIN_EMAILS" {print substr($0, index($0, "=")+1)}' || true)`,
    'case ",$current," in',
    '  *",$admin_email,"*) echo "admin_email_present=true" ;;',
    '  *) echo "admin_email_present=false" ;;',
    "esac",
    'echo "ADMIN_EMAILS=${current:-<empty>}"',
  ].join("\n");
}

function setAdminCommand(email) {
  const quotedEmail = shellQuote(validateEmail(email));
  return [
    "set -eu",
    `name=${shellQuote(API_CONTAINER)}`,
    `admin_email=${quotedEmail}`,
    "ts=$(date +%Y%m%d%H%M%S)",
    'backup="${name}-prev-${ts}"',
    "envfile=$(mktemp)",
    'cleanup() { rm -f "$envfile"; }',
    "trap cleanup EXIT",
    "",
    "rollback() {",
    '  echo "Rollback: restoring previous API container."',
    '  docker rm -f "$name" >/dev/null 2>&1 || true',
    '  docker rename "$backup" "$name" >/dev/null 2>&1 || true',
    '  docker start "$name" >/dev/null 2>&1 || true',
    "}",
    "",
    'if ! docker inspect "$name" >/dev/null 2>&1; then',
    '  echo "API container not found: $name"',
    "  exit 1",
    "fi",
    "",
    'image=$(docker inspect -f "{{.Config.Image}}" "$name")',
    'workdir=$(docker inspect -f "{{.Config.WorkingDir}}" "$name")',
    'network=$(docker inspect -f "{{.HostConfig.NetworkMode}}" "$name")',
    'restart=$(docker inspect -f "{{.HostConfig.RestartPolicy.Name}}" "$name")',
    'user=$(docker inspect -f "{{.Config.User}}" "$name")',
    '[ -n "$restart" ] || restart=no',
    "",
    'current=$(docker inspect -f "{{range .Config.Env}}{{println .}}{{end}}" "$name" | awk -F= \'$1=="ADMIN_EMAILS" {print substr($0, index($0, "=")+1)}\' || true)',
    'case ",$current," in',
    '  *",$admin_email,"*) next="$current" ;;',
    '  *) next="${current:+$current,}$admin_email" ;;',
    "esac",
    "",
    'if [ "$next" = "$current" ]; then',
    '  echo "Admin email already present; no container changes required."',
    '  echo "ADMIN_EMAILS=${current:-<empty>}"',
    "  exit 0",
    "fi",
    "",
    'docker inspect -f "{{range .Config.Env}}{{println .}}{{end}}" "$name" | awk -F= \'$1 != "ADMIN_EMAILS" {print}\' > "$envfile"',
    'printf "ADMIN_EMAILS=%s\\n" "$next" >> "$envfile"',
    'echo "Recreating $name with updated ADMIN_EMAILS."',
    "",
    'docker rename "$name" "$backup"',
    'docker stop "$backup" >/dev/null',
    "",
    "set +e",
    'if [ -n "$user" ]; then',
    '  new_id=$(docker run -d --name "$name" --restart "$restart" --network "$network" -p 8787:8787 -v /opt/anixops-api-audit:/app -w "$workdir" --user "$user" --env-file "$envfile" "$image" node dist/index.js 2>&1)',
    "else",
    '  new_id=$(docker run -d --name "$name" --restart "$restart" --network "$network" -p 8787:8787 -v /opt/anixops-api-audit:/app -w "$workdir" --env-file "$envfile" "$image" node dist/index.js 2>&1)',
    "fi",
    "run_rc=$?",
    "set -e",
    "",
    'if [ "$run_rc" -ne 0 ]; then',
    '  echo "New container failed to start: $new_id"',
    "  rollback",
    "  exit 1",
    "fi",
    "",
    'echo "New container: $new_id"',
    "sleep 5",
    'running=$(docker inspect -f "{{.State.Running}}" "$name" 2>/dev/null || echo false)',
    'if [ "$running" != "true" ]; then',
    '  echo "New API container is not running."',
    '  docker logs --tail 80 "$name" 2>&1 || true',
    "  rollback",
    "  exit 1",
    "fi",
    "",
    "if command -v curl >/dev/null 2>&1; then",
    "  if ! curl -fsS --max-time 8 http://127.0.0.1:8787/health >/tmp/anixops-api-health.out 2>/tmp/anixops-api-health.err; then",
    '    echo "API health check failed."',
    "    cat /tmp/anixops-api-health.err 2>/dev/null || true",
    '    docker logs --tail 80 "$name" 2>&1 || true',
    "    rollback",
    "    exit 1",
    "  fi",
    "fi",
    "",
    'updated=$(docker inspect -f "{{range .Config.Env}}{{println .}}{{end}}" "$name" | awk -F= \'$1=="ADMIN_EMAILS" {print substr($0, index($0, "=")+1)}\' || true)',
    'echo "ADMIN_EMAILS=$updated"',
    'docker ps --filter name="^/${name}$" --format "running: {{.Names}} {{.Status}} {{.Ports}}"',
    'docker rm "$backup" >/dev/null 2>&1 || true',
  ].join("\n");
}

function usage() {
  console.log(`Usage:
  node scripts/remote-ops.js ps
  node scripts/remote-ops.js status
  node scripts/remote-ops.js health [--strict]
  node scripts/remote-ops.js smoke
  node scripts/remote-ops.js recharge [remote-dir]
  node scripts/remote-ops.js audit-anchor-smoke [remote-dir]
  node scripts/remote-ops.js logs [tail]
  node scripts/remote-ops.js deploy [remote-dir]
  node scripts/remote-ops.js job billing|crypto-topups|audit-anchor|compliance-stats [remote-dir]
  node scripts/remote-ops.js restart api|web|scheduler|provision|all
  node scripts/remote-ops.js admin check <email>
  node scripts/remote-ops.js admin set <email>
  node scripts/remote-ops.js admin search <query>
  node scripts/remote-ops.js admin destroy <rentalId>

Reads SSH credentials from ignored local file: .local-secrets.env or ssh.txt, or ANIXOPS_SSH_FILE when set.
If .ssh/anixops_remote_ed25519 exists, it is used before password fallback.
Passwords and private keys are never printed by this script.`);
}

async function main() {
  const [command, subcommand, value] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }

  if (command === "status") {
    await runRemote(statusCommand());
    return;
  }
  if (command === "ps") {
    await runRemote(psCommand());
    return;
  }
  if (command === "health") {
    await runRemote(healthCommand(subcommand === "--strict"));
    return;
  }
  if (command === "smoke") {
    await runRemote(smokeCommand());
    return;
  }
  if (command === "recharge") {
    await runRemote(rechargeCommand(subcommand || DEFAULT_REMOTE_DIR));
    return;
  }
  if (command === "audit-anchor-smoke") {
    await runRemote(auditAnchorSmokeCommand(subcommand || DEFAULT_REMOTE_DIR));
    return;
  }
  if (command === "logs") {
    await runRemote(logsCommand(validateTail(subcommand)));
    return;
  }
  if (command === "deploy") {
    await runRemote(deployCommand(subcommand));
    return;
  }
  if (command === "job") {
    await runRemote(jobCommand(subcommand, value));
    return;
  }
  if (command === "restart") {
    await runRemote(restartCommand(subcommand));
    return;
  }
  if (command === "admin" && subcommand === "check") {
    await runRemote(checkAdminCommand(value));
    return;
  }
  if (command === "admin" && subcommand === "set") {
    await runRemote(setAdminCommand(value));
    return;
  }
  if (command === "admin" && subcommand === "search") {
    await runRemote(adminSearchCommand(value));
    return;
  }
  if (command === "admin" && subcommand === "destroy") {
    await runRemote(adminDestroyRentalCommand(value));
    return;
  }

  usage();
  throw new Error("Unknown remote ops command.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = {
  deployCommand,
  auditAnchorSmokeCommand,
  diagnoseProvisionUrl,
  isLoopbackUrl,
  healthCommand,
  adminDestroyRentalCommand,
  adminSearchCommand,
  jobCommand,
  loadSshConfig,
  logsCommand,
  parseSshConfig,
  psCommand,
  restartCommand,
  runRemote,
  shellQuote,
  rechargeCommand,
  smokeCommand,
  statusCommand,
  validateEmail,
  validateTail,
};
