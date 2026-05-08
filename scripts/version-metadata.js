#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function getCurrentGitCommit(cwd = process.cwd()) {
  return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd,
    encoding: "utf8",
  }).trim();
}

function readVersionsFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildVersionMetadata(current, commit) {
  return {
    ...current,
    commit,
  };
}

function writeVersionsFile(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function parseArgs(argv) {
  const args = {
    file: "versions.json",
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--file") {
      args.file = argv[i + 1];
      i += 1;
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
  node scripts/version-metadata.js [--file versions.json] [--dry-run]

Syncs the displayed commit in versions.json to the current git HEAD.`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const filePath = path.resolve(process.cwd(), args.file);
  const current = readVersionsFile(filePath);
  const commit = getCurrentGitCommit(process.cwd());
  const next = buildVersionMetadata(current, commit);

  if (!args.dryRun) {
    writeVersionsFile(filePath, next);
  }

  console.log(`Version metadata ${args.dryRun ? "plan" : "synced"}`);
  console.log(`file=${args.file}`);
  console.log(`commit=${commit}`);
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
  buildVersionMetadata,
  getCurrentGitCommit,
  parseArgs,
  readVersionsFile,
  writeVersionsFile,
};
