const fs = require("fs");
const path = require("path");

const API_KEY_FILE = "apikey.txt";
const LOCAL_SECRETS_FILE = ".local-secrets.env";
const MAIL_FILE = "mail.txt";

function parseKeyValueSecretFile(content) {
  const entries = {};
  const rawValues = [];

  for (const line of String(content || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = (() => {
      const equalsIndex = trimmed.indexOf("=");
      const colonIndex = trimmed.indexOf(":");
      if (equalsIndex === -1) return colonIndex;
      if (colonIndex === -1) return equalsIndex;
      return Math.min(equalsIndex, colonIndex);
    })();

    if (separatorIndex === -1) {
      rawValues.push(trimmed);
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && value) {
      entries[key] = value;
    }
  }

  return { entries, rawValues };
}

function normalizeSecretKey(key) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function firstEntryValue(entries, aliases) {
  const normalizedAliases = new Set(aliases.map(normalizeSecretKey));
  for (const [key, value] of Object.entries(entries)) {
    if (normalizedAliases.has(normalizeSecretKey(key)) && String(value || "").trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function inferSmtpHostFromUser(user) {
  const match = String(user || "").trim().toLowerCase().match(/@([^@\s]+)$/);
  if (!match) {
    return "";
  }

  const domain = match[1];
  const knownHosts = {
    "gmail.com": "smtp.gmail.com",
    "googlemail.com": "smtp.gmail.com",
    "outlook.com": "smtp.office365.com",
    "hotmail.com": "smtp.office365.com",
    "live.com": "smtp.office365.com",
    "qq.com": "smtp.qq.com",
    "163.com": "smtp.163.com",
    "126.com": "smtp.126.com",
    "icloud.com": "smtp.mail.me.com",
    "me.com": "smtp.mail.me.com",
  };

  return knownHosts[domain] || `mail.${domain}`;
}

function readTextFileIfPresent(cwd, fileName) {
  const filePath = path.resolve(cwd, fileName);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, "utf8");
}

function readLocalSecretBundle(cwd) {
  const content = readTextFileIfPresent(cwd, LOCAL_SECRETS_FILE);
  if (content === null) {
    return null;
  }

  return parseKeyValueSecretFile(content);
}

function readApiKeyOverrides(cwd, bundle = null) {
  if (bundle) {
    const bundledKey =
      firstEntryValue(bundle.entries, ["VULTR_API_KEY", "VULTR_TOKEN", "API_KEY", "apikey", "token", "key"])
      || bundle.rawValues[0]
      || "";
    if (bundledKey) {
      return { VULTR_API_KEY: bundledKey };
    }
  }

  const content = readTextFileIfPresent(cwd, API_KEY_FILE);
  if (content === null) {
    return {};
  }

  const parsed = parseKeyValueSecretFile(content);
  const vultrApiKey =
    firstEntryValue(parsed.entries, ["VULTR_API_KEY", "VULTR_TOKEN", "API_KEY", "apikey", "token", "key"])
    || parsed.rawValues[0]
    || "";

  return vultrApiKey ? { VULTR_API_KEY: vultrApiKey } : {};
}

function readMailOverrides(cwd, bundle = null) {
  if (bundle) {
    const smtpUser = firstEntryValue(bundle.entries, [
      "SMTP_USER",
      "SMTP_USERNAME",
      "MAIL_USER",
      "MAIL_USERNAME",
      "user",
      "username",
      "account",
      "email",
      "mail",
      "账号",
      "账户",
      "邮箱",
    ]);
    const smtpPass = firstEntryValue(bundle.entries, [
      "SMTP_PASS",
      "SMTP_PASSWORD",
      "MAIL_PASS",
      "MAIL_PASSWORD",
      "pass",
      "password",
      "密码",
      "授权码",
    ]);
    const smtpHost = firstEntryValue(bundle.entries, [
      "SMTP_HOST",
      "MAIL_HOST",
      "host",
      "smtp_host",
      "smtpHost",
      "server",
      "服务器",
      "主机",
    ]);
    const smtpPort = firstEntryValue(bundle.entries, ["SMTP_PORT", "MAIL_PORT", "port", "smtp_port", "smtpPort", "端口"]);
    const smtpSecure = firstEntryValue(bundle.entries, ["SMTP_SECURE", "MAIL_SECURE", "secure", "ssl", "tls"]);
    const smtpFrom = firstEntryValue(bundle.entries, ["SMTP_FROM", "MAIL_FROM", "from", "sender", "发件人"]);

    if (smtpUser || smtpPass || smtpHost || smtpPort || smtpSecure || smtpFrom) {
      const env = {};
      if (smtpUser) env.SMTP_USER = smtpUser;
      if (smtpPass) env.SMTP_PASS = smtpPass;
      env.SMTP_HOST = smtpHost || inferSmtpHostFromUser(smtpUser);
      env.SMTP_PORT = smtpPort || "465";
      env.SMTP_SECURE = smtpSecure || "true";
      env.SMTP_FROM = smtpFrom || smtpUser;
      return Object.fromEntries(Object.entries(env).filter(([, value]) => String(value || "").trim()));
    }
  }

  const content = readTextFileIfPresent(cwd, MAIL_FILE);
  if (content === null) {
    return {};
  }

  const parsed = parseKeyValueSecretFile(content);
  const env = {};
  const smtpHost = firstEntryValue(parsed.entries, ["SMTP_HOST", "host", "smtp_host", "smtpHost", "server", "服务器", "主机"]);
  const smtpPort = firstEntryValue(parsed.entries, ["SMTP_PORT", "port", "smtp_port", "smtpPort", "端口"]);
  const smtpUser = firstEntryValue(parsed.entries, [
    "SMTP_USER",
    "SMTP_USERNAME",
    "user",
    "username",
    "account",
    "email",
    "mail",
    "账号",
    "账户",
    "邮箱",
  ]);
  const smtpPass = firstEntryValue(parsed.entries, ["SMTP_PASS", "SMTP_PASSWORD", "pass", "password", "密码", "授权码"]);
  const smtpSecure = firstEntryValue(parsed.entries, ["SMTP_SECURE", "secure", "ssl", "tls"]);
  const smtpFrom = firstEntryValue(parsed.entries, ["SMTP_FROM", "from", "sender", "发件人"]);

  if (smtpUser) env.SMTP_USER = smtpUser;
  if (smtpPass) env.SMTP_PASS = smtpPass;
  env.SMTP_HOST = smtpHost || inferSmtpHostFromUser(smtpUser);
  env.SMTP_PORT = smtpPort || "465";
  env.SMTP_SECURE = smtpSecure || "true";
  env.SMTP_FROM = smtpFrom || smtpUser;

  return Object.fromEntries(Object.entries(env).filter(([, value]) => String(value || "").trim()));
}

function readLocalCredentialOverrides({ cwd = process.cwd() } = {}) {
  const bundle = readLocalSecretBundle(cwd);
  return {
    ...readApiKeyOverrides(cwd, bundle),
    ...readMailOverrides(cwd, bundle),
  };
}

module.exports = {
  inferSmtpHostFromUser,
  parseKeyValueSecretFile,
  readApiKeyOverrides,
  readLocalCredentialOverrides,
  readMailOverrides,
  readLocalSecretBundle,
};
