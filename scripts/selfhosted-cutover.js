#!/usr/bin/env node

const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const DRY_RUN_ENV_FILE = ".env.selfhosted.cutover.tmp";

function parseArgs(argv) {
  const args = {
    provider: "",
    envFile: ".env.selfhosted",
    remoteDir: "/opt/anixops-selfhosted",
    baselineOut: path.join(os.tmpdir(), "anixops-remote-baseline.json"),
    frontendUrl: "",
    allowedOrigins: "",
    adminEmail: "",
    vultrApiKey: "",
    digitaloceanToken: "",
    awsAccessKeyId: "",
    awsSecretAccessKey: "",
    awsRegion: "",
    awsSecurityGroupId: "",
    skipBaseline: false,
    skipLocalDoctor: false,
    skipPostcheck: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--provider") {
      args.provider = argv[i + 1];
      i += 1;
    } else if (arg === "--env-file" || arg === "--file" || arg === "--env") {
      args.envFile = argv[i + 1];
      i += 1;
    } else if (arg === "--remote-dir") {
      args.remoteDir = argv[i + 1];
      i += 1;
    } else if (arg === "--baseline-out") {
      args.baselineOut = argv[i + 1];
      i += 1;
    } else if (arg === "--frontend-url") {
      args.frontendUrl = argv[i + 1];
      i += 1;
    } else if (arg === "--allowed-origins") {
      args.allowedOrigins = argv[i + 1];
      i += 1;
    } else if (arg === "--admin-email") {
      args.adminEmail = argv[i + 1];
      i += 1;
    } else if (arg === "--vultr-api-key") {
      args.vultrApiKey = argv[i + 1];
      i += 1;
    } else if (arg === "--digitalocean-token") {
      args.digitaloceanToken = argv[i + 1];
      i += 1;
    } else if (arg === "--aws-access-key-id") {
      args.awsAccessKeyId = argv[i + 1];
      i += 1;
    } else if (arg === "--aws-secret-access-key") {
      args.awsSecretAccessKey = argv[i + 1];
      i += 1;
    } else if (arg === "--aws-region") {
      args.awsRegion = argv[i + 1];
      i += 1;
    } else if (arg === "--aws-security-group-id") {
      args.awsSecurityGroupId = argv[i + 1];
      i += 1;
    } else if (arg === "--skip-baseline") {
      args.skipBaseline = true;
    } else if (arg === "--skip-local-doctor") {
      args.skipLocalDoctor = true;
    } else if (arg === "--skip-postcheck") {
      args.skipPostcheck = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function usage() {
  console.log(`Usage:
  node scripts/selfhosted-cutover.js [--provider vultr|digitalocean|aws] [--vultr-api-key <token>] [--file .env.selfhosted] [--remote-dir /opt/anixops-selfhosted] [--baseline-out <file>] [--dry-run]

Runs the intended repository-managed cutover sequence:
1. capture remote baseline
2. complete local env
3. run local self-hosted doctor
4. deploy with --replace-live
5. run remote self-hosted doctor`);
}

function pushArg(list, flag, value) {
  if (value) {
    list.push(flag, value);
  }
}

function buildInitEnvArgs(args) {
  const result = ["scripts/selfhosted-init-env.js", "--out", args.envFile];
  pushArg(result, "--provider", args.provider);
  pushArg(result, "--frontend-url", args.frontendUrl);
  pushArg(result, "--allowed-origins", args.allowedOrigins);
  pushArg(result, "--admin-email", args.adminEmail);
  pushArg(result, "--vultr-api-key", args.vultrApiKey);
  pushArg(result, "--digitalocean-token", args.digitaloceanToken);
  pushArg(result, "--aws-access-key-id", args.awsAccessKeyId);
  pushArg(result, "--aws-secret-access-key", args.awsSecretAccessKey);
  pushArg(result, "--aws-region", args.awsRegion);
  pushArg(result, "--aws-security-group-id", args.awsSecurityGroupId);
  return result;
}

function buildBaselineArgs(args) {
  return ["scripts/remote-baseline.js", "--out", args.baselineOut];
}

function buildLocalDoctorArgs(args) {
  return ["scripts/selfhosted-doctor.js", "--file", args.envFile, "--strict"];
}

function buildDeployArgs(args) {
  const result = [
    "scripts/selfhosted-deploy.js",
    "--file",
    args.envFile,
    "--remote-dir",
    args.remoteDir,
    "--replace-live",
  ];
  if (args.dryRun) {
    result.push("--dry-run");
  }
  return result;
}

function buildRemoteDoctorArgs() {
  return ["scripts/selfhosted-doctor.js", "--remote", "--strict"];
}

function resolveWorkingEnvFile(args) {
  if (!args.dryRun) {
    return args.envFile;
  }
  return DRY_RUN_ENV_FILE;
}

function runNodeScript(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: node ${args.join(" ")}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const workingEnvFile = resolveWorkingEnvFile(args);
  const workingArgs = {
    ...args,
    envFile: workingEnvFile,
  };

  if (!args.skipBaseline) {
    runNodeScript(buildBaselineArgs(args));
  }

  runNodeScript(buildInitEnvArgs(workingArgs));

  try {
    if (!args.skipLocalDoctor) {
      runNodeScript(buildLocalDoctorArgs(workingArgs));
    }

    runNodeScript(buildDeployArgs(workingArgs));

    if (!args.skipPostcheck && !args.dryRun) {
      runNodeScript(buildRemoteDoctorArgs());
    }
  } finally {
    if (args.dryRun && fs.existsSync(workingEnvFile)) {
      try {
        fs.unlinkSync(workingEnvFile);
      } catch {}
    }
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  buildBaselineArgs,
  buildDeployArgs,
  buildInitEnvArgs,
  buildLocalDoctorArgs,
  buildRemoteDoctorArgs,
  parseArgs,
  resolveWorkingEnvFile,
};
