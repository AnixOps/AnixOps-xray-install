import { Hono, Context } from "hono";
import { cors } from "hono/cors";
import { DB } from "./lib/db";
import { billingRouter } from "./lib/billing";
import { getRentalPrice, isValidRentalDuration } from "../lib/rental/rules";

// Cloudflare bindings type
type Bindings = {
  DB: D1Database;
  CACHE: KVNamespace;
  PROVISION_QUEUE: Queue;
  PROVISION_SERVER_URL: string;
  PROVISION_SERVER_TOKEN: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  API_SECRET: string;
  ALLOWED_ORIGINS?: string; // Comma-separated allowed origins for CORS
  NOTIFICATION_WEBHOOK_URL?: string; // Telegram bot webhook or generic webhook
};

// Typed D1 result row for rentals
interface RentalRow {
  id: string;
  user_id: string;
  protocol: string;
  status: string;
  ip: string | null;
  vps_id: string | null;
  duration_hours: number;
  price_per_hour: number;
  total_price: number;
  payment_method: string;
  payment_status: string;
  started_at: string | null;
  expires_at: string | null;
  paused_at: string | null;
  created_at: string;
  updated_at: string;
  remaining_minutes?: number;
}

interface UserRow {
  id: string;
  email: string;
  balance: number;
  created_at: string;
}

interface ExpiringRentalRow {
  id: string;
  user_id: string;
  expires_at: string;
  email: string;
}

// Helper to cast D1 query results to typed rows
function toRows<T>(result: { results: Record<string, unknown>[] | null }): T[] {
  return (result.results || []) as unknown as T[];
}

const app = new Hono<{ Bindings: Bindings }>();

// CORS middleware — reads ALLOWED_ORIGINS from Cloudflare bindings (not process.env)
app.use("*", async (c, next) => {
  const origins = c.env.ALLOWED_ORIGINS?.split(",") || ["http://localhost:30000"];
  const corsHandler = cors({ origin: origins });
  return corsHandler(c, next);
});

// Rate limiting middleware — 20 req/min per IP via KV
async function rateLimit(c: Context<{ Bindings: Bindings }>, next: () => Promise<void>) {
  // Skip for webhooks and health
  const path = new URL(c.req.url).pathname;
  if (path === "/api/payment/webhook" || path === "/health") {
    return next();
  }

  const ip = c.req.header("CF-Connecting-IP") || "unknown";
  const key = `ratelimit:${ip}:${Math.floor(Date.now() / 60000)}`; // per-minute bucket
  const count = await c.env.CACHE.get(key);
  if (count && parseInt(count) >= 20) {
    return c.json({ error: "Rate limit exceeded" }, 429);
  }
  await c.env.CACHE.put(key, String((count ? parseInt(count) + 1 : 1)), { expirationTtl: 120 });
  await next();
}

app.use("*", rateLimit);

// Mount Stripe billing routes (after CORS so webhooks work)
app.route("/", billingRouter);

function validateInput(value: string, maxLength: number): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

type NormalizedProvisionedConfig =
  | {
    protocol: "vless-reality";
    ip: string;
    port: number;
    uuid: string;
    serverName: string;
    publicKey: string;
    shortId: string;
  }
  | {
    protocol: "hysteria2";
    ip: string;
    port: number | string;
    password: string;
    insecure: boolean;
    obfs?: string;
  };

function normalizeProvisionConfigString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeProvisionConfigPortNumber(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65535) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 && String(parsed) === trimmed) {
      return parsed;
    }
  }

  return null;
}

function normalizeProvisionHysteria2PortSpec(value: unknown): number | string | null {
  if (typeof value === "number") {
    return normalizeProvisionConfigPortNumber(value);
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
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
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

function normalizeProvisionConfigBoolean(value: unknown, fallback = true) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }

  return fallback;
}

function normalizeProvisionedConfig(rawConfig: unknown): { ok: true; config: NormalizedProvisionedConfig } | { ok: false; error: string } {
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    return { ok: false, error: "Deployment is not ready yet." };
  }

  const record = rawConfig as Record<string, unknown>;
  const protocol = normalizeProvisionConfigString(record.protocol);
  const ip = normalizeProvisionConfigString(record.ip);

  if (!protocol || !ip) {
    return { ok: false, error: "Deployment is not ready yet." };
  }

  if (protocol === "vless-reality") {
    const port = normalizeProvisionConfigPortNumber(record.port);
    const uuid = normalizeProvisionConfigString(record.uuid);
    const serverName = normalizeProvisionConfigString(record.serverName);
    const publicKey = normalizeProvisionConfigString(record.publicKey);
    const shortId = normalizeProvisionConfigString(record.shortId);

    if (port === null || !uuid || !serverName || !publicKey || !shortId) {
      return { ok: false, error: "Deployment is not ready yet." };
    }

    return {
      ok: true,
      config: {
        protocol,
        ip,
        port,
        uuid,
        serverName,
        publicKey,
        shortId,
      },
    };
  }

  if (protocol === "hysteria2") {
    const port = normalizeProvisionHysteria2PortSpec(record.port);
    const password = normalizeProvisionConfigString(record.password);
    if (!password || port === null) {
      return { ok: false, error: "Deployment is not ready yet." };
    }

    const obfs = normalizeProvisionConfigString(record.obfs) || undefined;
    return {
      ok: true,
      config: {
        protocol,
        ip,
        port,
        password,
        insecure: normalizeProvisionConfigBoolean(record.insecure, true),
        ...(obfs ? { obfs } : {}),
      },
    };
  }

  return { ok: false, error: "Deployment is not ready yet." };
}

// Send renewal reminder via webhook (Telegram bot or generic)
async function sendRenewalReminder(
  webhookUrl: string,
  rentalId: string,
  email: string,
  remainingMinutes: number
): Promise<void> {
  const message = `[AnixOps] Rental ${rentalId.slice(0, 8)} expires in ${remainingMinutes} minutes. User: ${email}`;

  // Telegram Bot API format: https://api.telegram.org/bot<TOKEN>/sendMessage
  if (webhookUrl.includes("api.telegram.org")) {
    const chatId = webhookUrl.split("/").pop();
    const botToken = webhookUrl.match(/bot([^/]+)/)?.[1];
    if (!botToken || !chatId) return;

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
      }),
    });
  } else {
    // Generic webhook POST
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "rental_expiring",
        rentalId,
        email,
        remainingMinutes,
        message,
      }),
    });
  }
}

// ============================================================
// Auth middleware - validates session tokens on rental endpoints
// ============================================================

async function verifyAuth(c: Context<{ Bindings: Bindings }>, next: () => Promise<void>) {
  const auth = c.req.header("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized: missing token" }, 401);
  }

  const token = auth.slice(7);

  // Look up session in KV
  const userId = await c.env.CACHE.get(`session:${token}`);
  if (!userId) {
    return c.json({ error: "Unauthorized: invalid or expired token" }, 401);
  }

  // Refresh session TTL on each request so active users don't expire after 30 days
  await c.env.CACHE.put(`session:${token}`, userId as string, { expirationTtl: 86400 * 30 });

  c.set("userId", userId as string);
  await next();
}

// ============================================================
// User registration / login
// ============================================================

app.post("/api/auth/register", async (c) => {
  const { email } = await c.req.json();
  if (!email || !validateEmail(email)) {
    return c.json({ error: "Invalid email format" }, 400);
  }

  const db = new DB(c.env.DB);

  // Check if user exists — if so, return login-style response
  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<UserRow>();
  if (existing) {
    const token = crypto.randomUUID();
    await c.env.CACHE.put(`session:${token}`, existing.id, { expirationTtl: 86400 * 30 });
    return c.json({ userId: existing.id, token, email, exists: true });
  }

  const userId = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO users (id, email, balance) VALUES (?, ?, 0)"
  ).bind(userId, email).run();

  // Create session token
  const token = crypto.randomUUID();
  await c.env.CACHE.put(`session:${token}`, userId, { expirationTtl: 86400 * 30 }); // 30 days

  return c.json({ userId, token, email });
});

app.post("/api/auth/login", async (c) => {
  const { email } = await c.req.json();
  if (!email || !validateInput(email, 255)) {
    return c.json({ error: "Invalid email" }, 400);
  }

  const user = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<UserRow>();
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  const token = crypto.randomUUID();
  await c.env.CACHE.put(`session:${token}`, user.id, { expirationTtl: 86400 * 30 });

  return c.json({ userId: user.id, token });
});

// ============================================================
// Rental API (requires auth)
// ============================================================

// Create a new rental (with auth)
app.post("/api/rental", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  const { protocol, durationHours, paymentMethod } = body;

  if (!protocol || !durationHours || paymentMethod !== "wallet") {
    return c.json({
      error: "Rental checkout now accepts wallet balance only. Use the wallet topup page for Stripe, wallet, or X402 recharge.",
    }, 400);
  }

  // Input validation
  if (!validateInput(protocol, 50)) {
    return c.json({ error: "Invalid protocol" }, 400);
  }
  if (!validateInput(paymentMethod, 50)) {
    return c.json({ error: "Invalid payment method" }, 400);
  }

  if (!isValidRentalDuration(durationHours)) {
    return c.json({ error: "Invalid duration. Choose 1, 6, 12, or 24 hours." }, 400);
  }

  const rentalId = crypto.randomUUID();
  const tier = getRentalPrice(durationHours);
  if (!tier) {
    return c.json({ error: "Invalid duration" }, 400);
  }

  const activeRental = await c.env.DB.prepare(
    "SELECT id FROM rentals WHERE user_id = ? AND status IN ('provisioning', 'active', 'paused') LIMIT 1"
  ).bind(userId).first<{ id: string }>();
  if (activeRental) {
    return c.json({ error: "Existing rental still active. Destroy or finish it before creating another." }, 409);
  }

  const balanceRow = await c.env.DB.prepare(
    "SELECT balance FROM users WHERE id = ?"
  ).bind(userId).first<{ balance: number }>();
  const available = Number(balanceRow?.balance || 0);
  const minimumBalance = Math.max(0.01, Math.round((tier.pricePerHour / 12) * 100) / 100);
  if (available < minimumBalance) {
    return c.json({
      error: "Insufficient wallet balance",
      code: "WALLET_BALANCE_LOW",
      balance: available,
      required: minimumBalance,
    }, 402);
  }

  // Store rental in D1
  await c.env.DB.prepare(
    `INSERT INTO rentals (id, user_id, protocol, status, duration_hours, price_per_hour, total_price, payment_method, payment_status, created_at, expires_at)
     VALUES (?, ?, ?, 'provisioning', ?, ?, ?, 'wallet', 'paid', datetime('now'), datetime('now', '+' || ? || ' hours'))`
  ).run(rentalId, userId, protocol, durationHours, tier.pricePerHour, tier.totalPrice, durationHours);

  // Record payment
  const paymentId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO payments (id, rental_id, user_id, amount, currency, method, status, created_at)
     VALUES (?, ?, ?, ?, 'usd', 'wallet', 'completed', datetime('now'))`
  ).bind(paymentId, rentalId, userId, tier.totalPrice).run();

  const db = new DB(c.env.DB);
  // Audit log
  await db.addAuditLog(rentalId, "rental_created", `protocol=${protocol}, duration=${durationHours}h, method=wallet`);

  // Push provision task to queue
  await c.env.PROVISION_QUEUE.send({
    rentalId,
    protocol,
    durationHours,
  });

  return c.json({ rentalId, totalPrice: tier.totalPrice, status: "provisioning", billingMode: "wallet_tick" });
});

// Get user's payment history (with auth)
app.get("/api/payments", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const payments = await c.env.DB.prepare(
    "SELECT id, rental_id, amount, currency, method, status, created_at FROM payments WHERE user_id = ? ORDER BY created_at DESC"
  ).bind(userId).all();

  return c.json({ payments: payments.results });
});

// Get user's rentals (with auth - only returns own rentals)
app.get("/api/rentals", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const rentals = await c.env.DB.prepare(
    "SELECT id, protocol, status, ip, duration_hours, price_per_hour, total_price, started_at, expires_at, paused_at, created_at FROM rentals WHERE user_id = ? ORDER BY created_at DESC"
  ).bind(userId).all();

  const now = new Date();
  const results = toRows<RentalRow>(rentals).map((r) => {
    if (r.expires_at && r.status === "active") {
      const expiresAt = new Date(r.expires_at);
      const remainingMs = expiresAt.getTime() - now.getTime();
      r.remaining_minutes = Math.max(0, Math.floor(remainingMs / 60000));
    }
    return r;
  });

  return c.json({ rentals: results });
});

// Get rental status (with auth - only own rentals)
app.get("/api/rental/:id", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const rentalId = c.req.param("id");
  if (!validateInput(rentalId, 100)) {
    return c.json({ error: "Invalid rental ID" }, 400);
  }

  const rental = await c.env.DB.prepare(
    "SELECT * FROM rentals WHERE id = ? AND user_id = ?"
  ).bind(rentalId, userId).first<RentalRow>();

  if (!rental) {
    return c.json({ error: "Rental not found" }, 404);
  }

  const expiresAt = new Date(rental.expires_at);
  const now = new Date();
  const remainingMs = expiresAt.getTime() - now.getTime();
  const remainingMinutes = Math.max(0, Math.floor(remainingMs / 60000));

  return c.json({
    ...rental,
    remainingMinutes,
    expiresAt: expiresAt.toISOString(),
  });
});

// Get rental config (with auth)
app.get("/api/rental/:id/config", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const rentalId = c.req.param("id");

  const rental = await c.env.DB.prepare(
    "SELECT * FROM rentals WHERE id = ? AND user_id = ?"
  ).bind(rentalId, userId).first<RentalRow>();

  if (!rental) {
    return c.json({ error: "Rental not found" }, 404);
  }

  if (rental.status === "provisioning") {
    return c.json({ error: "Still provisioning" }, 202);
  }

  if (rental.status !== "active") {
    return c.json({ error: "Rental not active" }, 403);
  }

  const config = await c.env.CACHE.get(`rental:${rentalId}:config`);
  if (!config) {
    return c.json({ error: "Config not ready yet" }, 202);
  }

  try {
    const parsed = JSON.parse(config);
    const validation = normalizeProvisionedConfig(parsed);
    if (!validation.ok) {
      return c.json({ error: validation.error }, 409);
    }
    return c.json(validation.config);
  } catch {
    return c.json({ error: "Deployment is not ready yet." }, 409);
  }
});

// Pause rental (with auth)
app.post("/api/rental/:id/pause", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const rentalId = c.req.param("id");

  const result = await c.env.DB.prepare(
    "UPDATE rentals SET status = 'paused', paused_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND user_id = ? AND status = 'active'"
  ).bind(rentalId, userId).run();

  if (result.meta.changes === 0) {
    return c.json({ error: "Cannot pause: rental not active or not found" }, 400);
  }

  const db = new DB(c.env.DB);
  await db.addAuditLog(rentalId, "rental_paused");

  return c.json({ status: "paused" });
});

// Resume paused rental (with auth)
app.post("/api/rental/:id/resume", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const rentalId = c.req.param("id");

  const result = await c.env.DB.prepare(
    "UPDATE rentals SET status = 'active', paused_at = NULL, updated_at = datetime('now') WHERE id = ? AND user_id = ? AND status = 'paused'"
  ).bind(rentalId, userId).run();

  if (result.meta.changes === 0) {
    return c.json({ error: "Cannot resume: rental not paused or not found" }, 400);
  }

  const db = new DB(c.env.DB);
  await db.addAuditLog(rentalId, "rental_resumed");

  return c.json({ status: "active" });
});

// Destroy rental (with auth)
app.post("/api/rental/:id/destroy", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const rentalId = c.req.param("id");

  const result = await c.env.DB.prepare(
    "UPDATE rentals SET status = 'destroyed', updated_at = datetime('now') WHERE id = ? AND user_id = ?"
  ).bind(rentalId, userId).run();

  if (result.meta.changes === 0) {
    return c.json({ error: "Rental not found" }, 404);
  }

  // Get VPS details for cleanup
  const rental = await c.env.DB.prepare(
    "SELECT vps_id, ip FROM rentals WHERE id = ?"
  ).bind(rentalId).first<RentalRow>();

  // Send destroy task to queue
  await c.env.PROVISION_QUEUE.send({
    rentalId,
    action: "destroy",
    vpsId: rental?.vps_id || undefined,
    ip: rental?.ip || undefined,
  });

  // Clear config from KV
  await c.env.CACHE.delete(`rental:${rentalId}:config`);

  const db = new DB(c.env.DB);
  await db.addAuditLog(rentalId, "rental_destroyed", "user_requested");

  return c.json({ status: "destroyed" });
});

// ============================================================
// Redeem Code API
// ============================================================

// Validate redeem code (public - check if code exists and is unused)
app.post("/api/redeem/validate", async (c) => {
  const { code } = await c.req.json();

  if (!code || typeof code !== "string" || code.length < 6 || code.length > 50) {
    return c.json({ error: "Invalid code format" }, 400);
  }

  const redeemCode = await c.env.DB.prepare(
    "SELECT * FROM redeem_codes WHERE code = ? AND used_by IS NULL AND (expires_at IS NULL OR expires_at > datetime('now'))"
  ).bind(code).first<{
    id: string;
    code: string;
    duration_hours: number;
    used_by: string | null;
    used_at: string | null;
    expires_at: string | null;
  }>();

  if (!redeemCode) {
    return c.json({ error: "Invalid or expired code", valid: false }, 400);
  }

  return c.json({
    valid: true,
    durationHours: redeemCode.duration_hours,
  });
});

// Redeem code and create rental (with auth)
app.post("/api/redeem", verifyAuth, async (c) => {
  const userId = c.get("userId");
  const { code, protocol } = await c.req.json();

  if (!code || typeof code !== "string" || code.length < 6 || code.length > 50) {
    return c.json({ error: "Invalid code format" }, 400);
  }

  if (!protocol || !["vless-reality", "hysteria2"].includes(protocol)) {
    return c.json({ error: "Invalid protocol" }, 400);
  }

  const activeRental = await c.env.DB.prepare(
    "SELECT id FROM rentals WHERE user_id = ? AND status IN ('provisioning', 'active', 'paused') LIMIT 1"
  ).bind(userId).first<{ id: string }>();
  if (activeRental) {
    return c.json({ error: "Existing rental still active. Destroy or finish it before creating another." }, 409);
  }

  const redeemCode = await c.env.DB.prepare(
    "SELECT * FROM redeem_codes WHERE code = ? AND used_by IS NULL AND (expires_at IS NULL OR expires_at > datetime('now'))"
  ).bind(code).first<{
    id: string;
    code: string;
    duration_hours: number;
    used_by: string | null;
    used_at: string | null;
    expires_at: string | null;
  }>();

  if (!redeemCode) {
    return c.json({ error: "Invalid, expired, or already used code" }, 400);
  }

  const durationHours = redeemCode.duration_hours;

  // Atomically claim the code. The WHERE guard prevents concurrent double redemption.
  const claimResult = await c.env.DB.prepare(
    "UPDATE redeem_codes SET used_by = ?, used_at = datetime('now') WHERE id = ? AND used_by IS NULL"
  ).bind(userId, redeemCode.id).run();
  if (claimResult.meta.changes === 0) {
    return c.json({ error: "Invalid, expired, or already used code" }, 400);
  }

  const rentalId = crypto.randomUUID();

  // Create rental with 0 price (redeemed)
  await c.env.DB.prepare(
    `INSERT INTO rentals (id, user_id, protocol, status, duration_hours, price_per_hour, total_price, payment_method, payment_status, created_at, expires_at)
     VALUES (?, ?, ?, 'provisioning', ?, 0, 0, 'redeem_code', 'paid', datetime('now'), datetime('now', '+' || ? || ' hours'))`
  ).run(rentalId, userId, protocol, durationHours, durationHours);

  // Record payment
  const paymentId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO payments (id, rental_id, user_id, amount, currency, method, status, created_at)
     VALUES (?, ?, ?, 0, 'usd', 'redeem_code', 'completed', datetime('now'))`
  ).bind(paymentId, rentalId, userId).run();

  const db = new DB(c.env.DB);
  await db.addAuditLog(rentalId, "rental_created", `protocol=${protocol}, duration=${durationHours}h, method=redeem_code`);

  // Push provision task to queue
  await c.env.PROVISION_QUEUE.send({
    rentalId,
    protocol,
    durationHours,
  });

  return c.json({ rentalId, durationHours, status: "provisioning" });
});

// Admin: Generate redeem codes (requires API_SECRET header)
app.post("/api/admin/redeem-codes", async (c) => {
  const apiSecret = c.req.header("X-API-Secret");
  if (apiSecret !== c.env.API_SECRET) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { count, durationHours, expiresAt } = await c.req.json();

  if (!count || count < 1 || count > 100) {
    return c.json({ error: "Count must be between 1 and 100" }, 400);
  }

  if (!durationHours || ![1, 6, 12, 24, 8, 16, 48, 72].includes(durationHours)) {
    return c.json({ error: "Invalid duration" }, 400);
  }

  const codes: { code: string; durationHours: number }[] = [];

  for (let i = 0; i < count; i++) {
    const codeId = crypto.randomUUID();
    // Generate readable code: ANIX-XXXX-XXXX (uppercase, alphanumeric)
    const codePart = Array.from({ length: 8 }, () =>
      "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".charAt(Math.floor(Math.random() * 32))
    ).join("");
    const code = `ANIX-${codePart.slice(0, 4)}-${codePart.slice(4, 8)}`;

    await c.env.DB.prepare(
      `INSERT INTO redeem_codes (id, code, duration_hours, expires_at) VALUES (?, ?, ?, ?)`
    ).bind(
      codeId,
      code,
      durationHours,
      expiresAt ? new Date(expiresAt).toISOString() : null
    ).run();

    codes.push({ code, durationHours });
  }

  return c.json({ codes, count: codes.length });
});

// Admin: List redeem codes (requires API_SECRET header)
app.get("/api/admin/redeem-codes", async (c) => {
  const apiSecret = c.req.header("X-API-Secret");
  if (apiSecret !== c.env.API_SECRET) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const codes = await c.env.DB.prepare(
    `SELECT c.*, u.email as used_by_email
     FROM redeem_codes c
     LEFT JOIN users u ON c.used_by = u.id
     ORDER BY c.created_at DESC`
  ).all<{
    id: string;
    code: string;
    duration_hours: number;
    used_by: string | null;
    used_by_email: string | null;
    used_at: string | null;
    expires_at: string | null;
    created_at: string;
  }>();

  return c.json({ codes: codes.results || [] });
});

// Get rental session status by Stripe session ID (public — used by success page)
app.get("/api/rental/session/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  if (!validateInput(sessionId, 100)) {
    return c.json({ error: "Invalid session ID" }, 400);
  }

  const value = await c.env.CACHE.get(`stripe:${sessionId}`);
  if (!value) {
    return c.json({ status: "pending" });
  }

  // Check if it's a renewal
  if (value.startsWith("renewal:")) {
    const rentalId = value.split(":")[1];
    return c.json({ rentalId, isRenewal: true });
  }

  // New rental — fetch details
  const rental = await c.env.DB.prepare(
    "SELECT id, status, duration_hours, started_at, expires_at FROM rentals WHERE id = ?"
  ).bind(value).first<RentalRow>();

  if (!rental) {
    return c.json({ status: "pending" });
  }

  const remainingMs = new Date(rental.expires_at).getTime() - Date.now();
  const remainingMinutes = Math.max(0, Math.floor(remainingMs / 60000));

  return c.json({
    rentalId: rental.id,
    isRenewal: false,
    remainingMinutes,
    status: rental.status,
  });
});

// ============================================================
// Health check
// ============================================================

app.get("/health", async (c) => {
  const missing: string[] = [];
  if (!c.env.DB) missing.push("DB");
  if (!c.env.CACHE) missing.push("CACHE");
  if (!c.env.PROVISION_QUEUE) missing.push("PROVISION_QUEUE");
  if (!c.env.PROVISION_SERVER_URL) missing.push("PROVISION_SERVER_URL");
  if (!c.env.PROVISION_SERVER_TOKEN) missing.push("PROVISION_SERVER_TOKEN");
  if (!c.env.STRIPE_SECRET_KEY) missing.push("STRIPE_SECRET_KEY");
  if (!c.env.STRIPE_WEBHOOK_SECRET) missing.push("STRIPE_WEBHOOK_SECRET");

  if (missing.length > 0) {
    return c.json({
      status: "degraded",
      missing,
      timestamp: new Date().toISOString(),
    }, 503);
  }

  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ============================================================
// Provision Queue Consumer
// ============================================================

export default {
  fetch: app.fetch,

  // Cron trigger — runs every minute for billing/expiration checks
  async scheduled(controller: ScheduledController, env: Bindings, ctx: ExecutionContext): Promise<void> {
    const cronLog = (msg: string, meta?: Record<string, unknown>) => {
      const ts = new Date().toISOString();
      const entry = { level: "info", ts, msg, src: "cron", ...meta };
      console.log(JSON.stringify(entry));
    };

    cronLog("Checking for expired rentals...");

    // 1. Auto-destroy expired rentals
    const expired = await env.DB.prepare(
      `SELECT id, vps_id, ip FROM rentals WHERE status IN ('active', 'paused') AND expires_at <= datetime('now')`
    ).all<RentalRow>();

    if (expired.results && expired.results.length > 0) {
      for (const rental of expired.results) {
        await env.DB.prepare(
          "UPDATE rentals SET status = 'destroyed', updated_at = datetime('now') WHERE id = ?"
        ).bind(rental.id).run();

        await env.PROVISION_QUEUE.send({
          rentalId: rental.id,
          action: "destroy",
          vpsId: rental.vps_id || undefined,
          ip: rental.ip || undefined,
        });
        await env.CACHE.delete(`rental:${rental.id}:config`);
        cronLog("Auto-destroyed rental", { rentalId: rental.id });
      }
    }

    // 2. Renewal reminders (< 30 min remaining)
    const expiringSoon = await env.DB.prepare(
      `SELECT r.id, r.user_id, r.expires_at, u.email FROM rentals r
       JOIN users u ON r.user_id = u.id
       WHERE r.status = 'active' AND r.expires_at <= datetime('now', '+30 minutes') AND r.expires_at > datetime('now')`
    ).all<ExpiringRentalRow>();

    if (expiringSoon.results && env.NOTIFICATION_WEBHOOK_URL) {
      for (const rental of expiringSoon.results) {
        const lastReminder = await env.CACHE.get(`rental:${rental.id}:last_reminder`);
        if (lastReminder) continue;
        const expiresAt = new Date(rental.expires_at);
        const remainingMs = expiresAt.getTime() - Date.now();
        const remainingMin = Math.max(1, Math.floor(remainingMs / 60000));
        await env.CACHE.put(`rental:${rental.id}:last_reminder`, "sent", { expirationTtl: 600 });
        await sendRenewalReminder(env.NOTIFICATION_WEBHOOK_URL, rental.id, rental.email, remainingMin);
        cronLog("Renewal reminder sent", { rentalId: rental.id, remainingMin });
      }
    }

    // 3. Clean up destroyed rentals > 24h old
    await env.DB.prepare(
      `DELETE FROM rentals WHERE status = 'destroyed' AND updated_at <= datetime('now', '-24 hours')`
    ).run();

    cronLog("Cron check complete");
  },

  async queue(batch: MessageBatch<{ rentalId: string; protocol?: string; durationHours?: number; action?: string; vpsId?: string; ip?: string }>, env: Bindings): Promise<void> {
    for (const message of batch.messages) {
      const { rentalId, protocol, durationHours, action, vpsId, ip } = message.body;
      const maxRetries = 10;

      if (action === "destroy") {
        if (message.attempts >= maxRetries) {
          await env.DB.prepare(
            "UPDATE rentals SET status = 'destroyed', updated_at = datetime('now') WHERE id = ?"
          ).bind(rentalId).run();
          message.ack();
          continue;
        }

        const destroyRes = await fetch(`${env.PROVISION_SERVER_URL}/api/destroy`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.PROVISION_SERVER_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ rentalId, vpsId, ip }),
        });

        if (!destroyRes.ok) {
          message.retry();
          continue;
        }

        await env.DB.prepare(
          "UPDATE rentals SET status = 'destroyed', updated_at = datetime('now') WHERE id = ?"
        ).bind(rentalId).run();

        await env.CACHE.delete(`rental:${rentalId}:config`);

        message.ack();
        continue;
      }

      // Provision: call provision server
      if (message.attempts >= maxRetries) {
        await env.DB.prepare(
          "UPDATE rentals SET status = 'failed', updated_at = datetime('now') WHERE id = ?"
        ).bind(rentalId).run();
        message.ack();
        continue;
      }

      const provisionResult = await fetch(`${env.PROVISION_SERVER_URL}/api/provision`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.PROVISION_SERVER_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ rentalId, protocol }),
      });

      if (!provisionResult.ok) {
        message.retry();
        continue;
      }

      let data: { config: Record<string, unknown>; ip: string; vpsId: string };
      try {
        data = await provisionResult.json();
      } catch {
        message.retry();
        continue;
      }

      const configValidation = normalizeProvisionedConfig(data.config);
      if (!configValidation.ok) {
        await env.DB.prepare(
          "UPDATE rentals SET status = 'failed', updated_at = datetime('now') WHERE id = ?"
        ).bind(rentalId).run();
        await env.CACHE.delete(`rental:${rentalId}:config`);

        if (env.PROVISION_SERVER_TOKEN) {
          try {
            await fetch(`${env.PROVISION_SERVER_URL}/api/destroy`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${env.PROVISION_SERVER_TOKEN}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                rentalId,
                vpsId: data.vpsId,
                ip: data.ip,
                reason: "provision_result_incomplete",
              }),
            });
          } catch {
            // Best-effort cleanup only.
          }
        }

        message.ack();
        continue;
      }

      await env.CACHE.put(`rental:${rentalId}:config`, JSON.stringify(configValidation.config), {
        expirationTtl: (durationHours ?? 24) * 3600 + 3600,
      });

      await env.DB.prepare(
        "UPDATE rentals SET status = 'active', ip = ?, vps_id = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(data.ip, data.vpsId, rentalId).run();

      message.ack();
    }
  },
};
