import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildBaselineArgs,
  buildDeployArgs,
  buildInitEnvArgs,
  buildLocalDoctorArgs,
  buildRemoteDoctorArgs,
  parseArgs,
  resolveWorkingEnvFile,
} = require("./selfhosted-cutover.js");

describe("self-hosted cutover helpers", () => {
  it("parses CLI arguments", () => {
    expect(parseArgs([
      "--provider",
      "vultr",
      "--env-file",
      ".env.prod",
      "--remote-dir",
      "/srv/anixops",
      "--baseline-out",
      "docs/baseline.json",
      "--admin-email",
      "ops@example.com",
      "--vultr-api-key",
      "token",
      "--dry-run",
      "--skip-baseline",
      "--skip-local-doctor",
      "--skip-postcheck",
    ])).toEqual({
      provider: "vultr",
      envFile: ".env.prod",
      remoteDir: "/srv/anixops",
      baselineOut: "docs/baseline.json",
      frontendUrl: "",
      allowedOrigins: "",
      adminEmail: "ops@example.com",
      vultrApiKey: "token",
      digitaloceanToken: "",
      awsAccessKeyId: "",
      awsSecretAccessKey: "",
      awsRegion: "",
      awsSecurityGroupId: "",
      skipBaseline: true,
      skipLocalDoctor: true,
      skipPostcheck: true,
      dryRun: true,
    });
  });

  it("builds init-env args", () => {
    const args = buildInitEnvArgs({
      provider: "vultr",
      envFile: ".env.selfhosted",
      frontendUrl: "http://localhost:30000",
      allowedOrigins: "http://localhost:30000",
      adminEmail: "ops@example.com",
      vultrApiKey: "token",
      digitaloceanToken: "",
      awsAccessKeyId: "",
      awsSecretAccessKey: "",
      awsRegion: "",
      awsSecurityGroupId: "",
      dryRun: true,
    });

    expect(args).toEqual([
      "scripts/selfhosted-init-env.js",
      "--out",
      ".env.selfhosted",
      "--provider",
      "vultr",
      "--frontend-url",
      "http://localhost:30000",
      "--allowed-origins",
      "http://localhost:30000",
      "--admin-email",
      "ops@example.com",
      "--vultr-api-key",
      "token",
    ]);
  });

  it("builds baseline, doctor, and deploy args", () => {
    expect(buildBaselineArgs({ baselineOut: "docs/baseline.json" })).toEqual([
      "scripts/remote-baseline.js",
      "--out",
      "docs/baseline.json",
    ]);

    expect(buildLocalDoctorArgs({ envFile: ".env.selfhosted" })).toEqual([
      "scripts/selfhosted-doctor.js",
      "--file",
      ".env.selfhosted",
      "--strict",
    ]);

    expect(buildDeployArgs({
      envFile: ".env.selfhosted",
      remoteDir: "/opt/anixops-selfhosted",
      dryRun: true,
    })).toEqual([
      "scripts/selfhosted-deploy.js",
      "--file",
      ".env.selfhosted",
      "--remote-dir",
      "/opt/anixops-selfhosted",
      "--replace-live",
      "--dry-run",
    ]);

    expect(buildRemoteDoctorArgs()).toEqual([
      "scripts/selfhosted-doctor.js",
      "--remote",
      "--strict",
    ]);
  });

  it("uses a temp env file during dry-run cutover", () => {
    const pathValue = resolveWorkingEnvFile({
      dryRun: true,
      envFile: ".env.selfhosted",
    });

    expect(pathValue).toBe(".env.selfhosted.cutover.tmp");
  });
});
