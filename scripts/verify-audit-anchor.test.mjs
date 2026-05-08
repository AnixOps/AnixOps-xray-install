import { describe, expect, it } from "vitest";
import { parseArgs, parseEnvFile } from "./verify-audit-anchor.js";
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
});
