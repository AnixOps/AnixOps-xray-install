import { NodeSSH } from "node-ssh";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { generateKeyPairSync, randomBytes, randomUUID, type KeyObject } from "crypto";
import type { CloudProvider } from "./provider";
import { createVultrProvider } from "./providers/vultr";
import { createDOProvider } from "./providers/digitalocean";
import { createAWSProvider } from "./providers/aws";
import { logger } from "./logger";

const CLOUD_PROVIDER = process.env.CLOUD_PROVIDER || "vultr";
const SSH_KEY_DIR = join(__dirname, process.env.NODE_ENV === "production" ? "../.ssh" : "../../.ssh");
const SSH_KEY_PATH = join(SSH_KEY_DIR, "anixops_ed25519");

function getProvider(): CloudProvider {
  switch (CLOUD_PROVIDER) {
    case "vultr":
      return createVultrProvider(process.env.VULTR_API_KEY!);
    case "digitalocean":
      return createDOProvider(process.env.DIGITALOCEAN_TOKEN!);
    case "aws": {
      const ak = process.env.AWS_ACCESS_KEY_ID;
      const sk = process.env.AWS_SECRET_ACCESS_KEY;
      if (!ak || !sk) throw new Error("AWS provider requires AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY");
      return createAWSProvider(process.env.AWS_REGION || "us-east-1", ak, sk);
    }
    default:
      throw new Error(`Unsupported cloud provider: ${CLOUD_PROVIDER}`);
  }
}

// SSH key pair management — generates SSH wire format (ssh-ed25519 ...) for cloud providers
function getOrCreateSSHKey(): { publicKey: string; privateKey: string } {
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

  const { publicKey: pubKeyObject, privateKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  // Cloud providers require SSH wire format ("ssh-ed25519 AAAA..."), not PEM/SPKI
  const jwk = (pubKeyObject as KeyObject).export({ format: "jwk" }) as { x: string };
  const rawPub = Buffer.from(jwk.x, "base64url");
  const keyTypeBuf = Buffer.from("ssh-ed25519");
  const lenOf = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n, 0); return b; };
  const wire = Buffer.concat([lenOf(keyTypeBuf.length), keyTypeBuf, lenOf(rawPub.length), rawPub]);
  const sshPublicKey = `ssh-ed25519 ${wire.toString("base64")} anixops`;

  writeFileSync(SSH_KEY_PATH, privateKey, { mode: 0o600 });
  writeFileSync(pubPath, sshPublicKey);

  logger.info("Generated new SSH key pair (wire format)");
  return { publicKey: sshPublicKey, privateKey };
}

interface ProvisionResult {
  rentalId: string;
  vpsId: string;
  ip: string;
  config: Record<string, string>;
}

export async function provisionNode(rentalId: string, protocol: "vless-reality" | "hysteria2"): Promise<ProvisionResult> {
  const provider = getProvider();
  const { publicKey, privateKey } = getOrCreateSSHKey();

  // Step 1: Create VPS
  logger.info(`Creating VPS`, { rentalId, provider: CLOUD_PROVIDER });
  let { id: vpsId, ip } = await provider.createServer({
    region: process.env.VPS_REGION || "nrt",
    plan: process.env.VPS_PLAN || "vhf-1c-1gb",
    sshKey: publicKey,
    tag: rentalId,
  });

  // AWS EC2 may not assign public IP immediately — poll for it
  if (!ip && CLOUD_PROVIDER === "aws") {
    logger.info(`Waiting for public IP assignment`, { rentalId });
    for (let i = 0; i < 30; i++) {
      await sleep(5000);
      const info = await provider.getServer(vpsId);
      if (info.ip) {
        ip = info.ip;
        break;
      }
    }
    if (!ip) throw new Error("EC2 instance did not receive a public IP");
  }

  logger.info(`VPS created`, { rentalId, ip, vpsId });

  // Step 2: Wait for SSH
  logger.info(`Waiting for SSH`, { rentalId });
  await waitForSSH(ip, privateKey);
  logger.info(`SSH ready`, { rentalId });

  // Step 3: Deploy protocol
  logger.info(`Deploying protocol`, { rentalId, protocol });
  const config = await deployProtocol(ip, protocol, privateKey);
  logger.info(`Protocol deployed`, { rentalId, protocol });

  return { rentalId, vpsId, ip, config };
}

async function waitForSSH(ip: string, privateKey: string, maxRetries = 60): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const ssh = new NodeSSH();
      await ssh.connect({
        host: ip,
        username: "root",
        privateKey: privateKey,
        readyTimeout: 10000,
      });
      const result = await ssh.execCommand("echo ready");
      ssh.dispose();
      if (result.stdout?.includes("ready")) return;
    } catch {
      // SSH not ready yet
    }
    await sleep(5000);
  }
  throw new Error("SSH connection timeout after 5 minutes");
}

async function deployProtocol(ip: string, protocol: string, privateKey: string): Promise<Record<string, string>> {
  const ssh = new NodeSSH();
  await ssh.connect({
    host: ip,
    username: "root",
    privateKey: privateKey,
  });

  if (protocol === "vless-reality") {
    const uuid = randomUUID();
    const shortId = randomBytes(4).toString("hex");
    const port = 443;

    const scriptPath = process.env.SCRIPT_DIR
      ? `${process.env.SCRIPT_DIR}/${protocol}.sh`
      : join(__dirname, process.env.NODE_ENV === "production" ? `../scripts/${protocol}.sh` : `../../scripts/${protocol}.sh`);
    const script = readFileSync(scriptPath, "utf-8");

    const tmpScript = `/tmp/anixops-install.sh`;
    await ssh.execCommand(`cat > ${tmpScript} << 'SCRIPT'\n${script}\nSCRIPT`);
    await ssh.execCommand(`chmod +x ${tmpScript}`);

    const result = await ssh.execCommand(
      `${tmpScript} --uuid ${uuid} --port ${port} --short-id ${shortId}`
    );

    // Clean up install script
    await ssh.execCommand(`rm -f ${tmpScript}`);

    ssh.dispose();

    // Parse script output — uses stable delimiter (English, not locale-dependent)
    const publicKeyMatch = result.stdout?.match(/PUBLIC_KEY=(.+)/);
    const publicKey = publicKeyMatch?.[1]?.trim() || "";

    return {
      protocol: "vless-reality",
      ip,
      port: String(port),
      uuid,
      shortId,
      serverName: "addons.mozilla.org",
      publicKey,
    };
  }

  if (protocol === "hysteria2") {
    const password = randomUUID().slice(0, 16);
    const obfs = randomUUID().slice(0, 12);
    const port = 443;

    const scriptPath = process.env.SCRIPT_DIR
      ? `${process.env.SCRIPT_DIR}/hysteria2.sh`
      : join(__dirname, "../../scripts/hysteria2.sh");
    const script = readFileSync(scriptPath, "utf-8");

    const tmpScript = `/tmp/anixops-install.sh`;
    await ssh.execCommand(`cat > ${tmpScript} << 'SCRIPT'\n${script}\nSCRIPT`);
    await ssh.execCommand(`chmod +x ${tmpScript}`);

    await ssh.execCommand(
      `${tmpScript} --port ${port} --password ${password} --obfs ${obfs}`
    );

    // Clean up install script
    await ssh.execCommand(`rm -f ${tmpScript}`);

    ssh.dispose();

    return {
      protocol: "hysteria2",
      ip,
      port: String(port),
      password,
      obfs,
      insecure: "true",
    };
  }

  throw new Error(`Unsupported protocol: ${protocol}`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
