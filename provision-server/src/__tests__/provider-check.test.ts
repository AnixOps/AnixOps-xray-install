import { describe, expect, it } from "vitest";
import { checkProviderAccess, normalizeProviderCheckRequest } from "../provider-check";

describe("provider check helpers", () => {
  it("uses explicit provider, region, and plan when provided", () => {
    expect(normalizeProviderCheckRequest({
      provider: "DigitalOcean",
      region: "sgp1",
      plan: "s-1vcpu-1gb",
    })).toEqual({
      provider: "digitalocean",
      region: "sgp1",
      plan: "s-1vcpu-1gb",
    });
  });

  it("defaults AWS checks to AWS_REGION before VPS_REGION", () => {
    expect(normalizeProviderCheckRequest({ provider: "aws" }, {
      AWS_REGION: "ap-northeast-1",
      VPS_REGION: "nrt",
      VPS_PLAN: "t4g.nano",
    } as NodeJS.ProcessEnv)).toEqual({
      provider: "aws",
      region: "ap-northeast-1",
      plan: "t4g.nano",
    });
  });

  it("returns a failed provider-check result for unsupported providers", async () => {
    const result = await checkProviderAccess({ provider: "linode", region: "tokyo", plan: "nanode" });

    expect(result.ok).toBe(false);
    expect(result.provider).toBe("linode");
    expect(result.region).toBe("tokyo");
    expect(result.plan).toBe("nanode");
    expect(result.stageLogs.at(-1)).toEqual(expect.objectContaining({
      status: "failed",
      meta: expect.objectContaining({
        provider: "linode",
        region: "tokyo",
        plan: "nanode",
      }),
    }));
  });
});
