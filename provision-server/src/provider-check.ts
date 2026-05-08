import type { CloudProvider } from "./provider.js";
import { createVultrProvider } from "./providers/vultr.js";
import { createDOProvider } from "./providers/digitalocean.js";
import { createAWSProvider } from "./providers/aws.js";
import { StageRecorder, type ProvisionStageLog } from "./stage-log.js";

export type ProviderCheckRequest = {
  provider?: unknown;
  region?: unknown;
  plan?: unknown;
};

export type ProviderCheckTarget = {
  provider: string;
  region: string;
  plan: string;
};

export function normalizeProviderCheckRequest(
  input: ProviderCheckRequest = {},
  source: NodeJS.ProcessEnv = process.env,
): ProviderCheckTarget {
  const provider = typeof input.provider === "string" && input.provider.trim()
    ? input.provider.trim().toLowerCase()
    : (source.CLOUD_PROVIDER || "vultr").trim().toLowerCase();
  const region = typeof input.region === "string" && input.region.trim()
    ? input.region.trim()
    : provider === "aws"
      ? (source.AWS_REGION || source.VPS_REGION || "us-east-1")
      : (source.VPS_REGION || "nrt");
  const plan = typeof input.plan === "string" && input.plan.trim()
    ? input.plan.trim()
    : (source.VPS_PLAN || "vhf-1c-1gb");

  return { provider, region, plan };
}

function getDigitaloceanToken() {
  return process.env.DIGITALOCEAN_TOKEN || process.env.DO_API_TOKEN || "";
}

function getProvider(target: ProviderCheckTarget): CloudProvider {
  switch (target.provider) {
    case "vultr":
      return createVultrProvider(process.env.VULTR_API_KEY!);
    case "digitalocean":
      return createDOProvider(getDigitaloceanToken());
    case "aws": {
      const ak = process.env.AWS_ACCESS_KEY_ID;
      const sk = process.env.AWS_SECRET_ACCESS_KEY;
      if (!ak || !sk) throw new Error("AWS provider requires AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY");
      return createAWSProvider(target.region || process.env.AWS_REGION || process.env.VPS_REGION || "us-east-1", ak, sk);
    }
    default:
      throw new Error(`Unsupported cloud provider: ${target.provider}`);
  }
}

export async function checkProviderAccess(input: ProviderCheckRequest = {}): Promise<{
  provider: string;
  region: string;
  plan: string;
  ok: boolean;
  stageLogs: ProvisionStageLog[];
}> {
  const target = normalizeProviderCheckRequest(input);
  const stages = new StageRecorder("provider-check", "provision");
  stages.record("stage1-0-provider-check-start", "started", "Checking cloud provider API access", {
    provider: target.provider,
    region: target.region,
    plan: target.plan,
  });

  try {
    const provider = getProvider(target);
    await provider.listServersByTag("__anixops_provider_check__");
    stages.record("stage1-0-provider-check", "ok", "Cloud provider API access is allowed", {
      provider: target.provider,
      region: target.region,
      plan: target.plan,
    });
    return { ...target, ok: true, stageLogs: stages.logs };
  } catch (error) {
    stages.record("stage1-0-provider-check", "failed", "Cloud provider API access failed", {
      provider: target.provider,
      region: target.region,
      plan: target.plan,
      detail: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
    });
    return { ...target, ok: false, stageLogs: stages.logs };
  }
}
