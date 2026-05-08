import { describe, expect, it, vi } from "vitest";
import { parseArgs, parseEnvFile, verifyAuditAnchor } from "./verify-audit-anchor.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("verify-audit-anchor script helpers", () => {
  it("parses batch id, API URL, and env file arguments", () => {
    expect(parseArgs(["batch-1", "--api", "http://127.0.0.1:8787", "--env-file", ".env.test"])).toEqual({
      batchId: "batch-1",
      api: "http://127.0.0.1:8787",
      envFile: ".env.test",
    });
  });

  it("parses env files without interpreting comments as secrets", () => {
    const dir = mkdtempSync(join(tmpdir(), "anixops-audit-"));
    const file = join(dir, ".env");
    writeFileSync(file, "API_SECRET='secret-value'\n# ignored\nEMPTY=\n");
    expect(parseEnvFile(file)).toEqual({
      API_SECRET: "secret-value",
      EMPTY: "",
    });
  });

  it("verifies an audit anchor batch through the API helper", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        batchId: "batch-1",
        eventCount: 1,
        merkleRoot: `0x${"a".repeat(64)}`,
        status: "anchored",
        chain: "base-sepolia",
        txHash: "0x" + "1".repeat(64),
      }),
    }));

    await expect(verifyAuditAnchor({
      baseUrl: "http://127.0.0.1:8787",
      apiSecret: "secret",
      batchId: "batch-1",
      fetchImpl,
    })).resolves.toMatchObject({
      ok: true,
      batchId: "batch-1",
      eventCount: 1,
    });
  });
});
