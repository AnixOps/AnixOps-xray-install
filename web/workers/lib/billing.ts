// D1 query result types
interface UserRow { id: string; email: string; balance: number; created_at: string; }
interface RentalRow { id: string; user_id: string; protocol: string; status: string;
  expires_at: string; duration_hours: number; price_per_hour: number; total_price: number; }

// Stripe payment processing for AnixOps rental mode
import { Hono } from "hono";
import Stripe from "stripe";
import { getRentalPrice, isValidRentalDuration, PRICING } from "../../lib/rental/rules";

type Bindings = {
  DB: D1Database;
  CACHE: KVNamespace;
  PROVISION_QUEUE: Queue;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  FRONTEND_URL: string; // Next.js Pages URL for Stripe redirect
};

export const billingRouter = new Hono<{ Bindings: Bindings }>();

let stripe: Stripe | null = null;

function getStripe(key: string): Stripe {
  if (!stripe) {
    stripe = new Stripe(key, { apiVersion: "2025-02-24.acacia" });
  }
  return stripe;
}

// Pricing tiers — single source of truth for all price calculations
// Create Stripe checkout session
billingRouter.post("/api/payment/checkout", async (c) => {
  const { protocol, durationHours, email } = await c.req.json();

  if (!protocol || !durationHours || !email) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  const tier = getRentalPrice(durationHours);
  if (!tier) {
    return c.json({ error: "Invalid duration. Choose 1, 6, 12, or 24 hours." }, 400);
  }

  const existingUser = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<UserRow>();
  if (existingUser) {
    const activeRental = await c.env.DB.prepare(
      "SELECT id FROM rentals WHERE user_id = ? AND status IN ('provisioning', 'active', 'paused') LIMIT 1"
    ).bind(existingUser.id).first<{ id: string }>();
    if (activeRental) {
      return c.json({ error: "Existing rental still active. Destroy or finish it before creating another." }, 409);
    }
  }

  const stripe = getStripe(c.env.STRIPE_SECRET_KEY);

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
          unit_amount: Math.round(tier.totalPrice * 100), // cents
        },
        quantity: 1,
      },
    ],
    success_url: `${c.env.FRONTEND_URL}/rental/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${c.env.FRONTEND_URL}/rental/cancel`,
    metadata: {
      protocol,
      durationHours: String(durationHours),
      email,
    },
  });

  return c.json({ url: session.url, sessionId: session.id });
});

// Stripe webhook - handle payment completion
billingRouter.post("/api/payment/webhook", async (c) => {
  const body = await c.req.text();
  const sig = c.req.header("stripe-signature");

  if (!sig) {
    return c.json({ error: "No signature" }, 400);
  }

  const stripe = getStripe(c.env.STRIPE_SECRET_KEY);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, c.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return c.json({ error: "Invalid signature" }, 400);
  }

  if (event.type === "checkout.session.completed") {
    // Idempotency guard — prevent duplicate processing of same event
    const processed = await c.env.CACHE.get(`stripe:event:${event.id}`);
    if (processed) return c.json({ received: true });

    const session = event.data.object as Stripe.Checkout.Session;
    const sessionType = (session.metadata || {}).type || "new";

    if (sessionType === "renewal") {
      // Handle renewal checkout
      const { rentalId, durationHours } = session.metadata || {};
      if (!rentalId || !durationHours) {
        return c.json({ error: "Missing renewal metadata" }, 400);
      }

      const duration = parseInt(durationHours);
      const tier = getRentalPrice(duration);
      if (!tier) {
        return c.json({ error: "Invalid duration" }, 400);
      }

      const rental = await c.env.DB.prepare(
        "SELECT expires_at FROM rentals WHERE id = ?"
      ).bind(rentalId).first<{ expires_at: string | null }>();

      if (rental?.expires_at && rental.expires_at > new Date().toISOString()) {
        await c.env.DB.prepare(
          `UPDATE rentals SET expires_at = datetime(?, '+' || ? || ' hours'), duration_hours = duration_hours + ?,
           total_price = total_price + ?, updated_at = datetime('now') WHERE id = ?`
        ).bind(rental.expires_at, duration, duration, tier.totalPrice, rentalId).run();
      } else {
        await c.env.DB.prepare(
          `UPDATE rentals SET expires_at = datetime('now', '+' || ? || ' hours'), duration_hours = duration_hours + ?,
           total_price = total_price + ?, updated_at = datetime('now') WHERE id = ?`
        ).bind(duration, duration, tier.totalPrice, rentalId).run();
      }

      // Record payment
      const paymentId = crypto.randomUUID();
      await c.env.DB.prepare(
        `INSERT INTO payments (id, rental_id, user_id, amount, currency, method, stripe_session_id, status, created_at)
         VALUES (?, ?, (SELECT user_id FROM rentals WHERE id = ?), ?, 'usd', 'stripe', ?, 'completed', datetime('now'))`
      ).bind(paymentId, rentalId, rentalId, tier.totalPrice, session.id).run();

      await c.env.DB.prepare(
        "INSERT INTO audit_log (rental_id, action, detail, created_at) VALUES (?, 'rental_renewed', ?, datetime('now'))"
      ).bind(rentalId, `+${duration}h, $${tier.totalPrice}`).run();

      // Cache renewal session for success page
      await c.env.CACHE.put(`stripe:${session.id}`, `renewal:${rentalId}`, { expirationTtl: 3600 });
    } else {
      // Handle new rental checkout
      const { protocol, durationHours, email } = session.metadata || {};
      if (!protocol || !durationHours || !email) {
        return c.json({ error: "Missing metadata" }, 400);
      }

      const rentalId = crypto.randomUUID();

      // Find or create user by email
      const existingUser = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<UserRow>();
      const userId = existingUser ? existingUser.id : crypto.randomUUID();

      if (!existingUser) {
        await c.env.DB.prepare(
          "INSERT INTO users (id, email, balance) VALUES (?, ?, 0)"
        ).bind(userId, email).run();
      }

      // Store rental in D1
      const duration = parseInt(durationHours || "1");
      const tier = getRentalPrice(duration);
      if (!tier) {
        return c.json({ error: "Invalid duration" }, 400);
      }

      await c.env.DB.prepare(
        `INSERT INTO rentals (id, user_id, protocol, status, duration_hours, price_per_hour, total_price, payment_method, payment_status, expires_at)
         VALUES (?, ?, ?, 'provisioning', ?, ?, ?, 'stripe', 'paid', datetime('now', '+' || ? || ' hours'))`
      ).run(rentalId, userId, protocol, duration, tier.pricePerHour, tier.totalPrice, duration);

      // Record payment in payments table
      const paymentId = crypto.randomUUID();
      await c.env.DB.prepare(
        `INSERT INTO payments (id, rental_id, user_id, amount, currency, method, stripe_session_id, status, created_at)
         VALUES (?, ?, ?, ?, 'usd', 'stripe', ?, 'completed', datetime('now'))`
      ).bind(paymentId, rentalId, userId, tier.totalPrice, session.id).run();

      // Push provision task to queue
      await c.env.PROVISION_QUEUE.send({
        rentalId,
        protocol,
        durationHours: duration,
      });

      // Cache the rental ID for the frontend to poll
      await c.env.CACHE.put(`stripe:${session.id}`, rentalId, { expirationTtl: 3600 });
    }

    // Mark event as processed
    await c.env.CACHE.put(`stripe:event:${event.id}`, "done", { expirationTtl: 86400 });
  }

  return c.json({ received: true });
});

// Stripe checkout session for rental renewal
billingRouter.post("/api/payment/renew", async (c) => {
  // Require auth — user can only renew their own rentals
  const auth = c.req.header("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized: missing token" }, 401);
  }
  const token = auth.slice(7);
  const userId = await c.env.CACHE.get(`session:${token}`);
  if (!userId) {
    return c.json({ error: "Unauthorized: invalid or expired token" }, 401);
  }

  const { rentalId, durationHours } = await c.req.json();

  if (!rentalId || !durationHours) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  if (!isValidRentalDuration(durationHours)) {
    return c.json({ error: "Invalid duration" }, 400);
  }

  // Verify rental exists and is owned by the authenticated user
  const rental = await c.env.DB.prepare(
    "SELECT * FROM rentals WHERE id = ? AND user_id = ? AND status IN ('active', 'paused')"
  ).bind(rentalId, userId).first();

  if (!rental) {
    return c.json({ error: "Rental not found or not active" }, 404);
  }

  const tier = PRICING[durationHours];
  if (!tier) {
    return c.json({ error: "Invalid duration" }, 400);
  }

  const stripe = getStripe(c.env.STRIPE_SECRET_KEY);

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `Renew ${(rental as RentalRow).protocol} Node Rental`,
            description: `+${durationHours} hours extension`,
          },
          unit_amount: Math.round(tier.totalPrice * 100),
        },
        quantity: 1,
      },
    ],
    success_url: `${c.env.FRONTEND_URL}/rental/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${c.env.FRONTEND_URL}/rental/cancel`,
    metadata: {
      rentalId,
      type: "renewal",
      durationHours: String(durationHours),
    },
  });

  return c.json({ url: session.url, sessionId: session.id });
});
