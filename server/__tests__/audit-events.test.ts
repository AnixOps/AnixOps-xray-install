import { beforeAll, describe, expect, it } from "vitest";

let buildMerkleRoot: typeof import("../src/audit-events.js").buildMerkleRoot;
let canonicalJson: typeof import("../src/audit-events.js").canonicalJson;
let computeAuditEventHash: typeof import("../src/audit-events.js").computeAuditEventHash;
let formatAuditAnchorReceipt: typeof import("../src/audit-events.js").formatAuditAnchorReceipt;

beforeAll(async () => {
  process.env.DATABASE_URL ||= "postgresql://anixops:test@localhost:5432/anixops";
  process.env.REDIS_URL ||= "redis://localhost:6379";
  ({
    buildMerkleRoot,
    canonicalJson,
    computeAuditEventHash,
    formatAuditAnchorReceipt,
  } = await import("../src/audit-events.js"));
});

describe("audit event helpers", () => {
  it("canonicalizes object payloads before hashing", () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}');
  });

  it("computes deterministic event hashes", () => {
    const input = {
      id: "event-1",
      traceId: "trace-1",
      actorType: "user",
      actorUserId: "user-1",
      rentalId: "rental-1",
      eventType: "rental_created",
      eventVersion: 1,
      payload: canonicalJson({ amount: 1 }),
      previousHash: "GENESIS",
      createdAt: "2026-05-07T00:00:00.000Z",
    };
    expect(computeAuditEventHash(input)).toBe(computeAuditEventHash(input));
    expect(computeAuditEventHash(input)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("builds merkle roots from event hashes", () => {
    const root = buildMerkleRoot(["a".repeat(64), "b".repeat(64), "c".repeat(64)]);
    expect(root).toMatch(/^[a-f0-9]{64}$/);
    expect(buildMerkleRoot([])).toBeNull();
  });

  it("summarizes archived anchor receipts for operators", () => {
    expect(formatAuditAnchorReceipt(JSON.stringify({
      blockNumber: 12345,
      status: 1,
      gasUsed: "21000",
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
    }))).toEqual({
      blockNumber: 12345,
      status: 1,
      gasUsed: "21000",
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
    });
    expect(formatAuditAnchorReceipt("not-json")).toBeNull();
  });
});
