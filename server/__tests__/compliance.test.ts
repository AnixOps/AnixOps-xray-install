import { beforeAll, describe, expect, it } from "vitest";

let buildCompliancePolicyPayload: typeof import("../src/compliance.js").buildCompliancePolicyPayload;
let formatComplianceProfile: typeof import("../src/compliance.js").formatComplianceProfile;
let normalizeComplianceProfileId: typeof import("../src/compliance.js").normalizeComplianceProfileId;
let validateProtocolForCompliance: typeof import("../src/compliance.js").validateProtocolForCompliance;

beforeAll(async () => {
  process.env.DATABASE_URL ||= "postgresql://anixops:test@localhost:5432/anixops";
  process.env.REDIS_URL ||= "redis://localhost:6379";
  ({
    buildCompliancePolicyPayload,
    formatComplianceProfile,
    normalizeComplianceProfileId,
    validateProtocolForCompliance,
  } = await import("../src/compliance.js"));
});

describe("compliance helpers", () => {
  it("normalizes profile ids", () => {
    expect(normalizeComplianceProfileId(" restricted-egress ")).toBe("restricted-egress");
    expect(normalizeComplianceProfileId("../bad")).toBeNull();
  });

  it("blocks protocols listed by a profile", () => {
    const profile = {
      id: "restricted-egress",
      name: "Restricted",
      mode: "restricted" as const,
      version: "v1",
      description: null,
      allowedPorts: [53, 80, 443],
      allowedCidrs: ["0.0.0.0/0"],
      blockedProtocols: ["hysteria2"],
      isDefault: false,
      status: "active",
    };

    expect(validateProtocolForCompliance("hysteria2", profile)).toEqual({
      ok: false,
      error: "hysteria2 is disabled by compliance profile restricted-egress",
    });
    expect(validateProtocolForCompliance("vless-reality", profile)).toEqual({ ok: true });
    expect(buildCompliancePolicyPayload(profile)).toEqual({
      profileId: "restricted-egress",
      version: "v1",
      mode: "restricted",
      allowedPorts: [53, 80, 443],
      allowedCidrs: ["0.0.0.0/0"],
      blockedProtocols: ["hysteria2"],
    });
  });

  it("formats persisted profile rows for the UI", () => {
    const row = {
      id: "restricted-egress",
      name: "Restricted",
      mode: "restricted",
      version: "2026-05-07.restricted.v1",
      description: "Compliance-oriented profile",
      allowedPorts: JSON.stringify([53, 80, 443]),
      allowedCidrs: JSON.stringify(["0.0.0.0/0"]),
      blockedProtocols: JSON.stringify(["hysteria2"]),
      isDefault: false,
      status: "active",
    } as Parameters<typeof formatComplianceProfile>[0];

    expect(formatComplianceProfile(row)).toEqual({
      id: "restricted-egress",
      name: "Restricted",
      mode: "restricted",
      version: "2026-05-07.restricted.v1",
      description: "Compliance-oriented profile",
      allowedPorts: [53, 80, 443],
      allowedCidrs: ["0.0.0.0/0"],
      blockedProtocols: ["hysteria2"],
      isDefault: false,
      status: "active",
    });
  });
});
