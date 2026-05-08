import { describe, expect, it } from "vitest";
import { buildAdminEmailSet, isAdminEmail, normalizeEmail } from "../src/auth/admin.js";

describe("admin email authorization helpers", () => {
  it("normalizes email addresses before comparison", () => {
    expect(normalizeEmail("  KalijerryUK@gmail.com ")).toBe("kalijerryuk@gmail.com");
    expect(normalizeEmail(null)).toBe("");
  });

  it("parses comma-separated admin email lists", () => {
    const admins = buildAdminEmailSet(" owner@example.com,Admin@Example.com ,, owner@example.com ");

    expect(Array.from(admins)).toEqual(["owner@example.com", "admin@example.com"]);
  });

  it("matches admins case-insensitively and rejects non-admins", () => {
    const admins = buildAdminEmailSet("kalijerryuk@gmail.com,ops@example.com");

    expect(isAdminEmail("KalijerryUK@gmail.com", admins)).toBe(true);
    expect(isAdminEmail("user@example.com", admins)).toBe(false);
    expect(isAdminEmail(null, admins)).toBe(false);
  });
});
