import { NodeSSH } from "node-ssh";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { generateKeyPairSync, randomBytes, randomUUID } from "crypto";
import { fileURLToPath } from "url";
import type { CloudProvider } from "./provider.js";
import { createVultrProvider } from "./providers/vultr.js";
import { createDOProvider } from "./providers/digitalocean.js";
import { createAWSProvider } from "./providers/aws.js";
import { logger } from "./logger.js";
import { ProvisionStageError, StageRecorder, runStage, type ProvisionStageLog } from "./stage-log.js";
import { verifyDeliveryConnectivity } from "./probe.js";

const CLOUD_PROVIDER = process.env.CLOUD_PROVIDER || "vultr";
const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_DIR = CURRENT_DIR.endsWith(`${process.platform === "win32" ? "\\" : "/"}dist`)
  ? join(CURRENT_DIR, "..")
  : join(CURRENT_DIR, "../..");
const SSH_KEY_DIR = process.env.SSH_KEY_DIR || join(APP_DIR, ".ssh");
const SSH_KEY_PATH = join(SSH_KEY_DIR, "anixops_rsa");

function getDigitaloceanToken() {
  return process.env.DIGITALOCEAN_TOKEN || process.env.DO_API_TOKEN || "";
}

function getProvider(): CloudProvider {
  switch (CLOUD_PROVIDER) {
    case "vultr":
      return createVultrProvider(process.env.VULTR_API_KEY!);
    case "digitalocean":
      return createDOProvider(getDigitaloceanToken());
    case "aws": {
      const ak = process.env.AWS_ACCESS_KEY_ID;
      const sk = process.env.AWS_SECRET_ACCESS_KEY;
      if (!ak || !sk) throw new Error("AWS provider requires AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY");
      return createAWSProvider(process.env.AWS_REGION || process.env.VPS_REGION || "us-east-1", ak, sk);
    }
    default:
      throw new Error(`Unsupported cloud provider: ${CLOUD_PROVIDER}`);
  }
}

export function getOrCreateSSHKey(): { publicKey: string; privateKey: string } {
  if (!existsSync(SSH_KEY_DIR)) {
    mkdirSync(SSH_KEY_DIR, { recursive: true, mode: 0o700 });
  }

  const pubPath = `${SSH_KEY_PATH}.pub`;

  if (existsSync(SSH_KEY_PATH) && existsSync(pubPath)) {
    return {
      publicKey: readFileSync(pubPath, "utf-8").trim(),
      privateKey: readFileSync(SSH_KEY_PATH, "utf-8").trim(),
    };
  }

  const { publicKey: pubKeyObject, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 4096,
  });
  const privateKeyPem = privateKey.export({ type: "pkcs1", format: "pem" }) as string;
  const jwk = pubKeyObject.export({ format: "jwk" }) as { kty: string; n: string; e: string };
  const sshPublicKey = `ssh-rsa ${buildOpenSshRsaPublicKey(jwk).toString("base64")} anixops`;

  writeFileSync(SSH_KEY_PATH, privateKeyPem, { mode: 0o600 });
  writeFileSync(pubPath, sshPublicKey);

  logger.info("Generated new RSA SSH key pair");
  return { publicKey: sshPublicKey, privateKey: privateKeyPem };
}

function buildOpenSshRsaPublicKey(jwk: { kty: string; n: string; e: string }): Buffer {
  if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) {
    throw new Error("Generated RSA key is missing public key parameters");
  }

  return Buffer.concat([
    encodeSshString(Buffer.from("ssh-rsa")),
    encodeSshString(encodeSshMpint(Buffer.from(jwk.e, "base64url"))),
    encodeSshString(encodeSshMpint(Buffer.from(jwk.n, "base64url"))),
  ]);
}

function encodeSshString(value: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(value.length, 0);
  return Buffer.concat([len, value]);
}

function encodeSshMpint(value: Buffer): Buffer {
  let normalized = value;
  while (normalized.length > 1 && normalized[0] === 0 && (normalized[1] & 0x80) === 0) {
    normalized = normalized.subarray(1);
  }
  if (normalized.length > 0 && (normalized[0] & 0x80) !== 0) {
    return Buffer.concat([Buffer.from([0]), normalized]);
  }
  return normalized;
}

interface ProvisionResult {
  rentalId: string;
  attemptId?: string;
  vpsId: string;
  ip: string;
  config: Record<string, string>;
  debug: {
    stageLogs: ProvisionStageLog[];
  };
}

interface ProvisionAttemptContext {
  attemptId?: string;
  attemptNo?: number;
  maxAttempts?: number;
  compliancePolicy?: CompliancePolicy;
}

type InstallMode = "cloud-init-preferred" | "ssh";

interface CompliancePolicy {
  profileId?: string;
  version?: string;
  mode?: "standard" | "restricted";
  allowedPorts?: number[];
  allowedCidrs?: string[];
  blockedProtocols?: string[];
}

interface ProtocolInstallPlan {
  protocol: "vless-reality" | "hysteria2";
  port: number | string;
  scriptPath: string;
  args: string[];
  uuid?: string;
  shortId?: string;
  serverName?: string;
  password?: string;
  obfs?: string;
  script?: string;
  compliancePolicy?: CompliancePolicy;
}

function normalizeHysteria2PortSpec(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65535) {
    return String(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (/^\d+$/.test(normalized)) {
    const port = Number(normalized);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? String(port) : null;
  }

  const rangeMatch = normalized.match(/^(\d+)-(\d+)$/);
  if (!rangeMatch) {
    return null;
  }

  const start = Number(rangeMatch[1]);
  const end = Number(rangeMatch[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 65535 || start > end) {
    return null;
  }

  return `${start}-${end}`;
}

function getHysteria2PortSpec() {
  return normalizeHysteria2PortSpec(process.env.HYSTERIA2_PORT_SPEC) || "20000-50000";
}

function getHysteria2PrimaryPort(portSpec: string) {
  const firstSegment = portSpec.split(",")[0]?.trim() || "";
  const match = firstSegment.match(/^(\d+)(?:-(\d+))?$/);
  return match ? Number(match[1]) : 0;
}

function buildAttemptMeta(attempt: ProvisionAttemptContext) {
  return {
    attemptId: attempt.attemptId || null,
    attempt: attempt.attemptNo || null,
    maxAttempts: attempt.maxAttempts || null,
  };
}

function getInstallMode(): InstallMode {
  const raw = (process.env.INSTALL_MODE || process.env.PROVISION_INSTALL_MODE || "cloud-init-preferred").trim().toLowerCase();
  return raw === "ssh" || raw === "ssh-only" ? "ssh" : "cloud-init-preferred";
}

function getDisguiseDomainPool() {
  const raw = process.env.DISGUISE_DOMAINS || process.env.REALITY_SERVER_NAMES || "addons.mozilla.org";
  const domains = raw
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => /^[a-z0-9._-]+$/.test(domain));
  return domains.length > 0 ? domains : ["addons.mozilla.org"];
}

function pickDisguiseDomain() {
  const domains = getDisguiseDomainPool();
  const index = randomBytes(1)[0] % domains.length;
  return domains[index];
}

function normalizeCompliancePolicy(policy: CompliancePolicy | undefined): CompliancePolicy | undefined {
  if (!policy || policy.mode !== "restricted") {
    return policy;
  }
  return {
    profileId: policy.profileId || "restricted-egress",
    version: policy.version || "unknown",
    mode: "restricted",
    allowedPorts: Array.isArray(policy.allowedPorts)
      ? policy.allowedPorts.filter((port) => Number.isInteger(port) && port > 0 && port <= 65535)
      : [53, 80, 443],
    allowedCidrs: Array.isArray(policy.allowedCidrs) ? policy.allowedCidrs.map(String).filter(Boolean) : ["0.0.0.0/0"],
    blockedProtocols: Array.isArray(policy.blockedProtocols) ? policy.blockedProtocols.map(String) : [],
  };
}

function createProtocolInstallPlan(
  protocol: "vless-reality" | "hysteria2",
  compliancePolicy?: CompliancePolicy,
): ProtocolInstallPlan {
  if (protocol === "vless-reality") {
    const port = 443;
    const uuid = randomUUID();
    const shortId = randomBytes(4).toString("hex");
    const serverName = pickDisguiseDomain();
    return {
      protocol,
      port,
      uuid,
      shortId,
      serverName,
      scriptPath: process.env.SCRIPT_DIR
        ? `${process.env.SCRIPT_DIR}/${protocol}.sh`
        : join(APP_DIR, `scripts/${protocol}.sh`),
      args: ["--uuid", uuid, "--port", String(port), "--short-id", shortId, "--server-name", serverName],
      compliancePolicy: normalizeCompliancePolicy(compliancePolicy),
    };
  }

  const port = getHysteria2PortSpec();
  const password = randomUUID().slice(0, 16);
  const obfs = randomUUID().slice(0, 12);
  return {
    protocol,
    port,
    password,
    obfs,
    scriptPath: process.env.SCRIPT_DIR
      ? `${process.env.SCRIPT_DIR}/hysteria2.sh`
      : join(APP_DIR, "scripts/hysteria2.sh"),
    args: ["--port", String(port), "--password", password, "--obfs", obfs],
    compliancePolicy: normalizeCompliancePolicy(compliancePolicy),
  };
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function buildCloudInitUserData(script: string, plan: ProtocolInstallPlan) {
  const encodedScript = Buffer.from(script, "utf-8").toString("base64");
  const complianceCommand = buildCompliancePolicyCommand(plan.compliancePolicy);
  const command = [
    "set +e",
    `bash /root/anixops-install.sh ${plan.args.map(shellQuote).join(" ")} > /root/anixops-install-output.env 2>&1`,
    "echo $? > /root/anixops-install-exit-code",
    complianceCommand,
  ].join("; ");

  return [
    "#cloud-config",
    "write_files:",
    "  - path: /root/anixops-install.sh",
    "    permissions: '0700'",
    "    encoding: b64",
    `    content: ${encodedScript}`,
    "runcmd:",
    `  - [ bash, -lc, ${JSON.stringify(command)} ]`,
    "",
  ].join("\n");
}

function buildCompliancePolicyCommand(policy: CompliancePolicy | undefined) {
  if (!policy || policy.mode !== "restricted") {
    return "true";
  }
  const ports = (policy.allowedPorts && policy.allowedPorts.length > 0 ? policy.allowedPorts : [53, 80, 443])
    .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
  const tcpRules = ports.map((port) => `iptables -A ANIXOPS_EGRESS -p tcp --dport ${port} -j ACCEPT`).join("; ");
  const udpRules = ports.map((port) => `iptables -A ANIXOPS_EGRESS -p udp --dport ${port} -j ACCEPT`).join("; ");
  const policyJson = JSON.stringify(policy).replace(/'/g, "'\\''");
  return [
    "mkdir -p /etc/anixops",
    `printf '%s' '${policyJson}' > /etc/anixops/compliance-policy.json`,
    "if command -v iptables >/dev/null 2>&1; then",
    "iptables -N ANIXOPS_EGRESS 2>/dev/null || true",
    "iptables -F ANIXOPS_EGRESS",
    "iptables -C OUTPUT -j ANIXOPS_EGRESS 2>/dev/null || iptables -A OUTPUT -j ANIXOPS_EGRESS",
    "iptables -A ANIXOPS_EGRESS -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT",
    "iptables -A ANIXOPS_EGRESS -o lo -j ACCEPT",
    tcpRules || "true",
    udpRules || "true",
    "iptables -A ANIXOPS_EGRESS -j REJECT",
    "fi",
  ].join("; ");
}

async function prepareCloudInitUserData(plan: ProtocolInstallPlan, stages: StageRecorder) {
  if (getInstallMode() === "ssh") {
    stages.record("stage3-0-cloud-init-skipped", "info", "Cloud-init install disabled by install mode", {
      protocol: plan.protocol,
      installMode: "ssh",
    });
    return null;
  }

  const script = readFileSync(plan.scriptPath, "utf-8");
  plan.script = script;
  const userData = buildCloudInitUserData(script, plan);
  stages.record("stage3-0-cloud-init-prepared", "ok", "Cloud-init install payload prepared", {
    protocol: plan.protocol,
    installMode: "cloud-init-preferred",
    bytes: userData.length,
  });
  return userData;
}

export async function provisionNode(
  rentalId: string,
  protocol: "vless-reality" | "hysteria2",
  attempt: ProvisionAttemptContext = {},
): Promise<ProvisionResult> {
  const stages = new StageRecorder(rentalId, "provision");
  const attemptMeta = buildAttemptMeta(attempt);
  try {
    const provider = getProvider();
    const region = process.env.VPS_REGION || "nrt";
    const plan = process.env.VPS_PLAN || "vhf-1c-1gb";
    stages.record("stage1-1-provider-ready", "ok", "Cloud provider selected", {
      ...attemptMeta,
      provider: CLOUD_PROVIDER,
      region,
      plan,
    });

    const { publicKey, privateKey } = await runStage(
      stages,
      "stage1-2-ssh-key-ready",
      "SSH key ready for cloud init",
      async () => getOrCreateSSHKey(),
    );
    const installPlan = createProtocolInstallPlan(protocol, attempt.compliancePolicy);
    const userData = await prepareCloudInitUserData(installPlan, stages);

    const existingServers = await runStage(
      stages,
      "stage1-3-vps-reuse-check",
      "Check for existing VPS with rental label",
      async () => provider.listServersByTag(rentalId),
      { provider: CLOUD_PROVIDER },
    );

    if (existingServers.length > 1) {
      stages.record("stage1-3-vps-reuse-check", "warn", "Multiple existing VPS records matched rental label", {
        count: existingServers.length,
      });
    }

    const created = existingServers[0] || await runStage(
      stages,
      "stage1-3-vps-create",
      "Create VPS through cloud provider API",
      async () => provider.createServer({
        region,
        plan,
        sshKey: publicKey,
        tag: rentalId,
        userData: userData || undefined,
      }),
      { provider: CLOUD_PROVIDER, region, plan, installMode: userData ? "cloud-init-preferred" : "ssh" },
    );

    if (existingServers[0]) {
      stages.record("stage1-3-vps-create", "ok", "Reusing existing VPS by rental label", {
        vpsId: existingServers[0].id,
        ip: normalizeIp(existingServers[0].ip) || null,
        status: existingServers[0].status,
      });
    }

    const vpsId = created.id;
    let ip = normalizeIp(created.ip);
    if (!ip) {
      ip = await waitForPublicIp(provider, vpsId, stages);
    }

    stages.record("stage1-5-vps-created", "ok", "VPS created with public IP", { ...attemptMeta, vpsId, ip });
    await waitForSSH(ip, privateKey, stages);

    const config = await deployProtocol(ip, protocol, privateKey, stages, installPlan, Boolean(userData));
    try {
      const probePort = protocol === "hysteria2"
        ? getHysteria2PrimaryPort(String(config.port))
        : Number(config.port || 443);
      await verifyDeliveryConnectivity({
        rentalId,
        attemptId: attempt.attemptId,
        attemptNo: attempt.attemptNo,
        maxAttempts: attempt.maxAttempts,
        ip,
        port: probePort || 443,
        protocol,
      }, stages);
    } catch (error) {
      await runStage(
        stages,
        "stage2.5-4-probe-failed-destroy",
        "Delete VPS after failed delivery connectivity probe",
        async () => provider.deleteServer(vpsId),
        { ...attemptMeta, vpsId, ip },
      );
      throw error;
    }

    stages.record("stage4-1-provision-complete", "ok", "Provision server completed node delivery", {
      ...attemptMeta,
      protocol,
      vpsId,
      ip,
    });

    return {
      rentalId,
      ...(attempt.attemptId ? { attemptId: attempt.attemptId } : {}),
      vpsId,
      ip,
      config,
      debug: { stageLogs: stages.logs },
    };
  } catch (error) {
    if (error instanceof ProvisionStageError) {
      throw error;
    }
    stages.fail("stage0-0-unhandled", "Unhandled provision failure", error);
    throw error;
  }
}

function normalizeIp(value: string | null | undefined) {
  const ip = String(value || "").trim();
  return ip && ip !== "0.0.0.0" ? ip : "";
}

async function waitForPublicIp(provider: CloudProvider, vpsId: string, stages: StageRecorder): Promise<string> {
  stages.record("stage1-4-public-ip-wait", "started", "Waiting for public IP assignment", { vpsId });
  for (let i = 1; i <= 30; i++) {
    try {
      const info = await provider.getServer(vpsId);
      const ip = normalizeIp(info.ip);
      if (ip) {
        stages.record("stage1-4-public-ip-wait", "ok", "Public IP assigned", { vpsId, ip, attempt: i });
        return ip;
      }
      if (i === 1 || i % 6 === 0 || i === 30) {
        stages.record("stage1-4-public-ip-wait", "info", "Public IP not assigned yet", { vpsId, attempt: i });
      }
    } catch (error) {
      if (i === 1 || i % 6 === 0 || i === 30) {
        stages.record("stage1-4-public-ip-wait", "warn", "Failed to poll public IP", {
          vpsId,
          attempt: i,
          detail: error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160),
        });
      }
    }
    await sleep(5000);
  }
  stages.fail("stage1-4-public-ip-wait", "Cloud instance did not receive a public IP", new Error("public IP timeout"), { vpsId });
}

async function waitForSSH(ip: string, privateKey: string, stages: StageRecorder, maxRetries = 60): Promise<void> {
  stages.record("stage2-1-ssh-wait-start", "started", "Waiting for SSH", { ip, maxRetries });
  for (let i = 0; i < maxRetries; i++) {
    try {
      const ssh = new NodeSSH();
      await ssh.connect({
        host: ip,
        username: "root",
        privateKey,
        readyTimeout: 10000,
      });
      const result = await ssh.execCommand("echo ready");
      ssh.dispose();
      if (result.stdout?.includes("ready")) {
        stages.record("stage2-3-ssh-ready", "ok", "SSH is ready", { ip, attempt: i + 1 });
        return;
      }
    } catch (error) {
      if (i === 0 || (i + 1) % 6 === 0 || i + 1 === maxRetries) {
        stages.record("stage2-2-ssh-probe", "info", "SSH probe not ready", {
          ip,
          attempt: i + 1,
          maxRetries,
          detail: error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160),
        });
      }
    }
    await sleep(5000);
  }
  stages.fail("stage2-4-ssh-timeout", "SSH connection timeout after 5 minutes", new Error("SSH connection timeout after 5 minutes"), { ip });
}

async function deployProtocol(
  ip: string,
  protocol: string,
  privateKey: string,
  stages: StageRecorder,
  plan: ProtocolInstallPlan,
  cloudInitPrepared: boolean,
): Promise<Record<string, string>> {
  stages.record("stage3-1-deploy-start", "started", "Starting protocol deployment", {
    ip,
    protocol,
    installMode: cloudInitPrepared ? "cloud-init-preferred" : "ssh",
  });
  const ssh = new NodeSSH();
  try {
    await runStage(stages, "stage3-2-ssh-connect", "Connect to VPS for protocol deployment", async () => {
      await ssh.connect({
        host: ip,
        username: "root",
        privateKey,
      });
    }, { ip, protocol });

    if (cloudInitPrepared) {
      const cloudInitConfig = await readCloudInitConfig(ssh, ip, plan, stages);
      if (cloudInitConfig) {
        return cloudInitConfig;
      }
    }

    return await deployInstallPlanViaSsh(ssh, ip, plan, stages);
  } finally {
    ssh.dispose();
  }
}

async function readCloudInitConfig(
  ssh: NodeSSH,
  ip: string,
  plan: ProtocolInstallPlan,
  stages: StageRecorder,
): Promise<Record<string, string> | null> {
  stages.record("stage3-2-cloud-init-check", "started", "Checking cloud-init install result", {
    ip,
    protocol: plan.protocol,
  });
  let rawExitCode = "";
  for (let attempt = 1; attempt <= 12; attempt++) {
    const exitCodeResult = await ssh.execCommand("test -f /root/anixops-install-exit-code && cat /root/anixops-install-exit-code || true");
    rawExitCode = exitCodeResult.stdout.trim();
    if (rawExitCode) {
      break;
    }
    if (attempt === 1 || attempt === 12 || attempt % 4 === 0) {
      stages.record("stage3-2-cloud-init-check", "info", "Cloud-init install result not ready", {
        ip,
        protocol: plan.protocol,
        attempt,
        maxAttempts: 12,
      });
    }
    await sleep(5000);
  }

  if (!rawExitCode) {
    stages.record("stage3-2-cloud-init-check", "info", "Cloud-init install result not ready; falling back to SSH install", {
      ip,
      protocol: plan.protocol,
    });
    return null;
  }

  const outputResult = await ssh.execCommand("cat /root/anixops-install-output.env 2>/dev/null || true");
  if (Number(rawExitCode) !== 0) {
    stages.record("stage3-2-cloud-init-check", "warn", "Cloud-init install failed; falling back to SSH install", {
      ip,
      protocol: plan.protocol,
      exitCode: Number(rawExitCode),
      detail: (outputResult.stderr || outputResult.stdout || "").slice(0, 160),
    });
    return null;
  }

  const config = buildProtocolConfigFromOutput(ip, plan, outputResult.stdout, stages, "cloud-init");
  await applyCompliancePolicy(ssh, ip, plan, stages);
  stages.record("stage3-5-cloud-init-used", "ok", "Using protocol installed by cloud-init", {
    ip,
    protocol: plan.protocol,
    port: plan.port,
  });
  return config;
}

async function deployInstallPlanViaSsh(
  ssh: NodeSSH,
  ip: string,
  plan: ProtocolInstallPlan,
  stages: StageRecorder,
): Promise<Record<string, string>> {
  const script = plan.script || await runStage(
    stages,
    "stage3-3-script-load",
    "Load install script",
    async () => readFileSync(plan.scriptPath, "utf-8"),
    { protocol: plan.protocol },
  );
  const tmpScript = "/tmp/anixops-install.sh";
  await runStage(stages, "stage3-4-script-upload", "Upload install script", async () => {
    await ssh.execCommand(`cat > ${tmpScript} << 'SCRIPT'\n${script}\nSCRIPT`);
    await ssh.execCommand(`chmod +x ${tmpScript}`);
  }, { protocol: plan.protocol });

  const result = await runStage(stages, "stage3-5-script-run", "Run install script", async () => ssh.execCommand(
    `${tmpScript} ${plan.args.map(shellQuote).join(" ")}`
  ), { protocol: plan.protocol, port: plan.port });

  await ssh.execCommand(`rm -f ${tmpScript}`);

  if (result.code && result.code !== 0) {
    stages.fail("stage3-5-script-run", "Install script exited with non-zero status", new Error(result.stderr || `exit_code=${result.code}`), {
      protocol: plan.protocol,
      exitCode: result.code,
    });
  }

  await applyCompliancePolicy(ssh, ip, plan, stages);
  return buildProtocolConfigFromOutput(ip, plan, result.stdout || "", stages, "ssh");
}

async function applyCompliancePolicy(
  ssh: NodeSSH,
  ip: string,
  plan: ProtocolInstallPlan,
  stages: StageRecorder,
) {
  if (!plan.compliancePolicy || plan.compliancePolicy.mode !== "restricted") {
    stages.record("stage3-6-compliance-policy", "info", "No restricted compliance policy to apply", {
      ip,
      protocol: plan.protocol,
      profileId: plan.compliancePolicy?.profileId || "standard",
    });
    return;
  }

  const result = await runStage(
    stages,
    "stage3-6-compliance-policy",
    "Apply restricted egress compliance policy",
    async () => ssh.execCommand(buildCompliancePolicyCommand(plan.compliancePolicy)),
    {
      ip,
      protocol: plan.protocol,
      profileId: plan.compliancePolicy.profileId || null,
      version: plan.compliancePolicy.version || null,
    },
  );
  if (result.code && result.code !== 0) {
    stages.fail("stage3-6-compliance-policy", "Compliance policy command failed", new Error(result.stderr || `exit_code=${result.code}`), {
      ip,
      protocol: plan.protocol,
      exitCode: result.code,
    });
  }
}

function buildProtocolConfigFromOutput(
  ip: string,
  plan: ProtocolInstallPlan,
  output: string,
  stages: StageRecorder,
  installMode: "cloud-init" | "ssh",
): Record<string, string> {
  if (plan.protocol === "vless-reality") {
    const publicKeyMatch = output.match(/PUBLIC_KEY=(.+)/);
    const publicKey = publicKeyMatch?.[1]?.trim() || "";
    if (!publicKey) {
      stages.fail("stage3-6-config-parse", "Missing VLESS public key in install output", new Error("PUBLIC_KEY not found"), {
        protocol: plan.protocol,
        installMode,
      });
    }

    stages.record("stage3-6-config-parse", "ok", "Protocol config parsed", {
      protocol: plan.protocol,
      port: plan.port,
      installMode,
    });
    return {
      protocol: "vless-reality",
      ip,
      port: String(plan.port),
      uuid: plan.uuid || "",
      shortId: plan.shortId || "",
      serverName: plan.serverName || "addons.mozilla.org",
      publicKey,
    };
  }

  stages.record("stage3-6-config-parse", "ok", "Protocol config parsed", {
    protocol: plan.protocol,
    port: plan.port,
    installMode,
  });
  return {
    protocol: "hysteria2",
    ip,
    port: String(plan.port),
    password: plan.password || "",
    obfs: plan.obfs || "",
    insecure: "true",
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
