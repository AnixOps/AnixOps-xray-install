import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadApiSecret, loadMergedEnv, parseEnvFile } = require("./script-env.js");

describe("script env helpers", () => {
  it("parses env files without failing on missing files", () => {
    expect(parseEnvFile("/definitely/missing/.env")).toEqual({});
  });

  it("loads merged env with .local-secrets.env taking precedence", () => {
    const dir = mkdtempSync(join(tmpdir(), "anixops-script-env-"));
    try {
      writeFileSync(join(dir, ".env.selfhosted"), "API_SECRET=from-env\nOTHER=value\n", "utf8");
      writeFileSync(join(dir, ".local-secrets.env"), "API_SECRET=from-local-secrets\n", "utf8");

      expect(loadMergedEnv(".env.selfhosted", { cwd: dir })).toEqual({
        API_SECRET: "from-local-secrets",
        OTHER: "value",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads API_SECRET from merged env files", () => {
    const dir = mkdtempSync(join(tmpdir(), "anixops-script-env-"));
    try {
      writeFileSync(join(dir, ".env.selfhosted"), "API_SECRET=from-env\n", "utf8");
      writeFileSync(join(dir, ".local-secrets.env"), "API_SECRET=from-local-secrets\n", "utf8");

      expect(loadApiSecret(".env.selfhosted", { cwd: dir })).toBe("from-local-secrets");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
