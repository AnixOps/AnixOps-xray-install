import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { provisionNode } from "./provision";
import { destroyNode } from "./destroy";

// Startup validation - fail fast if required env vars are missing
const provider = process.env.CLOUD_PROVIDER || "vultr";
const requiredKeys = ["SERVER_TOKEN"];
if (provider === "vultr") requiredKeys.push("VULTR_API_KEY");
if (provider === "digitalocean") requiredKeys.push("DIGITALOCEAN_TOKEN");
if (provider === "aws") requiredKeys.push("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SECURITY_GROUP_ID");

for (const key of requiredKeys) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const server = Fastify({ logger: true });

// Rate limiting: 10 requests per minute per IP
await server.register(rateLimit, {
  max: 10,
  timeWindow: "1 minute",
  ban: 5, // ban after 5 violations
  keyGenerator: (req) => req.ip,
});
const TOKEN = process.env.SERVER_TOKEN;
if (!TOKEN) {
  throw new Error("SERVER_TOKEN environment variable is required");
}
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from "fastify";

// Auth middleware
const authenticate: preHandlerHookHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  const auth = request.headers.authorization;
  if (auth !== `Bearer ${TOKEN}`) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
};

// Provision endpoint (called by Cloudflare Worker queue consumer)
server.post("/api/provision", { preHandler: authenticate }, async (request, reply) => {
  const { rentalId, protocol } = request.body as { rentalId: string; protocol: string };

  if (!rentalId || !protocol) {
    return reply.code(400).send({ error: "Missing rentalId or protocol" });
  }

  const validProtocols = ["vless-reality", "hysteria2"];
  if (!validProtocols.includes(protocol)) {
    return reply.code(400).send({ error: "Invalid protocol" });
  }

  try {
    const result = await provisionNode(rentalId, protocol as "vless-reality" | "hysteria2");
    return reply.send(result);
  } catch (error: unknown) {
    server.log.error(error);
    return reply.code(500).send({ error: "Internal server error" });
  }
});

// Destroy endpoint
server.post("/api/destroy", { preHandler: authenticate }, async (request, reply) => {
  const { rentalId, vpsId, ip } = request.body as { rentalId: string; vpsId?: string; ip?: string };

  if (!rentalId) {
    return reply.code(400).send({ error: "Missing rentalId" });
  }

  try {
    await destroyNode({ rentalId, vpsId, ip });
    return reply.send({ status: "destroyed" });
  } catch (error: unknown) {
    server.log.error(error);
    return reply.code(500).send({ error: "Internal server error" });
  }
});

// Health check
server.get("/health", async () => {
  const missing: string[] = [];
  if (!process.env.SERVER_TOKEN) missing.push("SERVER_TOKEN");
  if (provider === "vultr" && !process.env.VULTR_API_KEY) missing.push("VULTR_API_KEY");
  if (provider === "digitalocean" && !process.env.DIGITALOCEAN_TOKEN) missing.push("DIGITALOCEAN_TOKEN");
  if (provider === "aws" && (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY)) missing.push("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY");

  if (missing.length > 0) {
    return { status: "degraded", missing, timestamp: new Date().toISOString() };
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
