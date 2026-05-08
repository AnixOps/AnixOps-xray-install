import type { CloudProvider } from "./provider.js";
import { createVultrProvider } from "./providers/vultr.js";
import { createDOProvider } from "./providers/digitalocean.js";
import { createAWSProvider } from "./providers/aws.js";
import { NodeSSH } from "node-ssh";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger.js";
import { ProvisionStageError, StageRecorder, runStage, type ProvisionStageLog } from "./stage-log.js";

const CLOUD_PROVIDER = process.env.CLOUD_PROVIDER || "vultr";
const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_DIR = CURRENT_DIR.endsWith(`${process.platform === "win32" ? "\\" : "/"}dist`)
  ? join(CURRENT_DIR, "..")
  : join(CURRENT_DIR, "../..");
const SSH_KEY_PATH = join(process.env.SSH_KEY_DIR || join(APP_DIR, ".ssh"), "anixops_rsa");

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
  attemptId?: string;
  reason?: string;
}

interface DestroyResult {
  status: "destroyed" | "not_found";
  debug: {
    stageLogs: ProvisionStageLog[];
  };
}

interface DestroyTarget {
  id: string;
  ip?: string;
}

export async function destroyNode(params: DestroyParams): Promise<DestroyResult> {
  const { rentalId, vpsId, ip, attemptId, reason } = params;
  const stages = new StageRecorder(rentalId, "destroy");
  try {
    stages.record("stage5-1-destroy-start", "started", "Destroy request accepted", {
      attemptId: attemptId || null,
      reason: reason || null,
      hasVpsId: Boolean(vpsId),
      hasIp: Boolean(ip),
    });

    const targets: DestroyTarget[] = vpsId ? [{ id: vpsId, ip }] : await lookupVPSTargetsByTag(rentalId, stages);
    if (targets.length === 0) {
      stages.record("stage5-2-vps-resolve", "warn", "No VPS found for rental, skipping VPS deletion");
      stages.record("stage5-3-cleanup", "warn", "Skipping SSH cleanup because no cloud VPS matched this rental");
      stages.record("stage5-5-destroy-complete", "ok", "Destroy completed without cloud VPS match");
      return { status: "not_found", debug: { stageLogs: stages.logs } };
    }

    const provider = getProvider();
    for (const [index, target] of targets.entries()) {
      stages.record("stage5-2-vps-resolve", "ok", "VPS resolved for destroy", {
        vpsId: target.id,
        index: index + 1,
        total: targets.length,
      });

      const resolvedIp = await resolveCurrentTargetIp(provider, target, stages);

      if (resolvedIp) {
        await cleanupBestEffort(resolvedIp, rentalId, stages);
      } else {
        stages.record("stage5-3-cleanup", "warn", "Skipping SSH cleanup because VPS IP could not be verified", {
          vpsId: target.id,
        });
      }

      await runStage(
        stages,
        "stage5-4-vps-delete",
        "Delete VPS through cloud provider API",
        async () => provider.deleteServer(target.id),
        { vpsId: target.id, index: index + 1, total: targets.length },
      );
    }
    stages.record("stage5-5-destroy-complete", "ok", "VPS destroyed", { count: targets.length });
    return { status: "destroyed", debug: { stageLogs: stages.logs } };
  } catch (error) {
    if (error instanceof ProvisionStageError) {
      throw error;
    }
    stages.fail("stage5-0-destroy-unhandled", "Unhandled destroy failure", error);
    throw error;
  }
}

async function lookupVPSTargetsByTag(rentalId: string, stages: StageRecorder): Promise<DestroyTarget[]> {
  const provider = getProvider();
  const servers = await runStage(
    stages,
    "stage5-2-vps-resolve",
    "Lookup VPS by rental label",
    async () => provider.listServersByTag(rentalId),
  );
  if (servers.length === 0) {
    logger.warn(`No VPS found for rentalId`, { rentalId });
    return [];
  }
  if (servers.length > 1) {
    logger.warn(`Multiple VPS found for rentalId, deleting all`, { rentalId, count: servers.length });
    stages.record("stage5-2-vps-resolve", "warn", "Multiple VPS records matched rental label", { count: servers.length });
  }
  return servers.map((server) => ({ id: server.id, ip: server.ip }));
}

async function resolveCurrentTargetIp(
  provider: CloudProvider,
  target: DestroyTarget,
  stages: StageRecorder,
) {
  stages.record("stage5-3-ip-resolve", "started", "Verify VPS IP before SSH cleanup", {
    vpsId: target.id,
    storedIp: target.ip || null,
  });

  try {
    const serverInfo = await provider.getServer(target.id);
    const currentIp = serverInfo.ip || "";
    stages.record("stage5-3-ip-resolve", "ok", "VPS IP verified before SSH cleanup", {
      vpsId: target.id,
      storedIp: target.ip || null,
      currentIp: currentIp || null,
      storedIpMatched: !target.ip || target.ip === currentIp,
    });
    return currentIp;
  } catch (error) {
    stages.record("stage5-3-ip-resolve", "warn", "Could not verify VPS IP before SSH cleanup", {
      vpsId: target.id,
      storedIp: target.ip || null,
      detail: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
    });
    return "";
  }
}

async function cleanupBestEffort(ip: string, rentalId: string, stages: StageRecorder): Promise<void> {
  try {
    await runCleanup(ip, rentalId, stages);
  } catch (error) {
    stages.record("stage5-3-cleanup", "warn", "SSH cleanup failed; continuing cloud delete", {
      ip,
      detail: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
    });
  }
}

async function runCleanup(ip: string, rentalId: string, stages: StageRecorder): Promise<void> {
  const privateKey = readFileSync(SSH_KEY_PATH, "utf-8").trim();
  const ssh = new NodeSSH();

  await runStage(stages, "stage5-3-cleanup", "Connect to VPS for cleanup", async () => {
    await ssh.connect({
      host: ip,
      username: "root",
      privateKey,
      readyTimeout: 15000,
    });
  }, { ip });

  const destroyScriptPath = process.env.SCRIPT_DIR
    ? join(process.env.SCRIPT_DIR, "destroy.sh")
    : join(APP_DIR, "scripts/destroy.sh");
  try {
    const destroyScript = readFileSync(destroyScriptPath, "utf-8");
    await ssh.execCommand(`cat > /tmp/anixops-destroy.sh << 'SCRIPT'\n${destroyScript}\nSCRIPT`);
    await ssh.execCommand("chmod +x /tmp/anixops-destroy.sh");
    await ssh.execCommand("bash /tmp/anixops-destroy.sh");
    await ssh.execCommand("rm -f /tmp/anixops-destroy.sh");
  } finally {
    ssh.dispose();
  }

  stages.record("stage5-3-cleanup", "ok", "VPS cleanup complete", { ip });
}
