import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from "fastify";
import { provisionNode } from "./provision.js";
import { destroyNode } from "./destroy.js";
import { ProvisionStageError, getErrorMessage } from "./stage-log.js";
import { checkProviderAccess } from "./provider-check.js";
import { collectComplianceStats } from "./compliance-stats.js";

const PROVIDER_REQUIRED_KEYS: Record<string, string[]> = {
  vultr: ["VULTR_API_KEY"],
  digitalocean: ["DIGITALOCEAN_TOKEN"],
  aws: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SECURITY_GROUP_ID"],
};

function getDigitaloceanToken(source: NodeJS.ProcessEnv = process.env) {
  return source.DIGITALOCEAN_TOKEN || source.DO_API_TOKEN || "";
}

function isPlaceholderEnvValue(value: string | undefined): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  return (
    normalized === "" ||
    normalized.startsWith("change-me") ||
    normalized.startsWith("your-") ||
    normalized.endsWith("_")
  );
}

function getRuntimeConfigIssues() {
  const provider = (process.env.CLOUD_PROVIDER || "vultr").toLowerCase();
  const providerKeys = PROVIDER_REQUIRED_KEYS[provider];
  const issues: string[] = [];

  if (!providerKeys) {
    issues.push(`Unsupported CLOUD_PROVIDER: ${provider}`);
  }

  for (const key of ["SERVER_TOKEN", ...(providerKeys || [])]) {
    const value = key === "DIGITALOCEAN_TOKEN"
      ? getDigitaloceanToken(process.env)
      : process.env[key];
    if (isPlaceholderEnvValue(value)) {
      issues.push(`Missing or placeholder environment variable: ${key}`);
    }
  }

  return { provider, issues };
}

// Startup validation - fail fast if required env vars are missing or placeholders.
const runtimeConfig = getRuntimeConfigIssues();
if (runtimeConfig.issues.length > 0) {
  throw new Error(runtimeConfig.issues.join("; "));
}

const server = Fastify({ logger: true });

// Token-protected internal service. Keep a high guardrail without banning Docker health checks or BullMQ retries.
await server.register(rateLimit, {
  max: 300,
  timeWindow: "1 minute",
  keyGenerator: (req) => req.ip,
});
const TOKEN = process.env.SERVER_TOKEN;
if (!TOKEN) {
  throw new Error("SERVER_TOKEN environment variable is required");
}
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

function buildStageErrorResponse(error: unknown) {
  if (error instanceof ProvisionStageError) {
    return {
      error: "Provision stage failed",
      stage: error.stage,
      detail: error.message,
      stageLogs: error.logs,
    };
  }

  return {
    error: "Provision request failed",
    stage: "unknown",
    detail: getErrorMessage(error),
    stageLogs: [],
  };
}

function isFormalRelease(source: NodeJS.ProcessEnv = process.env) {
  const normalized = String(source.NEXT_PUBLIC_RELEASE_PROFILE || "").trim().toLowerCase();
  return ["formal", "production", "prod", "release"].includes(normalized);
}

function isProtocolAllowedForRelease(protocol: string | null | undefined, formalRelease = isFormalRelease()) {
  if (protocol !== "vless-reality" && protocol !== "hysteria2") {
    return false;
  }

  return !formalRelease || protocol === "vless-reality";
}

// Auth middleware
const authenticate: preHandlerHookHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  const auth = request.headers.authorization;
  if (auth !== `Bearer ${TOKEN}`) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
};

// Provision endpoint (called by Cloudflare Worker queue consumer)
server.post("/api/provision", { preHandler: authenticate }, async (request, reply) => {
  const { rentalId, protocol, attemptId, attemptNo, maxAttempts, provider, region, plan, compliancePolicy } = request.body as {
    rentalId: string;
    protocol: string;
    attemptId?: string;
    attemptNo?: number;
    maxAttempts?: number;
    provider?: string;
    region?: string;
    plan?: string;
    compliancePolicy?: {
      profileId?: string;
      version?: string;
      mode?: "standard" | "restricted";
      allowedPorts?: number[];
      allowedCidrs?: string[];
      blockedProtocols?: string[];
    };
  };

  if (!rentalId || !protocol) {
    return reply.code(400).send({ error: "Missing rentalId or protocol" });
  }

  if (!isProtocolAllowedForRelease(protocol)) {
    return reply.code(400).send({ error: "Invalid protocol" });
  }

  try {
    const result = await provisionNode(rentalId, protocol as "vless-reality" | "hysteria2", {
      attemptId,
      attemptNo: Number.isFinite(Number(attemptNo)) ? Number(attemptNo) : undefined,
      maxAttempts: Number.isFinite(Number(maxAttempts)) ? Number(maxAttempts) : undefined,
      provider: typeof provider === "string" && provider.trim() ? provider.trim() : undefined,
      region: typeof region === "string" && region.trim() ? region.trim() : undefined,
      plan: typeof plan === "string" && plan.trim() ? plan.trim() : undefined,
      compliancePolicy,
    });
    return reply.send(result);
  } catch (error: unknown) {
    server.log.error(error);
    return reply.code(500).send(buildStageErrorResponse(error));
  }
});

// Destroy endpoint
server.post("/api/destroy", { preHandler: authenticate }, async (request, reply) => {
  const { rentalId, vpsId, ip, attemptId, reason } = request.body as {
    rentalId: string;
    vpsId?: string;
    ip?: string;
    attemptId?: string;
    reason?: string;
  };

  if (!rentalId) {
    return reply.code(400).send({ error: "Missing rentalId" });
  }

  try {
    const result = await destroyNode({ rentalId, vpsId, ip, attemptId, reason });
    return reply.send(result);
  } catch (error: unknown) {
    server.log.error(error);
    return reply.code(500).send(buildStageErrorResponse(error));
  }
});

server.post("/api/provider-check", { preHandler: authenticate }, async (request, reply) => {
  const result = await checkProviderAccess(request.body as { provider?: unknown; region?: unknown; plan?: unknown } | undefined);
  return reply.code(result.ok ? 200 : 502).send(result);
});

server.post("/api/compliance-stats", { preHandler: authenticate }, async (request, reply) => {
  const { rentalId, ip } = request.body as {
    rentalId?: string;
    ip?: string;
  };

  if (!rentalId || !ip) {
    return reply.code(400).send({ error: "Missing rentalId or ip" });
  }

  try {
    const stats = await collectComplianceStats(ip);
    return reply.send({
      rentalId,
      ip,
      ...stats,
    });
  } catch (error: unknown) {
    server.log.error(error);
    return reply.code(500).send({
      error: "Compliance stats collection failed",
      detail: getErrorMessage(error),
    });
  }
});

// Health check
server.get("/health", async () => {
  const config = getRuntimeConfigIssues();

  if (config.issues.length > 0) {
    return {
      status: "degraded",
      provider: config.provider,
      issues: config.issues,
      timestamp: new Date().toISOString(),
    };
  }

  return { status: "ok", timestamp: new Date().toISOString() };
});

// Only start listening when not in test mode (tests use server.inject)
if (process.env.NODE_ENV !== "test") {
  server.listen({ port: PORT, host: process.env.HOST || "0.0.0.0" }, (err) => {
    if (err) {
      server.log.error(err);
      process.exit(1);
    }
    server.log.info(`Provision server running on port ${PORT}`);
  });
}

export { server };
export { getRuntimeConfigIssues, isPlaceholderEnvValue };
