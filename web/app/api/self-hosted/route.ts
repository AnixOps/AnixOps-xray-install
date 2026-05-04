import { NextResponse } from "next/server";
import { NodeSSH } from "node-ssh";
import { deployments, cleanupDeployments, type DeploymentLogEntry } from "@/lib/deploy/self-hosted-state";
import { generateKeyPairSync, randomUUID, randomBytes, type KeyObject } from "crypto";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";

// Structured logger for self-hosted deploy API
function deployLog(level: "info" | "warn" | "error", deployId: string, message: string) {
  const ts = new Date().toISOString();
  const prefix = level === "error" ? "ERROR" : level === "warn" ? "WARN" : "INFO";
  const entry: DeploymentLogEntry = { ts, level, message };
  const current = deployments.get(deployId);
  if (current) {
    deployments.set(deployId, {
      ...current,
      logs: [...(current.logs || []), entry].slice(-200),
    });
  }
  if (level === "error") {
    process.stderr.write(`[${prefix}] ${ts} [${deployId}] ${message}\n`);
  } else {
    process.stdout.write(`[${prefix}] ${ts} [${deployId}] ${message}\n`);
  }
}

// Initialize cleanup on first load
cleanupDeployments();

// Self-hosted deployment API
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { deployMethod, protocol, domain, dnsToken } = body;

    if (!deployMethod || !protocol) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Validate based on deploy method
    if (deployMethod === "api") {
      const { provider, apiKey, region, plan } = body;
      if (!provider || !apiKey || !region || !plan) {
        return NextResponse.json(
          { error: "API mode requires provider, apiKey, region, and plan" },
          { status: 400 }
        );
      }
    } else if (deployMethod === "ssh") {
      const { serverIp, sshPassword } = body;
      if (!serverIp || !sshPassword) {
        return NextResponse.json(
          { error: "SSH mode requires serverIp and sshPassword" },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json(
        { error: "Invalid deploy method. Use 'api' or 'ssh'" },
        { status: 400 }
      );
    }

    const deployId = randomUUID();

    // Initialize status tracking
    deployments.set(deployId, {
      status: "running",
      progress: 0,
      createdAt: Date.now(),
      logs: [],
    });

    // Start deployment asynchronously
    deployAsync(deployId, body);

    return NextResponse.json({
      deployId,
      status: "started",
      message: "Deployment started. Poll /api/self-hosted/[id] for progress.",
    });
  } catch (error) {
    deployLog("error", "unknown", `Deploy API error: ${error instanceof Error ? error.message : String(error)}`);
    const message = error instanceof Error ? error.message : "Deployment failed";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

// List all active deployments (requires auth token)
export async function GET(request: Request) {
  const authHeader = request.headers.get("Authorization");
  const expectedToken = process.env.SELF_HOSTED_API_TOKEN;
  if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ids = Array.from(deployments.entries()).map(([id, deploy]) => ({
    id,
    status: deploy.status,
    progress: deploy.progress,
  }));

  return NextResponse.json({ deployments: ids });
}

// Async deployment function with progress tracking
async function deployAsync(
  deployId: string,
  config: Record<string, unknown>,
) {
  const { deployMethod, protocol, domain, dnsToken } = config as {
    deployMethod: "api" | "ssh";
    protocol: string;
    domain?: string;
    dnsToken?: string;
  };

  try {
    let ip: string;

    if (deployMethod === "ssh") {
      // SSH direct connect mode
      const { serverIp, sshPort, sshPassword } = config as {
        serverIp: string;
        sshPort: number;
        sshPassword: string;
      };
      ip = serverIp;

      // Step 1: Verify SSH connection (0-40%)
      deployLog("info", deployId, `Verifying SSH connection to ${ip}:${sshPort}...`);
      deployments.set(deployId, { ...deployments.get(deployId)!, status: "running", progress: 10 });

      await waitForSSHWithPassword(ip, sshPort, sshPassword);
      deployLog("info", deployId, "SSH connection verified");
      deployments.set(deployId, { ...deployments.get(deployId)!, progress: 40 });

      // Step 2: Deploy protocol (40-90%)
      deployLog("info", deployId, `Deploying ${protocol}...`);
      deployments.set(deployId, { ...deployments.get(deployId)!, progress: 50 });
      const result = await deployProtocolWithPassword(ip, sshPort, sshPassword, protocol, domain);
      deployLog("info", deployId, "Protocol deployed");
      deployments.set(deployId, { ...deployments.get(deployId)!, progress: 90 });

      // Step 3: DNS if provided
      if (domain && dnsToken) {
        deployLog("info", deployId, `Creating DNS record for ${domain}...`);
        await createCloudflareDNSRecord(dnsToken as string, domain, ip);
        deployLog("info", deployId, "DNS record created");
      }

      // Complete
      deployments.set(deployId, {
        ...deployments.get(deployId)!,
        status: "success",
        progress: 100,
        config: result,
      });
      deployLog("info", deployId, "Deployment complete!");
      return;
    }

    // API mode: create VPS via cloud provider
    const { provider, apiKey, region, plan } = config as {
      provider: string;
      apiKey: string;
      region: string;
      plan: string;
    };

    // Step 1: Create VPS via cloud provider API (0-30%)
    deployLog("info", deployId, `Creating VPS on ${provider}...`);
    deployments.set(deployId, { ...deployments.get(deployId)!, status: "running", progress: 10 });

    const { vpsId, ip: createdIp } = await createVPS(provider, apiKey, region, plan);
    ip = createdIp;
    deployLog("info", deployId, `VPS created: ${ip}`);
    deployments.set(deployId, { ...deployments.get(deployId)!, progress: 30 });

    // Step 1.5: Create Cloudflare DNS record if domain + dnsToken provided
    if (domain && dnsToken) {
      deployLog("info", deployId, `Creating DNS record for ${domain}...`);
      await createCloudflareDNSRecord(dnsToken as string, domain, ip);
      deployLog("info", deployId, "DNS record created");
      deployments.set(deployId, { ...deployments.get(deployId)!, progress: 40 });
    }

    // Step 2: Wait for SSH (30-50%)
    deployLog("info", deployId, "Waiting for SSH...");
    deployments.set(deployId, { ...deployments.get(deployId)!, progress: 40 });
    await waitForSSH(ip);
    deployLog("info", deployId, "SSH ready");
    deployments.set(deployId, { ...deployments.get(deployId)!, progress: 50 });

    // Step 3: Deploy protocol (50-90%)
    deployLog("info", deployId, `Deploying ${protocol}...`);
    deployments.set(deployId, { ...deployments.get(deployId)!, progress: 60 });
    const result = await deployProtocol(ip, protocol, domain as string | undefined);
    deployLog("info", deployId, "Protocol deployed");
    deployments.set(deployId, { ...deployments.get(deployId)!, progress: 90 });

    // Step 4: Complete (90-100%)
    deployments.set(deployId, {
      ...deployments.get(deployId)!,
      status: "success",
      progress: 100,
      config: result,
    });

    deployLog("info", deployId, "Deployment complete!");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    deployLog("error", deployId, `Deployment failed: ${message}`);
    deployments.set(deployId, {
      ...deployments.get(deployId)!,
      status: "failed",
      error: message,
    });
  }
}

async function createVPS(
  provider: string,
  apiKey: string,
  region: string,
  plan: string
): Promise<{ vpsId: string; ip: string }> {
  if (provider === "vultr") {
    // Generate or retrieve SSH key
    const { publicKey } = getOrCreateSSHKey();

    // Register SSH key with Vultr if not already registered
    const sshKeyId = await registerSSHKeyWithVultr(apiKey, publicKey);

    const res = await fetch("https://api.vultr.com/v2/instances", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        region,
        plan,
        os_id: 1743, // Ubuntu 22.04
        label: `anixops-selfhosted-${Date.now()}`,
        sshkey_id: sshKeyId,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Vultr API error: ${res.status} - ${errText}`);
    }

    const data = await res.json();
    return {
      vpsId: data.instance.id,
      ip: data.instance.main_ip,
    };
  }

  if (provider === "digitalocean") {
    // Generate or retrieve SSH key
    const { publicKey } = getOrCreateSSHKey();

    // Register SSH key with DigitalOcean if not already registered
    const sshKeyFingerprint = await registerSSHKeyWithDO(apiKey, publicKey);

    const res = await fetch("https://api.digitalocean.com/v2/droplets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `anixops-selfhosted-${Date.now()}`,
        region,
        size: plan,
        image: "ubuntu-22-04-x64",
        monitoring: true,
        ssh_keys: sshKeyFingerprint ? [sshKeyFingerprint] : [],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`DigitalOcean API error: ${res.status} - ${errText}`);
    }

    const data = await res.json();
    const droplet = data.droplet;
    const dropletId = String(droplet.id);

    // DO may not return IP immediately — poll until available
    const ip = droplet.network?.v4?.find((n: { type: string; ip_address: string }) => n.type === "public")?.ip_address
      || await pollForDOIP(apiKey, dropletId);

    return {
      vpsId: dropletId,
      ip,
    };
  }

  if (provider === "aws") {
    const [accessKeyId, secretAccessKey] = apiKey.split(":");
    if (!accessKeyId || !secretAccessKey) {
      throw new Error("AWS requires credentials in format: AccessKeyId:SecretAccessKey");
    }

    const sgId = process.env.AWS_SECURITY_GROUP_ID;
    if (!sgId) {
      throw new Error("AWS_SECURITY_GROUP_ID environment variable is required for AWS EC2 deployment");
    }

    const { EC2 } = await import("@aws-sdk/client-ec2");
    const { runInstances, describeInstances, importKeyPair } = new EC2({ region, credentials: { accessKeyId, secretAccessKey } });

    const AMI_MAP: Record<string, string> = {
      "us-east-1": "ami-0c55b159cbfafe1f0",
      "us-west-1": "ami-0d593311dbbfabb4e",
      "us-west-2": "ami-074b57563995d43e3",
      "eu-west-1": "ami-0a8dc5268061354a9",
      "ap-northeast-1": "ami-0b8e3a8f5c8b5c8b5",
      "ap-southeast-1": "ami-0a3b4a4e0e3b4a4e0",
      "eu-central-1": "ami-0c8dc5268061354a9",
    };
    const amiId = AMI_MAP[region] || AMI_MAP["us-east-1"];

    // Import SSH key pair to AWS (named uniquely)
    const { publicKey } = getOrCreateSSHKey();
    const keyPairName = `anixops-selfhosted-${Date.now()}`;

    try {
      await importKeyPair({
        KeyName: keyPairName,
        PublicKeyMaterial: Buffer.from(publicKey as string),
      });
    } catch {
      // Key may already exist — try to proceed with a new name
      const altName = `anixops-selfhosted-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await importKeyPair({
        KeyName: altName,
        PublicKeyMaterial: Buffer.from(publicKey as string),
      });
      // Continue with altName
    }

    const runResult = await runInstances({
      ImageId: amiId,
      InstanceType: plan as Parameters<typeof runInstances>[0]["InstanceType"],
      MinCount: 1,
      MaxCount: 1,
      TagSpecifications: [
        {
          ResourceType: "instance",
          Tags: [
            { Key: "Name", Value: `anixops-selfhosted-${Date.now()}` },
            { Key: "ManagedBy", Value: "AnixOps" },
          ],
        },
      ],
      KeyName: keyPairName,
      SecurityGroupIds: [sgId],
    });

    const instance = runResult.Instances?.[0];
    if (!instance?.InstanceId) {
      throw new Error("Failed to create EC2 instance");
    }

    // Poll for public IP
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const describeResult = await describeInstances({ InstanceIds: [instance.InstanceId] });
      const inst = describeResult.Reservations?.[0]?.Instances?.[0];
      if (inst?.PublicIpAddress) {
        return { vpsId: inst.InstanceId!, ip: inst.PublicIpAddress };
      }
    }
    throw new Error("EC2 instance did not receive a public IP after 5 minutes");
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

// SSH key management
const SSH_KEY_DIR = join(process.cwd(), ".ssh");
const SSH_KEY_PATH = join(SSH_KEY_DIR, "anixops_ed25519");

function getOrCreateSSHKey(): { publicKey: string; privateKey: string } {
  if (!existsSync(SSH_KEY_DIR)) {
    mkdirSync(SSH_KEY_DIR, { recursive: true, mode: 0o700 });
  }

  const pubPath = `${SSH_KEY_PATH}.pub`;
  if (existsSync(SSH_KEY_PATH) && existsSync(pubPath)) {
    return {
      publicKey: readFileSync(pubPath, "utf-8").trim(),
      privateKey: readFileSync(SSH_KEY_PATH, "utf-8"),
    };
  }

  const { publicKey: pubKeyObject, privateKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const privateKeyPem = privateKey as unknown as string;

  // Cloud providers require SSH wire format ("ssh-ed25519 AAAA..."), not PEM
  const jwk = (pubKeyObject as KeyObject).export({ format: "jwk" }) as { x: string };
  const rawPub = Buffer.from(jwk.x, "base64url");
  const keyTypeBuf = Buffer.from("ssh-ed25519");
  const lenOf = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n, 0); return b; };
  const wire = Buffer.concat([lenOf(keyTypeBuf.length), keyTypeBuf, lenOf(rawPub.length), rawPub]);
  const sshPublicKey = `ssh-ed25519 ${wire.toString("base64")} anixops`;

  writeFileSync(SSH_KEY_PATH, privateKeyPem, { mode: 0o600 });
  writeFileSync(pubPath, sshPublicKey);

  return { publicKey: sshPublicKey, privateKey: privateKeyPem };
}

async function registerSSHKeyWithVultr(apiKey: string, publicKey: string): Promise<string> {
  // Check if key already exists
  const listRes = await fetch("https://api.vultr.com/v2/ssh-keys", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (listRes.ok) {
    const data = await listRes.json();
    const existing = data.ssh_keys?.find((key: { name: string; id?: string; fingerprint?: string }) => key.name === "anixops-selfhosted");
    if (existing) {
      return existing.id;
    }
  }

  // Register new SSH key
  const res = await fetch("https://api.vultr.com/v2/ssh-keys", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "anixops-selfhosted",
      ssh_key: publicKey,
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to register SSH key with Vultr: ${res.status}`);
  }

  const data = await res.json();
  return data.ssh_key.id;
}

async function registerSSHKeyWithDO(apiKey: string, publicKey: string): Promise<string | null> {
  // Compute fingerprint from public key for DO
  const { createHash } = await import("crypto");
  const fingerprint = createHash("md5").update(publicKey).digest("hex").replace(/(.{2})(?!$)/g, "$1:");

  // Check if key already exists
  const listRes = await fetch("https://api.digitalocean.com/v2/account/keys", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (listRes.ok) {
    const data = await listRes.json();
    const existing = data.ssh_keys?.find((key: { name: string; id?: string; fingerprint?: string }) => key.name === "anixops-selfhosted");
    if (existing) {
      return existing.fingerprint;
    }
  }

  // Register new SSH key
  const res = await fetch("https://api.digitalocean.com/v2/account/keys", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "anixops-selfhosted",
      public_key: publicKey,
    }),
  });

  if (!res.ok) {
    deployLog("warn", "self-hosted", "Failed to register SSH key with DigitalOcean, proceeding without key");
    return null;
  }

  const data = await res.json();
  return data.ssh_key.fingerprint;
}

async function pollForDOIP(apiKey: string, dropletId: string, maxRetries = 30): Promise<string> {
  for (let i = 0; i < maxRetries; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(`https://api.digitalocean.com/v2/droplets/${dropletId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      const data = await res.json();
      const ip = data.droplet.network?.v4?.find(
        (n: { type: string; ip_address: string }) => n.type === "public"
      )?.ip_address;
      if (ip) return ip;
    }
  }
  throw new Error("DigitalOcean failed to assign IP after 2.5 minutes");
}

async function waitForSSH(ip: string, maxRetries = 60): Promise<void> {
  const { privateKey } = getOrCreateSSHKey();
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
      if (result.stdout?.includes("ready")) return;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("SSH connection timeout after 5 minutes");
}

async function waitForSSHWithPassword(ip: string, port: number, password: string, maxRetries = 60): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const ssh = new NodeSSH();
      await ssh.connect({
        host: ip,
        port,
        username: "root",
        password,
        readyTimeout: 10000,
      });
      const result = await ssh.execCommand("echo ready");
      ssh.dispose();
      if (result.stdout?.includes("ready")) return;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("SSH connection timeout after 3 minutes");
}

async function deployProtocol(
  ip: string,
  protocol: string,
  domain?: string
): Promise<Record<string, string>> {
  const { privateKey } = getOrCreateSSHKey();
  const ssh = new NodeSSH();
  await ssh.connect({ host: ip, username: "root", privateKey });

  if (protocol === "vless-reality") {
    const uuid = randomUUID();
    const shortId = randomBytes(4).toString("hex");
    const port = 443;
    const serverName = "addons.mozilla.org";

    const scriptPath = process.cwd() + "/scripts/vless-reality.sh";
    const { readFileSync } = await import("fs");
    const script = readFileSync(scriptPath, "utf-8");

    const tmpScript = `/tmp/anixops-install.sh`;
    await ssh.execCommand(`cat > ${tmpScript} << 'SCRIPT'\n${script}\nSCRIPT`);
    await ssh.execCommand(`chmod +x ${tmpScript}`);

    const result = await ssh.execCommand(
      `${tmpScript} --uuid ${uuid} --port ${port} --short-id ${shortId}`
    );

    await ssh.execCommand(`rm -f ${tmpScript}`);
    ssh.dispose();

    // Parse script output — stable KEY=VALUE lines, locale-independent
    const publicKeyMatch = result.stdout?.match(/PUBLIC_KEY=(.+)/);

    return {
      protocol: "vless-reality",
      ip,
      port: String(port),
      uuid,
      shortId,
      serverName,
      publicKey: publicKeyMatch?.[1]?.trim() || "",
    };
  }

  if (protocol === "hysteria2") {
    const password = randomUUID().slice(0, 16);
    const obfs = randomUUID().slice(0, 12);
    const port = 443;

    const scriptPath = process.cwd() + "/scripts/hysteria2.sh";
    const { readFileSync } = await import("fs");
    const script = readFileSync(scriptPath, "utf-8");

    const tmpScript = `/tmp/anixops-install.sh`;
    await ssh.execCommand(`cat > ${tmpScript} << 'SCRIPT'\n${script}\nSCRIPT`);
    await ssh.execCommand(`chmod +x ${tmpScript}`);

    await ssh.execCommand(
      `${tmpScript} --port ${port} --password ${password} --obfs ${obfs}${domain ? ` --domain ${domain} --email auto@anixops.com` : ""}`
    );

    await ssh.execCommand(`rm -f ${tmpScript}`);
    ssh.dispose();

    return {
      protocol: "hysteria2",
      ip,
      port: String(port),
      password,
      obfs,
      insecure: domain ? "false" : "true",
      ...(domain && { domain }),
    };
  }

  throw new Error(`Unsupported protocol: ${protocol}`);
}

// Deploy protocol using password-based SSH (for direct SSH connect mode)
async function deployProtocolWithPassword(
  ip: string,
  port: number,
  sshPassword: string,
  protocol: string,
  domain?: string
): Promise<Record<string, string>> {
  const ssh = new NodeSSH();
  await ssh.connect({ host: ip, port, username: "root", password: sshPassword });

  if (protocol === "vless-reality") {
    const uuid = randomUUID();
    const shortId = randomBytes(4).toString("hex");
    const vlessPort = 443;
    const serverName = "addons.mozilla.org";

    const scriptPath = process.cwd() + "/scripts/vless-reality.sh";
    const { readFileSync } = await import("fs");
    const script = readFileSync(scriptPath, "utf-8");

    const tmpScript = `/tmp/anixops-install.sh`;
    await ssh.execCommand(`cat > ${tmpScript} << 'SCRIPT'\n${script}\nSCRIPT`);
    await ssh.execCommand(`chmod +x ${tmpScript}`);

    const result = await ssh.execCommand(
      `${tmpScript} --uuid ${uuid} --port ${vlessPort} --short-id ${shortId}`
    );

    await ssh.execCommand(`rm -f ${tmpScript}`);
    ssh.dispose();

    // Parse script output — stable KEY=VALUE lines
    const publicKeyMatch = result.stdout?.match(/PUBLIC_KEY=(.+)/);

    return {
      protocol: "vless-reality",
      ip,
      port: String(vlessPort),
      uuid,
      shortId,
      serverName,
      publicKey: publicKeyMatch?.[1]?.trim() || "",
    };
  }

  if (protocol === "hysteria2") {
    const password = randomUUID().slice(0, 16);
    const obfs = randomUUID().slice(0, 12);
    const hyPort = 443;

    const scriptPath = process.cwd() + "/scripts/hysteria2.sh";
    const { readFileSync } = await import("fs");
    const script = readFileSync(scriptPath, "utf-8");

    const tmpScript = `/tmp/anixops-install.sh`;
    await ssh.execCommand(`cat > ${tmpScript} << 'SCRIPT'\n${script}\nSCRIPT`);
    await ssh.execCommand(`chmod +x ${tmpScript}`);

    await ssh.execCommand(
      `${tmpScript} --port ${hyPort} --password ${password} --obfs ${obfs}${domain ? ` --domain ${domain} --email auto@anixops.com` : ""}`
    );

    await ssh.execCommand(`rm -f ${tmpScript}`);
    ssh.dispose();

    return {
      protocol: "hysteria2",
      ip,
      port: String(hyPort),
      password,
      obfs,
      insecure: domain ? "false" : "true",
      ...(domain && { domain }),
    };
  }

  throw new Error(`Unsupported protocol: ${protocol}`);
}

// Cloudflare DNS record creation
async function createCloudflareDNSRecord(
  dnsToken: string,
  domain: string,
  ip: string,
): Promise<void> {
  const baseUrl = "https://api.cloudflare.com/client/v4";

  // Extract the zone (base domain) from the full domain
  // e.g., "sub.example.com" → zone = "example.com", name = "sub.example.com"
  const parts = domain.split(".");
  if (parts.length < 2) throw new Error(`Invalid domain: ${domain}`);

  // Try progressively shorter domains to find the zone
  let zoneId: string | null = null;
  let zoneName: string | null = null;
  for (let i = 1; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join(".");
    const res = await fetch(`${baseUrl}/zones?name=${candidate}&status=active`, {
      headers: { Authorization: `Bearer ${dnsToken}` },
    });
    if (!res.ok) continue;
    const data = await res.json();
    if (data.result?.length > 0) {
      zoneId = data.result[0].id;
      zoneName = candidate;
      break;
    }
  }

  if (!zoneId) throw new Error(`No active Cloudflare zone found for domain: ${domain}`);

  const recordName = zoneName === domain ? domain : domain.replace(`.${zoneName}`, "");

  // Check for existing A record with same name
  const listRes = await fetch(
    `${baseUrl}/zones/${zoneId}/dns_records?type=A&name=${domain}&per_page=1`,
    { headers: { Authorization: `Bearer ${dnsToken}` } },
  );

  if (listRes.ok) {
    const data = await listRes.json();
    if (data.result?.length > 0) {
      // Update existing record
      const existingId = data.result[0].id;
      const updateRes = await fetch(`${baseUrl}/zones/${zoneId}/dns_records/${existingId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${dnsToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type: "A", name: recordName, content: ip, proxied: false }),
      });
      if (!updateRes.ok) {
        const errData = await updateRes.json();
        throw new Error(`Failed to update DNS record: ${JSON.stringify(errData)}`);
      }
      return;
    }
  }

  // Create new A record
  const createRes = await fetch(`${baseUrl}/zones/${zoneId}/dns_records`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${dnsToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "A", name: recordName, content: ip, proxied: false }),
  });

  if (!createRes.ok) {
    const errData = await createRes.json();
    throw new Error(`Failed to create DNS record: ${JSON.stringify(errData)}`);
  }
}
