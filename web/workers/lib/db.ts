// D1 Database helper for AnixOps Workers
import { D1Database } from "@cloudflare/workers-types";

export class DB {
  constructor(private db: D1Database) {}

  async createRental(data: {
    id: string;
    userId?: string;
    protocol: string;
    durationHours: number;
    pricePerHour: number;
    totalPrice: number;
    paymentMethod: string;
  }) {
    return this.db.prepare(
      `INSERT INTO rentals (id, user_id, protocol, duration_hours, price_per_hour, total_price, payment_method, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+' || ? || ' hours'))`
    ).bind(data.id, data.userId || null, data.protocol, data.durationHours, data.pricePerHour, data.totalPrice, data.paymentMethod, data.durationHours).run();
  }

  async getRental(id: string) {
    return this.db.prepare("SELECT * FROM rentals WHERE id = ?").bind(id).first();
  }

  async updateRentalStatus(id: string, status: string, extra: { ip?: string; vpsId?: string } = {}) {
    const fields = ["status = ?", "updated_at = datetime('now')"];
    const values: (string | number)[] = [status];

    if (extra.ip) { fields.push("ip = ?"); values.push(extra.ip); }
    if (extra.vpsId) { fields.push("vps_id = ?"); values.push(extra.vpsId); }
    if (status === "active") { fields.push("started_at = datetime('now')"); }
    if (status === "paused") { fields.push("paused_at = datetime('now')"); }

    return this.db.prepare(
      `UPDATE rentals SET ${fields.join(", ")} WHERE id = ?`
    ).bind(...values, id).run();
  }

  async getActiveRentalsForUser(userId: string) {
    return this.db.prepare(
      "SELECT * FROM rentals WHERE user_id = ? AND status IN ('active', 'paused') ORDER BY created_at DESC"
    ).bind(userId).all();
  }

  async getExpiredRentals() {
    return this.db.prepare(
      `SELECT * FROM rentals
       WHERE status IN ('active', 'paused')
       AND expires_at <= datetime('now')`
    ).all();
  }

  async getExpiringSoonRentals(minutes: number = 30) {
    return this.db.prepare(
      `SELECT * FROM rentals
       WHERE status = 'active'
       AND expires_at <= datetime('now', '+' || ? || ' minutes')
       AND expires_at > datetime('now')`
    ).bind(minutes).all();
  }

  async createPayment(data: {
    id: string;
    rentalId: string;
    amount: number;
    method: string;
  }) {
    return this.db.prepare(
      "INSERT INTO payments (id, rental_id, amount, method) VALUES (?, ?, ?, ?)"
    ).bind(data.id, data.rentalId, data.amount, data.method).run();
  }

  async addAuditLog(rentalId: string | null, action: string, detail?: string) {
    return this.db.prepare(
      "INSERT INTO audit_log (rental_id, action, detail) VALUES (?, ?, ?)"
    ).bind(rentalId, action, detail || null).run();
  }

  async cleanupDestroyedRentals(hours: number = 24) {
    return this.db.prepare(
      `DELETE FROM rentals WHERE status = 'destroyed' AND updated_at <= datetime('now', '-' || ? || ' hours')`
    ).bind(hours).run();
  }
}
