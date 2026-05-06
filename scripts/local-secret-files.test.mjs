import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  inferSmtpHostFromUser,
  parseKeyValueSecretFile,
  readLocalCredentialOverrides,
} = require("./local-secret-files.js");

describe("local secret file helpers", () => {
  it("parses key-value and raw secret files", () => {
    expect(parseKeyValueSecretFile("账号=ops@example.com\npassword: app-secret\nraw-token\n")).toEqual({
      entries: {
        "账号": "ops@example.com",
        password: "app-secret",
      },
      rawValues: ["raw-token"],
    });
  });

  it("infers common SMTP hosts from the account domain", () => {
    expect(inferSmtpHostFromUser("ops@gmail.com")).toBe("smtp.gmail.com");
    expect(inferSmtpHostFromUser("ops@anixops.com")).toBe("mail.anixops.com");
  });

  it("reads apikey.txt and mail.txt without requiring values in the env file", () => {
    const dir = mkdtempSync(join(tmpdir(), "anixops-secrets-"));
    try {
      writeFileSync(join(dir, "apikey.txt"), "vultr-secret-token\n", "utf8");
      writeFileSync(join(dir, "mail.txt"), "账号=ops@anixops.com\npassword=mail-app-password\n", "utf8");

      expect(readLocalCredentialOverrides({ cwd: dir })).toEqual({
        VULTR_API_KEY: "vultr-secret-token",
        SMTP_USER: "ops@anixops.com",
        SMTP_PASS: "mail-app-password",
        SMTP_HOST: "mail.anixops.com",
        SMTP_PORT: "465",
        SMTP_SECURE: "true",
        SMTP_FROM: "ops@anixops.com",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prefers the unified local secrets bundle when present", () => {
    const dir = mkdtempSync(join(tmpdir(), "anixops-secrets-"));
    try {
      writeFileSync(join(dir, ".local-secrets.env"), [
        "VULTR_API_KEY=bundle-token",
        "SMTP_HOST=us1.workspace.org",
        "SMTP_PORT=465",
        "SMTP_USER=ops@example.com",
        "SMTP_PASS=bundle-password",
        "SMTP_SECURE=true",
        "SMTP_FROM=ops@example.com",
      ].join("\n"), "utf8");
      writeFileSync(join(dir, "apikey.txt"), "legacy-token\n", "utf8");
      writeFileSync(join(dir, "mail.txt"), "账号=legacy@example.com\npassword=legacy-password\n", "utf8");

      expect(readLocalCredentialOverrides({ cwd: dir })).toEqual({
        VULTR_API_KEY: "bundle-token",
        SMTP_USER: "ops@example.com",
        SMTP_PASS: "bundle-password",
        SMTP_HOST: "us1.workspace.org",
        SMTP_PORT: "465",
        SMTP_SECURE: "true",
        SMTP_FROM: "ops@example.com",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
