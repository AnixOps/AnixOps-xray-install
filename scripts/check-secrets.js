#!/usr/bin/env node

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const MAX_FILE_BYTES = 1024 * 1024;

const SENSITIVE_BASENAMES = new Set([
  ".env",
  ".env.local",
  ".local-secrets.env",
  ".env.selfhosted",
  "apikey.txt",
  "ssh.txt",
  "mail.txt",
  "id_rsa",
  "id_ed25519",
]);

const SECRET_KEY_PATTERN = /(?:SECRET|TOKEN|PASSWORD|PASS|API_KEY|PRIVATE_KEY|WEBHOOK_SECRET|SMTP_PASS)\s*[:=]\s*["']?([^"'\s#]+)?/i;
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:OPENSSH|RSA|EC|DSA|PRIVATE) PRIVATE KEY-----/;
const HIGH_CONFIDENCE_TOKEN_PATTERN = /\b(?:sk_live_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16})\b/;

function parseGitFileList(output) {
  return String(output || "")
    .split(/\r?\n/)
    .filter(Boolean);
}

function readExecOutput(value) {
  if (typeof value === "string") {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  return "";
}

function listGitVisibleFiles() {
  try {
    return parseGitFileList(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
      encoding: "utf8",
    }));
  } catch (error) {
    const output = readExecOutput(error && typeof error === "object" ? error.stdout : "");
    if ((error?.status === 0 || error?.code === "EPERM") && output.trim()) {
      return parseGitFileList(output);
    }
    throw error;
  }
}

function isAllowedPlaceholder(value) {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "" ||
    normalized === "true" ||
    normalized === "false" ||
    normalized.startsWith("change-me") ||
    normalized.startsWith("changeme") ||
    normalized.startsWith("your-") ||
    normalized.startsWith("test-") ||
    normalized.startsWith("dev-") ||
    normalized.startsWith("whsec_dev") ||
    normalized.endsWith("_") ||
    normalized.includes("example") ||
    normalized.includes("localhost")
  );
}

function shouldSkipFile(file) {
  const normalized = file.replace(/\\/g, "/");
  return (
    normalized.startsWith(".git/") ||
    normalized.startsWith(".next/") ||
    normalized.startsWith(".ssh/") ||
    normalized.startsWith("node_modules/") ||
    normalized.startsWith("server/node_modules/") ||
    normalized.startsWith("provision-server/node_modules/") ||
    normalized.endsWith("package-lock.json") ||
    normalized.endsWith(".png") ||
    normalized.endsWith(".jpg") ||
    normalized.endsWith(".jpeg") ||
    normalized.endsWith(".gif") ||
    normalized.endsWith(".webp") ||
    normalized.endsWith(".ico")
  );
}

function isConfigLikeFile(file) {
  const normalized = file.replace(/\\/g, "/").toLowerCase();
  const base = path.basename(normalized);
  return (
    base.startsWith(".env") ||
    base.includes("docker-compose") ||
    /\.(env|ya?ml|toml|ini|conf|properties)$/.test(normalized)
  );
}

function scanFile(file) {
  const issues = [];
  const base = path.basename(file);
  if (SENSITIVE_BASENAMES.has(base)) {
    issues.push(`${file}: sensitive local file is visible to git`);
  }

  const stat = fs.statSync(file);
  if (stat.size > MAX_FILE_BYTES) {
    return issues;
  }

  const buffer = fs.readFileSync(file);
  if (buffer.includes(0)) {
    return issues;
  }

  const text = buffer.toString("utf8");
  if (PRIVATE_KEY_PATTERN.test(text)) {
    issues.push(`${file}: private key block detected`);
  }

  if (HIGH_CONFIDENCE_TOKEN_PATTERN.test(text)) {
    issues.push(`${file}: high-confidence token detected`);
  }

  if (!isConfigLikeFile(file)) {
    return issues;
  }

  text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    if (trimmed.includes("${") || trimmed.includes("$${")) return;
    const match = trimmed.match(SECRET_KEY_PATTERN);
    if (!match) return;
    const value = match[1];
    if (value?.startsWith("$") || value?.startsWith("{") || value?.includes("${")) return;
    if (!isAllowedPlaceholder(value)) {
      issues.push(`${file}:${index + 1}: possible hard-coded secret`);
    }
  });

  return issues;
}

function scanFiles(files) {
  return files
    .filter((file) => fs.existsSync(file) && fs.statSync(file).isFile())
    .filter((file) => !shouldSkipFile(file))
    .flatMap(scanFile);
}

function main() {
  const issues = scanFiles(listGitVisibleFiles());
  if (issues.length > 0) {
    console.error("Secret scan failed:");
    issues.forEach((issue) => console.error(`- ${issue}`));
    process.exit(1);
  }
  console.log("Secret scan passed");
}

if (require.main === module) {
  main();
}

module.exports = {
  isAllowedPlaceholder,
  listGitVisibleFiles,
  parseGitFileList,
  scanFiles,
};
