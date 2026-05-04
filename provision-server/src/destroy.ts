import type { CloudProvider } from "./provider";
import { createVultrProvider } from "./providers/vultr";
import { createDOProvider } from "./providers/digitalocean";
import { createAWSProvider } from "./providers/aws";
import { NodeSSH } from "node-ssh";
import { readFileSync } from "fs";
import { join } from "path";
import { logger } from "./logger";

const CLOUD_PROVIDER = process.env.CLOUD_PROVIDER || "vultr";
const SSH_KEY_PATH = join(__dirname, process.env.NODE_ENV === "production" ? "../.ssh/anixops_ed25519" : "../../.ssh/anixops_ed25519");

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

interface DestroyParams {
  rentalId: string;
  vpsId?: string;
  ip?: string;
}

export async function destroyNode(params: DestroyParams): Promise<void> {
  const { rentalId, vpsId, ip } = params;

  // Resolve VPS ID — prefer passed vpsId, fallback to API lookup
  const resolvedVpsId = vpsId || await lookupVPSIdByTag(rentalId);

  if (!resolvedVpsId) {
    logger.warn(`No VPS found for rental, skipping VPS deletion`, { rentalId });
    // Still attempt SSH cleanup if IP is known
    if (ip) {
      try {
        await runCleanup(ip, rentalId);
      } catch (error) {
        logger.error(`SSH cleanup failed`, { rentalId, error: String(error) });
      }
    }
    return;
  }

  // Run cleanup script on VPS before deletion (needs IP)
  let resolvedIp = ip;
  if (!resolvedIp) {
    try {
      const provider = getProvider();
      const serverInfo = await provider.getServer(resolvedVpsId);
      resolvedIp = serverInfo.ip;
    } catch (error) {
      logger.error(`Failed to resolve VPS IP`, { rentalId, error: String(error) });
    }
  }

  if (resolvedIp) {
    try {
      await runCleanup(resolvedIp, rentalId);
    } catch (error) {
      logger.error(`Cleanup failed`, { rentalId, error: String(error) });
    }
  }

  // Destroy VPS
  logger.info(`Destroying VPS`, { rentalId, vpsId: resolvedVpsId });
  const provider = getProvider();
  await provider.deleteServer(resolvedVpsId);
  logger.info(`VPS destroyed`, { rentalId, vpsId: resolvedVpsId });
}

async function lookupVPSIdByTag(rentalId: string): Promise<string | null> {
  const provider = getProvider();
  const servers = await provider.listServersByTag(rentalId);
  if (servers.length === 0) {
    logger.warn(`No VPS found for rentalId`, { rentalId });
    return null;
  }
  if (servers.length > 1) {
    logger.warn(`Multiple VPS found for rentalId, using first`, { rentalId, count: servers.length });
  }
  return servers[0].id;
}

async function runCleanup(ip: string, rentalId: string): Promise<void> {
  const privateKey = readFileSync(SSH_KEY_PATH, "utf-8").trim();
  const ssh = new NodeSSH();

  logger.info(`Connecting to VPS for cleanup`, { rentalId, ip });
  await ssh.connect({
    host: ip,
    username: "root",
    privateKey,
    readyTimeout: 15000,
  });

  // Upload and run destroy script from local scripts/ directory
  const destroyScriptPath = join(__dirname, process.env.NODE_ENV === "production" ? "../scripts/destroy.sh" : "../../scripts/destroy.sh");
  try {
    const destroyScript = readFileSync(destroyScriptPath, "utf-8");
    await ssh.execCommand(`cat > /tmp/anixops-destroy.sh << 'SCRIPT'\n${destroyScript}\nSCRIPT`);
    await ssh.execCommand("chmod +x /tmp/anixops-destroy.sh");
    await ssh.execCommand("bash /tmp/anixops-destroy.sh");
    await ssh.execCommand("rm -f /tmp/anixops-destroy.sh");
  } catch (error) {
    logger.warn(`Destroy script not found or failed`, { rentalId, error: String(error) });
  }

  ssh.dispose();
  logger.info(`VPS cleanup complete`, { rentalId });
}
