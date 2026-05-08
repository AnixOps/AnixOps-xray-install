import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { isAllowedPlaceholder, listGitVisibleFiles, parseGitFileList, scanFiles } = require("./check-secrets.js");

const tempDirs = [];

function writeTempFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anixops-secret-test-"));
  tempDirs.push(dir);
  const file = path.join(dir, name);
  fs.writeFileSync(file, content, "utf8");
  return file;
}

describe("secret scanner", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("allows empty and placeholder values", () => {
    expect(isAllowedPlaceholder("")).toBe(true);
    expect(isAllowedPlaceholder("change-me-secret")).toBe(true);
    expect(isAllowedPlaceholder("sk_test_")).toBe(true);
  });

  it("parses git ls-files output into a stable list", () => {
    expect(parseGitFileList("a.txt\nb.txt\n")).toEqual(["a.txt", "b.txt"]);
  });

  it("lists git-visible files without throwing in the current repository", () => {
    expect(Array.isArray(listGitVisibleFiles())).toBe(true);
  });

  it("flags visible sensitive local filenames", () => {
    const file = writeTempFile("ssh.txt", "ip: 127.0.0.1\npassword: secret\n");

    expect(scanFiles([file])).toContain(`${file}: sensitive local file is visible to git`);
  });

  it("flags .local-secrets.env as a sensitive local file", () => {
    const file = writeTempFile(".local-secrets.env", "VULTR_API_KEY=secret\n");

    expect(scanFiles([file])).toContain(`${file}: sensitive local file is visible to git`);
  });

  it("flags apikey.txt as a sensitive local file", () => {
    const file = writeTempFile("apikey.txt", "secret-token\n");

    expect(scanFiles([file])).toContain(`${file}: sensitive local file is visible to git`);
  });

  it("flags private key blocks", () => {
    const privateKeyBlock = "-----BEGIN " + "OPENSSH PRIVATE KEY-----\nabc\n";
    const file = writeTempFile("note.md", privateKeyBlock);

    expect(scanFiles([file])).toContain(`${file}: private key block detected`);
  });

  it("flags hard-coded non-placeholder secrets", () => {
    const file = writeTempFile("settings.conf", "API_SECRET=real-production-secret\n");

    expect(scanFiles([file])).toContain(`${file}:1: possible hard-coded secret`);
  });
});
