const fs = require("fs");
const path = require("path");

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key) env[key] = value;
  }
  return env;
}

function loadMergedEnv(envFile, { cwd = process.cwd() } = {}) {
  const envPath = path.resolve(cwd, envFile);
  const localSecretsPath = path.resolve(path.dirname(envPath), ".local-secrets.env");
  return {
    ...parseEnvFile(envPath),
    ...parseEnvFile(localSecretsPath),
  };
}

function loadApiSecret(envFile, options = {}) {
  const fileEnv = loadMergedEnv(envFile, options);
  return process.env.API_SECRET || fileEnv.API_SECRET || "";
}

module.exports = {
  loadApiSecret,
  loadMergedEnv,
  parseEnvFile,
};
