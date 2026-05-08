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
  readUnifiedSecretEnvOverrides,
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

  it("reads provider and SMTP overrides from .local-secrets.env", () => {
    const dir = mkdtempSync(join(tmpdir(), "anixops-secrets-"));
    try {
      writeFileSync(
        join(dir, ".local-secrets.env"),
        [
          "VULTR_API_KEY=vultr-secret-token",
          "SMTP_USER=ops@anixops.com",
          "SMTP_PASS=mail-app-password",
          "SMTP_HOST=mail.anixops.com",
          "SMTP_PORT=465",
          "SMTP_SECURE=true",
          "SMTP_FROM=ops@anixops.com",
        ].join("\n"),
        "utf8",
      );

      expect(readUnifiedSecretEnvOverrides(dir)).toEqual({
        VULTR_API_KEY: "vultr-secret-token",
        SMTP_USER: "ops@anixops.com",
        SMTP_PASS: "mail-app-password",
        SMTP_HOST: "mail.anixops.com",
        SMTP_PORT: "465",
        SMTP_SECURE: "true",
        SMTP_FROM: "ops@anixops.com",
      });
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

  it("does not synthesize SMTP defaults when .local-secrets.env only contains provider fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "anixops-secrets-"));
    try {
      writeFileSync(join(dir, ".local-secrets.env"), "VULTR_API_KEY=vultr-secret-token\n", "utf8");

      expect(readUnifiedSecretEnvOverrides(dir)).toEqual({
        VULTR_API_KEY: "vultr-secret-token",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lets apikey.txt and mail.txt override .local-secrets.env", () => {
    const dir = mkdtempSync(join(tmpdir(), "anixops-secrets-"));
    try {
      writeFileSync(join(dir, ".local-secrets.env"), "VULTR_API_KEY=vultr-from-unified\nSMTP_USER=old@example.com\nSMTP_PASS=old-pass\n", "utf8");
      writeFileSync(join(dir, "apikey.txt"), "vultr-from-apikey\n", "utf8");
      writeFileSync(join(dir, "mail.txt"), "账号=new@example.com\npassword=new-pass\n", "utf8");

      expect(readLocalCredentialOverrides({ cwd: dir })).toEqual({
        VULTR_API_KEY: "vultr-from-apikey",
        SMTP_USER: "new@example.com",
        SMTP_PASS: "new-pass",
        SMTP_HOST: "mail.example.com",
        SMTP_PORT: "465",
        SMTP_SECURE: "true",
        SMTP_FROM: "new@example.com",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads explicit DigitalOcean credentials from apikey.txt", () => {
    const dir = mkdtempSync(join(tmpdir(), "anixops-secrets-"));
    try {
      writeFileSync(join(dir, "apikey.txt"), "DIGITALOCEAN_TOKEN=do-secret-token\n", "utf8");

      expect(readLocalCredentialOverrides({ cwd: dir })).toEqual({
        DIGITALOCEAN_TOKEN: "do-secret-token",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads explicit AWS credentials from apikey.txt", () => {
    const dir = mkdtempSync(join(tmpdir(), "anixops-secrets-"));
    try {
      writeFileSync(
        join(dir, "apikey.txt"),
        [
          "AWS_ACCESS_KEY_ID=AKIATESTEXAMPLE000",
          "AWS_SECRET_ACCESS_KEY=aws-secret-value-0123456789",
          "AWS_REGION=ap-northeast-1",
          "AWS_SECURITY_GROUP_ID=sg-12345678",
        ].join("\n"),
        "utf8",
      );

      expect(readLocalCredentialOverrides({ cwd: dir })).toEqual({
        AWS_ACCESS_KEY_ID: "AKIATESTEXAMPLE000",
        AWS_SECRET_ACCESS_KEY: "aws-secret-value-0123456789",
        AWS_REGION: "ap-northeast-1",
        AWS_SECURITY_GROUP_ID: "sg-12345678",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("routes a generic token to DigitalOcean when provider is declared", () => {
    const dir = mkdtempSync(join(tmpdir(), "anixops-secrets-"));
    try {
      writeFileSync(join(dir, "apikey.txt"), "provider=digitalocean\ntoken=do-secret-token\n", "utf8");

      expect(readLocalCredentialOverrides({ cwd: dir })).toEqual({
        DIGITALOCEAN_TOKEN: "do-secret-token",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
