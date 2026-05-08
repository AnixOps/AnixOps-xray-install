import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildUploadManifest,
  buildManagedRemoteListingCommand,
  buildRemotePruneCommand,
  collectExpectedRemoteRelativePaths,
  computeStaleRemotePaths,
  extractDataMountOverrides,
  filterUnmanagedContainers,
  findNameCollisions,
  formatEnvValidationFailure,
  formatBytes,
  isManagedUploadPath,
  parseArgs,
  parseContainerNames,
  parseInspectJson,
  parseManagedRemotePaths,
  parseHostPortListeners,
  parsePortConflicts,
  partitionConflicts,
  serializeEnvEntries,
  shouldIncludePath,
  summarizeManifest,
  validateDeployMode,
} = require("./selfhosted-deploy.js");

describe("self-hosted deploy helpers", () => {
  it("parses deploy CLI arguments", () => {
    expect(parseArgs([
      "--env-file",
      ".env.prod",
      "--remote-dir",
      "/srv/anixops",
      "--dry-run",
      "--allow-placeholders",
      "--skip-health",
    ])).toEqual({
      envFile: ".env.prod",
      remoteDir: "/srv/anixops",
      dryRun: true,
      allowPlaceholders: true,
      replaceLive: false,
      skipHealth: true,
      syncOnly: false,
    });
  });

  it("parses replace-live flag", () => {
    expect(parseArgs(["--replace-live"])).toEqual({
      envFile: ".env.selfhosted",
      remoteDir: "/opt/anixops-selfhosted",
      dryRun: false,
      allowPlaceholders: false,
      replaceLive: true,
      skipHealth: false,
      syncOnly: false,
    });
  });

  it("parses sync-only flag", () => {
    expect(parseArgs(["--sync-only"])).toEqual({
      envFile: ".env.selfhosted",
      remoteDir: "/opt/anixops-selfhosted",
      dryRun: false,
      allowPlaceholders: false,
      replaceLive: false,
      skipHealth: false,
      syncOnly: true,
    });
  });

  it("blocks placeholder mode for real deployments", () => {
    expect(() => validateDeployMode({
      envFile: ".env.selfhosted.example",
      remoteDir: "/opt/anixops-selfhosted",
      dryRun: false,
      allowPlaceholders: true,
      replaceLive: false,
      skipHealth: false,
      syncOnly: false,
    })).toThrow("--allow-placeholders is only allowed with --dry-run");
  });

  it("blocks conflicting sync-only flags", () => {
    expect(() => validateDeployMode({
      envFile: ".env.selfhosted",
      remoteDir: "/opt/anixops-selfhosted",
      dryRun: false,
      allowPlaceholders: false,
      replaceLive: true,
      skipHealth: false,
      syncOnly: true,
    })).toThrow("--sync-only cannot be combined with --replace-live");

    expect(() => validateDeployMode({
      envFile: ".env.selfhosted",
      remoteDir: "/opt/anixops-selfhosted",
      dryRun: false,
      allowPlaceholders: false,
      replaceLive: false,
      skipHealth: true,
      syncOnly: true,
    })).toThrow("--sync-only cannot be combined with --skip-health");
  });

  it("allows dry-run without local SSH credentials", () => {
    const result = spawnSync(process.execPath, [
      "scripts/selfhosted-deploy.js",
      "--sync-only",
      "--dry-run",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ANIXOPS_SSH_FILE: "missing-ci-ssh.txt",
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
  });

  it("still requires SSH credentials for real sync-only uploads", () => {
    const result = spawnSync(process.execPath, [
      "scripts/selfhosted-deploy.js",
      "--sync-only",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ANIXOPS_SSH_FILE: "missing-ci-ssh.txt",
      },
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
  });

  it("formats deploy env validation failures with actionable hints", () => {
    const text = formatEnvValidationFailure({
      provider: "vultr",
      issues: [
        "Missing VULTR_API_KEY",
        "CLOUD_PROVIDER is vultr but detected configured credentials for digitalocean; switch CLOUD_PROVIDER or fill the vultr credential",
        "VPS_REGION looks like a Vultr region but CLOUD_PROVIDER is digitalocean",
      ],
    });

    expect(text).toContain("Self-hosted deploy blocked by env validation:");
    expect(text).toContain("hint: run `npm run selfhosted:init-env`");
    expect(text).toContain("align `CLOUD_PROVIDER`");
    expect(text).toContain("rerun `npm run selfhosted:init-env -- --provider <provider>`");
  });

  it("defines the legacy rename suffix in the remote shell script", () => {
    const source = readFileSync("scripts/selfhosted-deploy.js", "utf8");

    expect(source).toContain("rename_suffix=$(date +%Y%m%d%H%M%S)");
    expect(source).toContain('"${container}-legacy-${rename_suffix}"');
    expect(source).not.toContain("renameSuffix");
  });

  it("uses a retried post-deploy health check with diagnostic output", () => {
    const source = readFileSync("scripts/selfhosted-deploy.js", "utf8");

    expect(source).toContain("for attempt in $(seq 1 30); do");
    expect(source).toContain("Self-hosted health check failed");
    expect(source).toContain("docker logs --tail 120 anixops-provision-audit");
    expect(source).toContain("process.stdout.write(error.stdout)");
  });

  it("parses container name lists from docker ps output", () => {
    expect(parseContainerNames("anixops-audit-api\nanixops-ui-audit\n")).toEqual([
      "anixops-audit-api",
      "anixops-ui-audit",
    ]);
  });

  it("treats the scheduler container as a managed target name", () => {
    expect(findNameCollisions(["anixops-scheduler-audit"])).toEqual(["anixops-scheduler-audit"]);
    expect(partitionConflicts([
      { container: "anixops-scheduler-audit", ports: [] },
    ])).toEqual({
      replaceable: [{ container: "anixops-scheduler-audit", ports: [] }],
      blocking: [],
    });
  });

  it("filters out local-only and generated files", () => {
    expect(shouldIncludePath("web/app/page.tsx")).toBe(true);
    expect(shouldIncludePath("provision-server/node_modules/foo.js")).toBe(false);
    expect(shouldIncludePath("server/dist/index.js")).toBe(false);
    expect(shouldIncludePath(".env.selfhosted")).toBe(false);
    expect(shouldIncludePath("tsconfig.tsbuildinfo")).toBe(false);
  });

  it("recognizes only managed upload paths for remote prune", () => {
    expect(isManagedUploadPath("server/src/index.ts")).toBe(true);
    expect(isManagedUploadPath("scripts/selfhosted-deploy.js")).toBe(true);
    expect(isManagedUploadPath(".env.selfhosted")).toBe(false);
    expect(isManagedUploadPath("docs/evm-testnet-playbook.md")).toBe(false);
  });

  it("builds an upload manifest from the current repository", () => {
    const manifest = buildUploadManifest(process.cwd());

    expect(manifest).toContain("docker-compose.selfhosted.yml");
    expect(manifest).toContain("Dockerfile.scheduler");
    expect(manifest).toContain("web/app/page.tsx");
    expect(manifest).toContain("server/src/index.ts");
    expect(manifest).toContain("provision-server/src/server.ts");
    expect(manifest.some((entry) => entry.includes("node_modules"))).toBe(false);
    expect(manifest.some((entry) => entry.endsWith(".env.selfhosted"))).toBe(false);
  });

  it("collects expected managed remote paths from upload targets", () => {
    const expected = collectExpectedRemoteRelativePaths([
      { remotePath: "/opt/anixops-selfhosted/server/src/index.ts" },
      { remotePath: "/opt/anixops-selfhosted/scripts/selfhosted-deploy.js" },
      { remotePath: "/opt/anixops-selfhosted/.env.selfhosted" },
    ], "/opt/anixops-selfhosted");

    expect(expected).toEqual([
      "scripts/selfhosted-deploy.js",
      "server/src/index.ts",
    ]);
  });

  it("parses managed remote file listings and filters unmanaged paths", () => {
    const parsed = parseManagedRemotePaths([
      "server/src/index.ts",
      "server/src/polygon-chain.ts",
      "docs/evm-testnet-playbook.md",
      ".env.selfhosted",
      "",
    ].join("\n"));

    expect(parsed).toEqual([
      "server/src/index.ts",
      "server/src/polygon-chain.ts",
    ]);
  });

  it("computes stale remote paths that should be pruned", () => {
    const stale = computeStaleRemotePaths(
      ["scripts/selfhosted-deploy.js", "server/src/index.ts"],
      ["scripts/selfhosted-deploy.js", "server/src/index.ts", "server/src/polygon-chain.ts"],
    );

    expect(stale).toEqual(["server/src/polygon-chain.ts"]);
  });

  it("builds a scoped remote prune command", () => {
    const command = buildRemotePruneCommand("/opt/anixops-selfhosted", [
      "server/src/polygon-chain.ts",
      ".env.selfhosted",
    ]);

    expect(command).toContain("cd '/opt/anixops-selfhosted'");
    expect(command).toContain("rm -f -- 'server/src/polygon-chain.ts'");
    expect(command).not.toContain(".env.selfhosted");
    expect(command).toContain("find \"$dir\" -depth -type d -empty -exec rmdir {}");
  });

  it("builds a managed remote listing command", () => {
    const command = buildManagedRemoteListingCommand("/opt/anixops-selfhosted");

    expect(command).toContain("cd '/opt/anixops-selfhosted'");
    expect(command).toContain("for file in 'docker-compose.selfhosted.yml'");
    expect(command).toContain("find \"$dir\" -type f -print");
  });

  it("summarizes a manifest", () => {
    const manifest = ["package.json", "README.md"];
    const summary = summarizeManifest(process.cwd(), manifest);

    expect(summary.fileCount).toBe(2);
    expect(summary.totalBytes).toBeGreaterThan(0);
  });

  it("detects port conflicts from docker ps output", () => {
    const conflicts = parsePortConflicts([
      "anixops-audit-api 0.0.0.0:8787->8787/tcp, [::]:8787->8787/tcp",
      "anixops-ui-audit 0.0.0.0:30000->30000/tcp",
      "v2board 0.0.0.0:3001->3001/tcp",
      "postgres 5432/tcp",
    ].join("\n"));

    expect(conflicts).toEqual([
      { container: "anixops-audit-api", ports: [8787] },
      { container: "anixops-ui-audit", ports: [30000] },
    ]);
  });

  it("detects host process listeners on deploy ports", () => {
    const listeners = parseHostPortListeners([
      'LISTEN 0 1024 *:3001 *:* users:(("v2board",pid=3678467,fd=7))',
      'LISTEN 0 1024 0.0.0.0:8787 0.0.0.0:* users:(("docker-proxy",pid=123,fd=7))',
      "LISTEN 0 128 127.0.0.1:5432 0.0.0.0:*",
    ].join("\n"));

    expect(listeners).toEqual([
      {
        port: 8787,
        process: "docker-proxy",
        raw: 'LISTEN 0 1024 0.0.0.0:8787 0.0.0.0:* users:(("docker-proxy",pid=123,fd=7))',
      },
    ]);
  });

  it("partitions conflicts into replaceable and blocking groups", () => {
    const result = partitionConflicts([
      { container: "anixops-audit-api", ports: [8787] },
      { container: "anixops-ui-audit", ports: [30000] },
      { container: "other-service", ports: [8787] },
    ]);

    expect(result.replaceable).toEqual([
      { container: "anixops-audit-api", ports: [8787] },
      { container: "anixops-ui-audit", ports: [30000] },
    ]);
    expect(result.blocking).toEqual([
      { container: "other-service", ports: [8787] },
    ]);
  });

  it("finds name collisions against the target container names", () => {
    const result = findNameCollisions([
      "anixops-audit-api",
      "anixops-ui-audit",
      "anixops-audit-postgres",
      "something-else",
    ]);

    expect(result).toEqual([
      "anixops-audit-api",
      "anixops-ui-audit",
      "anixops-audit-postgres",
    ]);
  });

  it("parses inspect json and extracts reusable data mount overrides", () => {
    const inspect = parseInspectJson(JSON.stringify([
      {
        Name: "/anixops-audit-api",
        Config: {
          Env: [
            "DATABASE_URL=postgresql://anixops:legacy-postgres-password@postgres:5432/anixops",
            "REDIS_URL=redis://:legacy-redis-password@redis:6379",
          ],
        },
        Mounts: [],
      },
      {
        Name: "/anixops-audit-postgres",
        Mounts: [
          { Source: "/var/lib/docker/volumes/postgres/_data", Destination: "/var/lib/postgresql/data" },
        ],
      },
      {
        Name: "/anixops-audit-redis",
        Mounts: [
          { Source: "/var/lib/docker/volumes/redis/_data", Destination: "/data" },
        ],
      },
      {
        Name: "/anixops-provision-audit",
        Mounts: [
          { Source: "/var/lib/docker/volumes/provision-ssh/_data", Destination: "/app/.ssh" },
        ],
      },
    ]));

    expect(extractDataMountOverrides(inspect)).toEqual({
      POSTGRES_PASSWORD: "legacy-postgres-password",
      POSTGRES_DATA_PATH: "/var/lib/docker/volumes/postgres/_data",
      REDIS_DATA_PATH: "/var/lib/docker/volumes/redis/_data",
      PROVISION_SSH_PATH: "/var/lib/docker/volumes/provision-ssh/_data",
    });
  });

  it("does not rename containers already managed by the self-hosted compose project", () => {
    const inspect = parseInspectJson(JSON.stringify([
      {
        Name: "/anixops-audit-api",
        Config: {
          Labels: {
            "com.docker.compose.project": "anixops-selfhosted",
          },
        },
      },
      {
        Name: "/anixops-ui-audit",
        Config: {
          Labels: {
            "com.docker.compose.project": "legacy-stack",
          },
        },
      },
      {
        Name: "/anixops-audit-postgres",
        Config: {
          Labels: {},
        },
      },
    ]));

    expect(filterUnmanagedContainers(inspect, [
      "anixops-audit-api",
      "anixops-ui-audit",
      "anixops-audit-postgres",
    ])).toEqual([
      "anixops-ui-audit",
      "anixops-audit-postgres",
    ]);
  });

  it("serializes env entries deterministically", () => {
    expect(serializeEnvEntries({
      B: "2",
      A: "1",
    })).toBe("A=1\nB=2\n");
  });

  it("formats byte sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
  });
});
