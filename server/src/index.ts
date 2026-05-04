import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import Stripe from "stripe";
import { db, rentals, users, payments, redeemCodes, auditLog } from "./db/index.js";
import { eq, and, or, sql, desc } from "drizzle-orm";
import { redis, setCache, deleteCache } from "./lib/redis.js";
import { addProvisionJob, createProvisionWorker } from "./lib/queue.js";
import { randomUUID } from "crypto";
import { z } from "zod";

const VALID_RENTAL_DURATIONS = [1, 6, 12, 24] as const;
const PRICING = {
  1: { pricePerHour: 0.5, totalPrice: 0.5 },
  6: { pricePerHour: 0.5, totalPrice: 3.0 },
  12: { pricePerHour: 0.45, totalPrice: 5.4 },
  24: { pricePerHour: 0.4, totalPrice: 9.6 },
} as const;

function isValidRentalDuration(value: unknown): value is (typeof VALID_RENTAL_DURATIONS)[number] {
  return typeof value === "number" && VALID_RENTAL_DURATIONS.includes(value as (typeof VALID_RENTAL_DURATIONS)[number]);
}

function getRentalPrice(durationHours: number) {
  return isValidRentalDuration(durationHours) ? PRICING[durationHours] : null;
}

// Environment validation
const envSchema = z.object({
  PORT: z.string().default("8787"),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  PROVISION_SERVER_URL: z.string().default("http://localhost:3000"),
  PROVISION_SERVER_TOKEN: z.string().default("dev-token"),
  API_SECRET: z.string().default("dev-secret"),
  FRONTEND_URL: z.string().default("http://localhost:3000"),
  NOTIFICATION_WEBHOOK_URL: z.string().optional(),
});

const env = envSchema.parse(process.env);

// Stripe setup
const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" }) : null;

type Variables = {
  userId: string;
};

// Hono app
const app = new Hono<{ Variables: Variables }>();

// Middleware
app.use("*", cors({ origin: env.FRONTEND_URL.split(",") }));

// Rate limiting middleware
app.use("*", async (c, next) => {
  const path = c.req.path;
  if (path === "/api/payment/webhook" || path === "/health") {
    return next();
  }

  const ip = c.req.header("x-forwarded-for") || "unknown";
  const key = `ratelimit:${ip}:${Math.floor(Date.now() / 60000)}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, 120);
  }
  if (count > 20) {
    return c.json({ error: "Rate limit exceeded" }, 429);
  }
  await next();
});

// Auth middleware
const verifyAuth: MiddlewareHandler<{ Variables: Variables }> = async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized: missing token" }, 401);
  }

  const token = auth.slice(7);
  const userId = await redis.get(`session:${token}`);
  if (!userId) {
    return c.json({ error: "Unauthorized: invalid or expired token" }, 401);
  }

  // Refresh TTL
  await redis.expire(`session:${token}`, 86400 * 30);
  c.set("userId", userId);
  await next();
};

// Validation helpers
function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ============================================================
// Health
// ============================================================
app.get("/health", async (c) => {
  const missing: string[] = [];
  if (!env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!env.REDIS_URL) missing.push("REDIS_URL");
  if (!env.PROVISION_SERVER_URL) missing.push("PROVISION_SERVER_URL");

  if (missing.length > 0) {
    return c.json({ status: "degraded", missing }, 503);
  }
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ============================================================
// Auth
// ============================================================
app.post("/api/auth/register", async (c) => {
  const { email } = await c.req.json();
  if (!email || !validateEmail(email)) {
    return c.json({ error: "Invalid email format" }, 400);
  }

  // Check if user exists
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    const token = randomUUID();
    await redis.setex(`session:${token}`, 86400 * 30, existing[0].id);
    return c.json({ userId: existing[0].id, token, email, exists: true });
  }

  const userId = randomUUID();
  await db.insert(users).values({ id: userId, email, balance: 0 });

  const token = randomUUID();
  await redis.setex(`session:${token}`, 86400 * 30, userId);

  return c.json({ userId, token, email });
});

app.post("/api/auth/login", async (c) => {
  const { email } = await c.req.json();
  if (!email) {
    return c.json({ error: "Invalid email" }, 400);
  }

  const user = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (user.length === 0) {
    return c.json({ error: "User not found" }, 404);
  }

  const token = randomUUID();
  await redis.setex(`session:${token}`, 86400 * 30, user[0].id);

  return c.json({ userId: user[0].id, token });
});

// ============================================================
// Rentals
// ============================================================
app.post("/api/rental", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  const { protocol, durationHours, paymentMethod } = body;

  if (!protocol || !durationHours || paymentMethod !== "stripe") {
    return c.json({ error: "Invalid rental request" }, 400);
  }

  if (!isValidRentalDuration(durationHours)) {
    return c.json({ error: "Invalid duration" }, 400);
  }

  const tier = getRentalPrice(durationHours);
  if (!tier) {
    return c.json({ error: "Invalid duration" }, 400);
  }

  const activeRental = await db.select({ id: rentals.id }).from(rentals)
    .where(and(
      eq(rentals.userId, userId),
      or(eq(rentals.status, "provisioning"), eq(rentals.status, "active"), eq(rentals.status, "paused"))
    ))
    .limit(1);
  if (activeRental.length > 0) {
    return c.json({ error: "Existing rental still active. Destroy or finish it before creating another." }, 409);
  }

  const rentalId = randomUUID();

  // Calculate expiration
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + durationHours);

  await db.insert(rentals).values({
    id: rentalId,
    userId,
    protocol,
    status: "provisioning",
    durationHours,
    pricePerHour: tier.pricePerHour,
    totalPrice: tier.totalPrice,
    paymentMethod,
    paymentStatus: "paid",
    expiresAt,
  });

  // Record payment
  const paymentId = randomUUID();
  await db.insert(payments).values({
    id: paymentId,
    rentalId,
    userId,
    amount: tier.totalPrice,
    currency: "usd",
    method: paymentMethod,
    status: "completed",
  });

  // Audit log
  await db.insert(auditLog).values({
    rentalId,
    action: "rental_created",
    detail: `protocol=${protocol}, duration=${durationHours}h`,
  });

  // Queue provision
  await addProvisionJob({ rentalId, protocol, durationHours });

  return c.json({ rentalId, totalPrice: tier.totalPrice, status: "provisioning" });
});

app.get("/api/rentals", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const userRentals = await db.select().from(rentals).where(eq(rentals.userId, userId)).orderBy(desc(rentals.createdAt));

  const now = new Date();
  const results = userRentals.map((r) => {
    let remainingMinutes = 0;
    if (r.expiresAt && r.status === "active") {
      const remainingMs = r.expiresAt.getTime() - now.getTime();
      remainingMinutes = Math.max(0, Math.floor(remainingMs / 60000));
    }
    return { ...r, remainingMinutes };
  });

  return c.json({ rentals: results });
});

app.get("/api/rental/:id", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const rentalId = c.req.param("id");

  const rental = await db.select().from(rentals).where(and(eq(rentals.id, rentalId), eq(rentals.userId, userId))).limit(1);

  if (rental.length === 0) {
    return c.json({ error: "Rental not found" }, 404);
  }

  const now = new Date();
  const expiresAt = rental[0].expiresAt;
  const remainingMs = expiresAt ? expiresAt.getTime() - now.getTime() : 0;
  const remainingMinutes = Math.max(0, Math.floor(remainingMs / 60000));

  return c.json({ ...rental[0], remainingMinutes, expiresAt: expiresAt?.toISOString() });
});

app.get("/api/rental/:id/config", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const rentalId = c.req.param("id");

  const rental = await db.select().from(rentals).where(and(eq(rentals.id, rentalId), eq(rentals.userId, userId))).limit(1);

  if (rental.length === 0) {
    return c.json({ error: "Rental not found" }, 404);
  }

  if (rental[0].status === "provisioning") {
    return c.json({ error: "Still provisioning" }, 202);
  }

  if (rental[0].status !== "active") {
    return c.json({ error: "Rental not active" }, 403);
  }

  const config = await redis.get(`rental:${rentalId}:config`);
  if (!config) {
    return c.json({ error: "Config not ready yet" }, 202);
  }

  return c.json(JSON.parse(config));
});

app.post("/api/rental/:id/pause", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const rentalId = c.req.param("id");

  const result = await db.update(rentals)
    .set({ status: "paused", pausedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(rentals.id, rentalId), eq(rentals.userId, userId), eq(rentals.status, "active")))
    .returning();

  if (result.length === 0) {
    return c.json({ error: "Cannot pause: rental not active or not found" }, 400);
  }

  await db.insert(auditLog).values({ rentalId, action: "rental_paused" });
  return c.json({ status: "paused" });
});

app.post("/api/rental/:id/resume", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const rentalId = c.req.param("id");

  const result = await db.update(rentals)
    .set({ status: "active", pausedAt: null, updatedAt: new Date() })
    .where(and(eq(rentals.id, rentalId), eq(rentals.userId, userId), eq(rentals.status, "paused")))
    .returning();

  if (result.length === 0) {
    return c.json({ error: "Cannot resume: rental not paused or not found" }, 400);
  }

  await db.insert(auditLog).values({ rentalId, action: "rental_resumed" });
  return c.json({ status: "active" });
});

app.post("/api/rental/:id/destroy", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const rentalId = c.req.param("id");

  const result = await db.update(rentals)
    .set({ status: "destroyed", updatedAt: new Date() })
    .where(and(eq(rentals.id, rentalId), eq(rentals.userId, userId)))
    .returning();

  if (result.length === 0) {
    return c.json({ error: "Rental not found" }, 404);
  }

  const rental = result[0];
  await addProvisionJob({
    rentalId,
    action: "destroy",
    vpsId: rental.vpsId ?? undefined,
    ip: rental.ip ?? undefined,
  });

  await deleteCache(`rental:${rentalId}:config`);
  await db.insert(auditLog).values({ rentalId, action: "rental_destroyed", detail: "user_requested" });

  return c.json({ status: "destroyed" });
});

// ============================================================
// Stripe Payments
// ============================================================
if (stripe) {
  app.post("/api/payment/checkout", async (c) => {
    const { protocol, durationHours, email } = await c.req.json();

    if (!protocol || !durationHours || !email) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    const tier = getRentalPrice(durationHours);
    if (!tier) {
      return c.json({ error: "Invalid duration" }, 400);
    }

    const existingUser = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existingUser.length > 0) {
      const existingProvisioning = await db.select({ id: rentals.id }).from(rentals)
        .where(and(
          eq(rentals.userId, existingUser[0].id),
          or(eq(rentals.status, "provisioning"), eq(rentals.status, "active"), eq(rentals.status, "paused"))
        ))
        .limit(1);
      if (existingProvisioning.length > 0) {
        return c.json({ error: "Existing rental still active. Destroy or finish it before creating another." }, 409);
      }
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `${protocol} Node Rental`,
              description: `${durationHours} hours of exclusive node access`,
            },
            unit_amount: Math.round(tier.totalPrice * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${env.FRONTEND_URL}/rental/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.FRONTEND_URL}/rental/cancel`,
      metadata: { protocol, durationHours: String(durationHours), email },
    });

    return c.json({ url: session.url, sessionId: session.id });
  });

  app.post("/api/payment/webhook", async (c) => {
    const body = await c.req.text();
    const sig = c.req.header("stripe-signature");

    if (!sig || !env.STRIPE_WEBHOOK_SECRET) {
      return c.json({ error: "No signature" }, 400);
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, sig, env.STRIPE_WEBHOOK_SECRET);
    } catch {
      return c.json({ error: "Invalid signature" }, 400);
    }

    if (event.type === "checkout.session.completed") {
      // Check for duplicate
      const processed = await redis.get(`stripe:event:${event.id}`);
      if (processed) return c.json({ received: true });

      const session = event.data.object as Stripe.Checkout.Session;
      const sessionType = session.metadata?.type || "new";

      if (sessionType === "renewal") {
        // Handle renewal
        const { rentalId, durationHours } = session.metadata || {};
        if (!rentalId || !durationHours) {
          return c.json({ error: "Missing renewal metadata" }, 400);
        }

        const duration = parseInt(durationHours);
        const tier = getRentalPrice(duration);
        if (!tier) {
          return c.json({ error: "Invalid duration" }, 400);
        }

        const existingRental = await db.select({ expiresAt: rentals.expiresAt }).from(rentals).where(eq(rentals.id, rentalId)).limit(1);
        const renewBase = existingRental[0]?.expiresAt && existingRental[0].expiresAt > new Date()
          ? existingRental[0].expiresAt
          : new Date();
        const nextExpiresAt = new Date(renewBase);
        nextExpiresAt.setHours(nextExpiresAt.getHours() + duration);

        await db.update(rentals)
          .set({
            expiresAt: nextExpiresAt,
            durationHours: sql`${rentals.durationHours} + ${duration}`,
            totalPrice: sql`${rentals.totalPrice} + ${tier.totalPrice}`,
            updatedAt: new Date(),
          })
          .where(eq(rentals.id, rentalId));

        // Record payment
        const paymentId = randomUUID();
        const rental = await db.select({ userId: rentals.userId }).from(rentals).where(eq(rentals.id, rentalId)).limit(1);
        await db.insert(payments).values({
          id: paymentId,
          rentalId,
          userId: rental[0]?.userId || "unknown",
          amount: tier.totalPrice,
          currency: "usd",
          method: "stripe",
          stripeSessionId: session.id,
          status: "completed",
        });

        await db.insert(auditLog).values({
          rentalId,
          action: "rental_renewed",
          detail: `+${duration}h, $${tier.totalPrice}`,
        });

        await setCache(`stripe:${session.id}`, `renewal:${rentalId}`, 3600);
      } else {
        // Handle new rental
        const { protocol, durationHours, email } = session.metadata || {};
        if (!protocol || !durationHours || !email) {
          return c.json({ error: "Missing metadata" }, 400);
        }

        const rentalId = randomUUID();

        // Find or create user
        const existingUser = await db.select().from(users).where(eq(users.email, email)).limit(1);
        const userId = existingUser.length > 0 ? existingUser[0].id : randomUUID();

        if (existingUser.length === 0) {
          await db.insert(users).values({ id: userId, email, balance: 0 });
        }

        const duration = parseInt(durationHours || "1");
        const tier = getRentalPrice(duration);
        if (!tier) {
          return c.json({ error: "Invalid duration" }, 400);
        }
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + duration);

        await db.insert(rentals).values({
          id: rentalId,
          userId,
          protocol,
          status: "provisioning",
          durationHours: duration,
          pricePerHour: tier.pricePerHour,
          totalPrice: tier.totalPrice,
          paymentMethod: "stripe",
          paymentStatus: "paid",
          expiresAt,
        });

        // Record payment
        const paymentId = randomUUID();
        await db.insert(payments).values({
          id: paymentId,
          rentalId,
          userId,
          amount: tier.totalPrice,
          currency: "usd",
          method: "stripe",
          stripeSessionId: session.id,
          status: "completed",
        });

        // Queue provision
        await addProvisionJob({ rentalId, protocol, durationHours: duration });

        // Cache for success page
        await setCache(`stripe:${session.id}`, rentalId, 3600);
      }

      await redis.setex(`stripe:event:${event.id}`, 86400, "done");
    }

    return c.json({ received: true });
  });

  app.post("/api/payment/renew", verifyAuth, async (c) => {
    const userId = c.get("userId");
    const { rentalId, durationHours } = await c.req.json();

    if (!rentalId || !durationHours) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    if (!isValidRentalDuration(durationHours)) {
      return c.json({ error: "Invalid duration" }, 400);
    }

    const rental = await db.select().from(rentals)
      .where(and(
        eq(rentals.id, rentalId),
        eq(rentals.userId, userId),
        or(eq(rentals.status, "active"), eq(rentals.status, "paused"))
      )).limit(1);

    if (rental.length === 0) {
      return c.json({ error: "Rental not found or not active" }, 404);
    }

    const tier = getRentalPrice(durationHours);
    if (!tier) {
      return c.json({ error: "Invalid duration" }, 400);
    }
    const session = await stripe!.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Renew ${rental[0].protocol} Node Rental`,
              description: `+${durationHours} hours extension`,
            },
            unit_amount: Math.round(tier.totalPrice * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${env.FRONTEND_URL}/rental/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.FRONTEND_URL}/rental/cancel`,
      metadata: { rentalId, type: "renewal", durationHours: String(durationHours) },
    });

    return c.json({ url: session.url, sessionId: session.id });
  });
}

// ============================================================
// Redeem Codes
// ============================================================
app.post("/api/redeem/validate", async (c) => {
  const { code } = await c.req.json();

  if (!code || typeof code !== "string" || code.length < 6 || code.length > 50) {
    return c.json({ error: "Invalid code format" }, 400);
  }

  const codeRecord = await db.select().from(redeemCodes)
    .where(and(
      eq(redeemCodes.code, code),
      sql`${redeemCodes.usedBy} IS NULL`,
      or(sql`${redeemCodes.expiresAt} IS NULL`, sql`${redeemCodes.expiresAt} > NOW()`)
    )).limit(1);

  if (codeRecord.length === 0) {
    return c.json({ error: "Invalid or expired code", valid: false }, 400);
  }

  return c.json({ valid: true, durationHours: codeRecord[0].durationHours });
});

app.post("/api/redeem", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const { code, protocol } = await c.req.json();

  if (!code || typeof code !== "string" || code.length < 6 || code.length > 50) {
    return c.json({ error: "Invalid code format" }, 400);
  }

  if (!protocol || !["vless-reality", "hysteria2"].includes(protocol)) {
    return c.json({ error: "Invalid protocol" }, 400);
  }

  const activeRental = await db.select({ id: rentals.id }).from(rentals)
    .where(and(
      eq(rentals.userId, userId),
      or(eq(rentals.status, "provisioning"), eq(rentals.status, "active"), eq(rentals.status, "paused"))
    ))
    .limit(1);
  if (activeRental.length > 0) {
    return c.json({ error: "Existing rental still active. Destroy or finish it before creating another." }, 409);
  }

  // Check code
  const codeRecord = await db.select().from(redeemCodes)
    .where(and(
      eq(redeemCodes.code, code),
      sql`${redeemCodes.usedBy} IS NULL`,
      or(sql`${redeemCodes.expiresAt} IS NULL`, sql`${redeemCodes.expiresAt} > NOW()`)
    )).limit(1);

  if (codeRecord.length === 0) {
    return c.json({ error: "Invalid, expired, or already used code" }, 400);
  }

  const durationHours = codeRecord[0].durationHours;

  // Atomically claim the code. The usedBy guard prevents concurrent double redemption.
  const claimed = await db.update(redeemCodes)
    .set({ usedBy: userId, usedAt: new Date() })
    .where(and(eq(redeemCodes.id, codeRecord[0].id), sql`${redeemCodes.usedBy} IS NULL`))
    .returning();
  if (claimed.length === 0) {
    return c.json({ error: "Invalid, expired, or already used code" }, 400);
  }

  const rentalId = randomUUID();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + durationHours);

  await db.insert(rentals).values({
    id: rentalId,
    userId,
    protocol,
    status: "provisioning",
    durationHours,
    pricePerHour: 0,
    totalPrice: 0,
    paymentMethod: "redeem_code",
    paymentStatus: "paid",
    expiresAt,
  });

  // Record payment
  const paymentId = randomUUID();
  await db.insert(payments).values({
    id: paymentId,
    rentalId,
    userId,
    amount: 0,
    currency: "usd",
    method: "redeem_code",
    status: "completed",
  });

  await db.insert(auditLog).values({
    rentalId,
    action: "rental_created",
    detail: `protocol=${protocol}, duration=${durationHours}h, method=redeem_code`,
  });

  await addProvisionJob({ rentalId, protocol, durationHours });

  return c.json({ rentalId, durationHours, status: "provisioning" });
});

// ============================================================
// Admin
// ============================================================
app.post("/api/admin/redeem-codes", async (c) => {
  const apiSecret = c.req.header("X-API-Secret");
  if (apiSecret !== env.API_SECRET) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { count, durationHours, expiresAt } = await c.req.json();

  if (!count || count < 1 || count > 100) {
    return c.json({ error: "Count must be between 1 and 100" }, 400);
  }

  const validDurations = [1, 6, 8, 12, 16, 24, 48, 72];
  if (!validDurations.includes(durationHours)) {
    return c.json({ error: "Invalid duration" }, 400);
  }

  const codes: { code: string; durationHours: number }[] = [];

  for (let i = 0; i < count; i++) {
    const codeId = randomUUID();
    const codePart = Array.from({ length: 8 }, () =>
      "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".charAt(Math.floor(Math.random() * 32))
    ).join("");
    const code = `ANIX-${codePart.slice(0, 4)}-${codePart.slice(4, 8)}`;

    await db.insert(redeemCodes).values({
      id: codeId,
      code,
      durationHours,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    });

    codes.push({ code, durationHours });
  }

  return c.json({ codes, count: codes.length });
});

app.get("/api/admin/redeem-codes", async (c) => {
  const apiSecret = c.req.header("X-API-Secret");
  if (apiSecret !== env.API_SECRET) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const codes = await db.select().from(redeemCodes)
    .leftJoin(users, eq(redeemCodes.usedBy, users.id))
    .orderBy(desc(redeemCodes.createdAt));

  return c.json({ codes });
});

// ============================================================
// Session Status (for Stripe success page)
// ============================================================
app.get("/api/rental/session/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");

  const value = await redis.get(`stripe:${sessionId}`);
  if (!value) {
    return c.json({ status: "pending" });
  }

  if (value.startsWith("renewal:")) {
    const rentalId = value.slice(8);
    return c.json({ rentalId, isRenewal: true });
  }

  const rentalId = value;
  const rental = await db.select().from(rentals).where(eq(rentals.id, rentalId)).limit(1);

  if (rental.length === 0) {
    return c.json({ status: "pending" });
  }

  const now = new Date();
  const expiresAt = rental[0].expiresAt;
  const remainingMs = expiresAt ? expiresAt.getTime() - now.getTime() : 0;
  const remainingMinutes = Math.max(0, Math.floor(remainingMs / 60000));

  return c.json({
    rentalId: rental[0].id,
    isRenewal: false,
    remainingMinutes,
    status: rental[0].status,
  });
});

// ============================================================
// Cron Job: Cleanup & Notifications
// ============================================================
async function runCron() {
  const now = new Date();

  // 1. Auto-destroy expired rentals
  const expired = await db.select().from(rentals)
    .where(and(
      or(eq(rentals.status, "active"), eq(rentals.status, "paused")),
      sql`${rentals.expiresAt} <= NOW()`
    ));

  for (const rental of expired) {
    await db.update(rentals).set({ status: "destroyed", updatedAt: new Date() }).where(eq(rentals.id, rental.id));
    await addProvisionJob({ rentalId: rental.id, action: "destroy", vpsId: rental.vpsId ?? undefined, ip: rental.ip ?? undefined });
    await deleteCache(`rental:${rental.id}:config`);
    console.log("Auto-destroyed rental:", rental.id);
  }

  // 2. Send renewal reminders
  if (env.NOTIFICATION_WEBHOOK_URL) {
    const expiringSoon = await db.select({
      r: rentals,
      u: users,
    }).from(rentals)
      .innerJoin(users, eq(rentals.userId, users.id))
      .where(and(
        eq(rentals.status, "active"),
        sql`${rentals.expiresAt} <= NOW() + INTERVAL '30 minutes'`,
        sql`${rentals.expiresAt} > NOW()`
      ));

    for (const { r: rental, u: user } of expiringSoon) {
      const reminded = await redis.get(`rental:${rental.id}:last_reminder`);
      if (reminded) continue;

      const remainingMin = Math.floor((rental.expiresAt!.getTime() - now.getTime()) / 60000);
      const message = `[AnixOps] Rental ${rental.id.slice(0, 8)} expires in ${remainingMin} minutes. User: ${user.email}`;

      // Send notification
      try {
        await fetch(env.NOTIFICATION_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "rental_expiring",
            rentalId: rental.id,
            email: user.email,
            remainingMinutes: remainingMin,
            message,
          }),
        });
        await redis.setex(`rental:${rental.id}:last_reminder`, 600, "sent");
      } catch (e) {
        console.error("Failed to send reminder:", e);
      }
    }
  }

  // 3. Clean up old destroyed rentals
  await db.delete(rentals).where(and(
    eq(rentals.status, "destroyed"),
    sql`${rentals.updatedAt} <= NOW() - INTERVAL '24 hours'`
  ));
}

// Run cron every minute
setInterval(runCron, 60000);

// ============================================================
// Provision Worker
// ============================================================
const provisionWorker = createProvisionWorker(async (job) => {
  const { rentalId, protocol, durationHours, action, vpsId, ip } = job.data;

  if (action === "destroy") {
    console.log("Destroying rental:", rentalId, "vps:", vpsId, "ip:", ip);

    const destroyRes = await fetch(`${env.PROVISION_SERVER_URL}/api/destroy`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.PROVISION_SERVER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ rentalId, vpsId, ip }),
    });

    if (!destroyRes.ok) {
      throw new Error(`Destroy failed: ${destroyRes.status}`);
    }

    await db.update(rentals).set({ status: "destroyed", updatedAt: new Date() }).where(eq(rentals.id, rentalId));
    await deleteCache(`rental:${rentalId}:config`);
    return;
  }

  // Provision
  console.log("Provisioning rental:", rentalId, "protocol:", protocol);

  const provisionResult = await fetch(`${env.PROVISION_SERVER_URL}/api/provision`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.PROVISION_SERVER_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ rentalId, protocol }),
  });

  if (!provisionResult.ok) {
    throw new Error(`Provision failed: ${provisionResult.status}`);
  }

  const data = await provisionResult.json() as { config: Record<string, unknown>; ip: string; vpsId: string };

  // Cache config
  const ttl = ((durationHours ?? 24) + 1) * 3600;
  await setCache(`rental:${rentalId}:config`, data.config, ttl);

  // Update rental
  await db.update(rentals)
    .set({ status: "active", ip: data.ip, vpsId: data.vpsId, updatedAt: new Date() })
    .where(eq(rentals.id, rentalId));

  console.log("Provisioned:", rentalId, "ip:", data.ip);
});

provisionWorker.on("failed", (job, err) => {
  console.error("Job failed:", job?.id, err.message);
});

// ============================================================
// Start Server
// ============================================================
const port = parseInt(env.PORT);
serve({
  fetch: app.fetch,
  port,
});

console.log(`AnixOps Server running on port ${port}`);
