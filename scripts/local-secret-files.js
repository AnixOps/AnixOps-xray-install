const fs = require("fs");
const path = require("path");

const UNIFIED_SECRETS_FILE = ".local-secrets.env";
const API_KEY_FILE = "apikey.txt";
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

function readProviderOverridesFromParsed(parsed) {
  const env = {};
  const provider = firstEntryValue(parsed.entries, ["CLOUD_PROVIDER", "provider", "cloud_provider"]).toLowerCase();
  const genericToken = firstEntryValue(parsed.entries, ["API_KEY", "apikey", "token", "key"]) || parsed.rawValues[0] || "";
  const vultrApiKey = firstEntryValue(parsed.entries, ["VULTR_API_KEY", "VULTR_TOKEN"]);
  const digitaloceanToken = firstEntryValue(parsed.entries, [
    "DIGITALOCEAN_TOKEN",
    "DIGITALOCEAN_API_TOKEN",
    "DO_API_TOKEN",
    "DO_TOKEN",
  ]);
  const awsAccessKeyId = firstEntryValue(parsed.entries, [
    "AWS_ACCESS_KEY_ID",
    "AWS_ACCESS_KEY",
    "ACCESS_KEY_ID",
  ]);
  const awsSecretAccessKey = firstEntryValue(parsed.entries, [
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SECRET_KEY",
    "SECRET_ACCESS_KEY",
  ]);
  const awsRegion = firstEntryValue(parsed.entries, ["AWS_REGION", "REGION"]);
  const awsSecurityGroupId = firstEntryValue(parsed.entries, [
    "AWS_SECURITY_GROUP_ID",
    "SECURITY_GROUP_ID",
    "SECURITYGROUPID",
  ]);

  if (vultrApiKey) {
    env.VULTR_API_KEY = vultrApiKey;
  }
  if (digitaloceanToken) {
    env.DIGITALOCEAN_TOKEN = digitaloceanToken;
  }
  if (awsAccessKeyId) {
    env.AWS_ACCESS_KEY_ID = awsAccessKeyId;
  }
  if (awsSecretAccessKey) {
    env.AWS_SECRET_ACCESS_KEY = awsSecretAccessKey;
  }
  if (awsRegion) {
    env.AWS_REGION = awsRegion;
  }
  if (awsSecurityGroupId) {
    env.AWS_SECURITY_GROUP_ID = awsSecurityGroupId;
  }

  if (!env.VULTR_API_KEY && genericToken && provider === "vultr") {
    env.VULTR_API_KEY = genericToken;
  }
  if (!env.DIGITALOCEAN_TOKEN && genericToken && provider === "digitalocean") {
    env.DIGITALOCEAN_TOKEN = genericToken;
  }

  if (Object.keys(env).length === 0 && genericToken) {
    env.VULTR_API_KEY = genericToken;
  }

  return env;
}

function readSmtpOverridesFromParsed(parsed) {
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
  const hasAnySmtpField = Boolean(smtpHost || smtpPort || smtpUser || smtpPass || smtpSecure || smtpFrom);

  if (!hasAnySmtpField) {
    return {};
  }

  if (smtpUser) env.SMTP_USER = smtpUser;
  if (smtpPass) env.SMTP_PASS = smtpPass;
  env.SMTP_HOST = smtpHost || inferSmtpHostFromUser(smtpUser);
  env.SMTP_PORT = smtpPort || "465";
  env.SMTP_SECURE = smtpSecure || "true";
  env.SMTP_FROM = smtpFrom || smtpUser;

  return Object.fromEntries(Object.entries(env).filter(([, value]) => String(value || "").trim()));
}

function readUnifiedSecretEnvOverrides(cwd) {
  const content = readTextFileIfPresent(cwd, UNIFIED_SECRETS_FILE);
  if (content === null) {
    return {};
  }

  const parsed = parseKeyValueSecretFile(content);
  return {
    ...readProviderOverridesFromParsed(parsed),
    ...readSmtpOverridesFromParsed(parsed),
  };
}

function readApiKeyOverrides(cwd) {
  const content = readTextFileIfPresent(cwd, API_KEY_FILE);
  if (content === null) {
    return {};
  }

  return readProviderOverridesFromParsed(parseKeyValueSecretFile(content));
}

function readMailOverrides(cwd) {
  const content = readTextFileIfPresent(cwd, MAIL_FILE);
  if (content === null) {
    return {};
  }

  return readSmtpOverridesFromParsed(parseKeyValueSecretFile(content));
}

function readLocalCredentialOverrides({ cwd = process.cwd() } = {}) {
  return {
    ...readUnifiedSecretEnvOverrides(cwd),
    ...readApiKeyOverrides(cwd),
    ...readMailOverrides(cwd),
  };
}

module.exports = {
  inferSmtpHostFromUser,
  parseKeyValueSecretFile,
  readApiKeyOverrides,
  readLocalCredentialOverrides,
  readMailOverrides,
  readUnifiedSecretEnvOverrides,
};
