import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadApiSecret, parseArgs } = require("./compliance-stats-worker.js");

describe("compliance-stats-worker helpers", () => {
  it("parses CLI arguments", () => {
    expect(parseArgs([
      "--api", "http://127.0.0.1:8787",
      "--env-file", ".env.test",
      "--rental-id", "rental-1",
      "--limit", "25",
      "--json",
    ])).toEqual({
      api: "http://127.0.0.1:8787",
      envFile: ".env.test",
      rentalId: "rental-1",
      limit: 25,
      json: true,
    });
  });

  it("loads API_SECRET from an env file", () => {
    const dir = mkdtempSync(join(tmpdir(), "anixops-compliance-"));
    const envFile = join(dir, ".env.selfhosted");
    writeFileSync(envFile, "API_SECRET=test-secret\n");
    expect(loadApiSecret(envFile)).toBe("test-secret");
  });
});
