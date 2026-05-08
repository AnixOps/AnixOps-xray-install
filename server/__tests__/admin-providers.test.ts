import { describe, expect, it } from "vitest";
import {
  applyRegionOverrides,
  buildAdminCapacityPayload,
  buildAdminProvidersPayload,
  buildProviderRegionOverride,
  filterPlansForAvailableRegions,
  getProviderRegionOverrideKey,
} from "../src/admin-providers.js";
import { buildCatalogPlans, buildCatalogRegions } from "../src/catalog.js";

describe("admin provider helpers", () => {
  const config = { provider: "vultr", region: "nrt", plan: "vhf-1c-1gb" };

  it("summarizes provider credentials without exposing secret values", () => {
    const payload = buildAdminProvidersPayload({
      config,
      regions: buildCatalogRegions(config),
      plans: buildCatalogPlans(config),
      source: {
        CLOUD_PROVIDER: "vultr",
        VULTR_API_KEY: "real-vultr-token",
        DIGITALOCEAN_TOKEN: "your-digitalocean-token",
        AWS_ACCESS_KEY_ID: "aws-key",
        AWS_SECRET_ACCESS_KEY: "aws-secret",
        AWS_SECURITY_GROUP_ID: "sg-123",
      } as NodeJS.ProcessEnv,
    });

    expect(payload.providers.find((provider) => provider.id === "vultr")).toEqual(expect.objectContaining({
      configured: true,
      current: true,
    }));
    expect(payload.providers.find((provider) => provider.id === "digitalocean")).toEqual(expect.objectContaining({
      configured: false,
    }));
    expect(JSON.stringify(payload)).not.toContain("real-vultr-token");
    expect(JSON.stringify(payload)).not.toContain("aws-secret");
  });

  it("applies disabled region overrides to public catalog views", () => {
    const key = getProviderRegionOverrideKey("vultr", "nrt");
    const overrides = {
      [key]: buildProviderRegionOverride({
        status: "disabled",
        reason: "bad IP rate",
        now: new Date("2026-05-06T12:00:00.000Z"),
      }),
    };

    expect(applyRegionOverrides(buildCatalogRegions(config), overrides)).toEqual([]);
    expect(filterPlansForAvailableRegions(buildCatalogPlans(config), overrides)).toEqual([]);
    expect(applyRegionOverrides(buildCatalogRegions(config), overrides, { includeDisabled: true })[0]).toEqual(
      expect.objectContaining({
        id: "nrt",
        status: "disabled",
        override: expect.objectContaining({ reason: "bad IP rate" }),
      }),
    );
  });

  it("treats legacy DO_API_TOKEN as a configured DigitalOcean credential", () => {
    const payload = buildAdminProvidersPayload({
      config,
      regions: buildCatalogRegions(config),
      plans: buildCatalogPlans(config),
      source: {
        CLOUD_PROVIDER: "digitalocean",
        DO_API_TOKEN: "legacy-do-token",
      } as NodeJS.ProcessEnv,
    });

    expect(payload.providers.find((provider) => provider.id === "digitalocean")).toEqual(expect.objectContaining({
      configured: true,
      current: true,
    }));
  });

  it("builds capacity from runtime catalog and structured attempts", () => {
    const payload = buildAdminCapacityPayload({
      config,
      statusCounts: [
        { status: "active", count: 3 },
        { status: "provisioning", count: "2" },
        { status: "failed", count: 1 },
      ],
      attemptRows: [
        { provider: "vultr", region: "nrt", plan: "vhf-1c-1gb", status: "succeeded", count: 3 },
        { provider: "vultr", region: "nrt", plan: "vhf-1c-1gb", status: "failed_destroyed", count: 2, cloudCostAmount: 0.02 },
      ],
      queueCounts: { waiting: 1, active: "2" },
    });

    expect(payload.mode).toBe("runtime-single-catalog");
    expect(payload.current.activeLikeRentals).toBe(5);
    expect(payload.current.attempts).toEqual({ succeeded: 3, failed_destroyed: 2 });
    expect(payload.current.cloudCostTotal).toBe(0.02);
    expect(payload.queue).toEqual({ waiting: 1, active: 2 });
  });

  it("uses persisted rental placement buckets when available", () => {
    const payload = buildAdminCapacityPayload({
      config,
      statusCounts: [{ status: "active", count: 9 }],
      attemptRows: [],
      rentalPlacementRows: [
        { provider: "vultr", region: "nrt", plan: "vhf-1c-1gb", status: "active", count: 2 },
        { provider: "vultr", region: "nrt", plan: "vhf-1c-1gb", status: "failed", count: 1 },
        { provider: "aws", region: "ap-northeast-1", plan: "t4g.nano", status: "active", count: 4 },
      ],
    });

    expect(payload.mode).toBe("rental-placement-persisted");
    expect(payload.current.rentalStatusCounts).toEqual({ active: 2, failed: 1 });
    expect(payload.current.activeLikeRentals).toBe(2);
    expect(payload.rentalPlacements).toHaveLength(2);
    expect(payload.compatibilityNote).toBeNull();
  });
});
