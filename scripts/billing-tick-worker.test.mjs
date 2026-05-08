import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadApiSecret, parseArgs } = require("./billing-tick-worker.js");

describe("billing-tick-worker helpers", () => {
  it("parses CLI arguments", () => {
    expect(parseArgs(["--api", "http://127.0.0.1:8787", "--env-file", ".env.test", "--json"])).toEqual({
      api: "http://127.0.0.1:8787",
      envFile: ".env.test",
      json: true,
    });
  });

  it("loads API_SECRET from an env file", () => {
    const dir = mkdtempSync(join(tmpdir(), "anixops-billing-"));
    const envFile = join(dir, ".env.selfhosted");
    writeFileSync(envFile, "API_SECRET=test-secret\n");
    expect(loadApiSecret(envFile)).toBe("test-secret");
  });
});
