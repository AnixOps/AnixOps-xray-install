import { pgTable, text, integer, real, timestamp, serial, boolean } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").unique(),
  balance: real("balance").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const rentals = pgTable("rentals", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id),
  protocol: text("protocol").notNull(), // 'vless-reality' | 'hysteria2'
  status: text("status").notNull().default("provisioning"), // 'provisioning' | 'active' | 'paused' | 'expired' | 'destroyed'
  ip: text("ip"),
  vpsId: text("vps_id"),
  durationHours: integer("duration_hours").notNull(),
  pricePerHour: real("price_per_hour").notNull(),
  totalPrice: real("total_price").notNull(),
  paymentMethod: text("payment_method"),
  paymentStatus: text("payment_status").default("paid"), // 'pending' | 'paid' | 'refunded'
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const payments = pgTable("payments", {
  id: text("id").primaryKey(),
  rentalId: text("rental_id").references(() => rentals.id),
  userId: text("user_id").references(() => users.id),
  amount: real("amount").notNull(),
  currency: text("currency").default("usd"),
  method: text("method").notNull(), // 'stripe' | 'redeem_code'
  stripeSessionId: text("stripe_session_id"),
  status: text("status").default("completed"), // 'pending' | 'completed' | 'failed' | 'refunded'
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const redeemCodes = pgTable("redeem_codes", {
  id: text("id").primaryKey(),
  code: text("code").unique().notNull(),
  durationHours: integer("duration_hours").notNull(),
  usedBy: text("used_by").references(() => users.id),
  usedAt: timestamp("used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  rentalId: text("rental_id"),
  action: text("action").notNull(),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// Types
export type User = typeof users.$inferSelect;
export type Rental = typeof rentals.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type RedeemCode = typeof redeemCodes.$inferSelect;
