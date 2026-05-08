import type { RentalProtocol } from "./pricing.js";

export const SUPPORTED_PROVIDERS = ["vultr", "digitalocean", "aws"] as const;
export type SupportedProvider = typeof SUPPORTED_PROVIDERS[number];

export const PROVIDER_LABELS: Record<SupportedProvider, string> = {
  vultr: "Vultr",
  digitalocean: "DigitalOcean",
  aws: "AWS EC2",
};

export const PROVIDER_REQUIRED_ENV_KEYS: Record<SupportedProvider, string[]> = {
  vultr: ["VULTR_API_KEY"],
  digitalocean: ["DIGITALOCEAN_TOKEN"],
  aws: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SECURITY_GROUP_ID"],
};

function getProviderCredentialValue(key: string, source: NodeJS.ProcessEnv) {
  if (key === "DIGITALOCEAN_TOKEN") {
    return source.DIGITALOCEAN_TOKEN || source.DO_API_TOKEN;
  }
  return source[key];
}

export type CatalogRuntimeConfig = {
  provider: string;
  region: string;
  plan: string;
};

export type CatalogRegion = {
  id: string;
  provider: string;
  providerLabel: string;
  label: string;
  city: string;
  country: string;
  protocols: RentalProtocol[];
  defaultPlan: string;
  status: string;
  current: boolean;
};

export type CatalogPlan = {
  id: string;
  provider: string;
  providerLabel: string;
  region: string;
  label: string;
  protocols: RentalProtocol[];
  durations: Array<{
    durationHours: number;
    durationMinutes: number;
    pricePerHour: number;
    totalPrice: number;
    currency: string;
  }>;
  status: string;
  current: boolean;
};

export type ProviderRegionStatus = "available" | "disabled" | "degraded";

export type ProviderRegionOverride = {
  status: ProviderRegionStatus;
  reason: string | null;
  updatedAt: string;
  updatedBy: string | null;
};

export type RentalStatusCountRow = {
  status: string | null;
  count: number | string | null;
};

export type ProvisionAttemptCapacityRow = {
  provider: string | null;
  region: string | null;
  plan: string | null;
  status: string | null;
  count: number | string | null;
  cloudCostAmount?: number | string | null;
};

export type RentalPlacementCapacityRow = ProvisionAttemptCapacityRow;

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function parseCsv(value: string | undefined): string[] {
  return unique(
    (value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function toPositiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toRatio(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

function toCount(value: number | string | null | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toMoney(value: number | string | null | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

export function isPlaceholderEnvValue(value: string | undefined): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  return (
    normalized === "" ||
    normalized.startsWith("change-me") ||
    normalized.startsWith("changeme") ||
    normalized.startsWith("your-") ||
    normalized.endsWith("_")
  );
}

export function normalizeProviderId(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

export function isSupportedProvider(value: string | null | undefined): value is SupportedProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(normalizeProviderId(value));
}

export function getProviderRegionOverrideKey(provider: string, region: string) {
  return `admin:provider-region:${normalizeProviderId(provider)}:${region.trim()}`;
}

export function normalizeProviderRegionOverride(
  value: unknown,
  fallbackUpdatedAt = new Date().toISOString(),
): ProviderRegionOverride | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const status = record.status === "disabled" || record.status === "degraded" ? record.status : "available";
  const reason = typeof record.reason === "string" && record.reason.trim() ? record.reason.trim().slice(0, 240) : null;
  const updatedAt = typeof record.updatedAt === "string" && record.updatedAt.trim()
    ? record.updatedAt
    : fallbackUpdatedAt;
  const updatedBy = typeof record.updatedBy === "string" && record.updatedBy.trim()
    ? record.updatedBy.trim().slice(0, 160)
    : null;

  return { status, reason, updatedAt, updatedBy };
}

export function buildProviderRegionOverride(input: {
  status?: unknown;
  enabled?: unknown;
  reason?: unknown;
  updatedBy?: string | null;
  now?: Date;
}): ProviderRegionOverride {
  const requestedStatus = typeof input.status === "string" ? input.status.trim().toLowerCase() : "";
  const status: ProviderRegionStatus = input.enabled === false || requestedStatus === "disabled"
    ? "disabled"
    : requestedStatus === "degraded"
      ? "degraded"
      : "available";

  return {
    status,
    reason: typeof input.reason === "string" && input.reason.trim() ? input.reason.trim().slice(0, 240) : null,
    updatedAt: (input.now || new Date()).toISOString(),
    updatedBy: input.updatedBy || null,
  };
}

export function buildProviderCredentialSummaries(source: NodeJS.ProcessEnv = process.env) {
  return SUPPORTED_PROVIDERS.map((id) => {
    const credentials = PROVIDER_REQUIRED_ENV_KEYS[id].map((key) => ({
      key,
      configured: !isPlaceholderEnvValue(getProviderCredentialValue(key, source)),
    }));

    return {
      id,
      label: PROVIDER_LABELS[id],
      current: normalizeProviderId(source.CLOUD_PROVIDER || "vultr") === id,
      configured: credentials.every((credential) => credential.configured),
      credentials,
    };
  });
}

export function buildRuntimeProviderSettings(source: NodeJS.ProcessEnv = process.env) {
  const probeServiceUrl = source.PROBE_SERVICE_URL || source.MAINLAND_PROBE_SERVICE_URL;
  const probeToken = source.PROBE_SERVICE_TOKEN || source.MAINLAND_PROBE_TOKEN || source.PROVISION_SERVER_TOKEN;
  const managedProbeProvider = normalizeProviderId(source.PROBE_PROVIDER || source.MAINLAND_PROBE_PROVIDER || "");
  const disguiseDomains = parseCsv(source.DISGUISE_DOMAINS || source.REALITY_SERVER_NAMES || "addons.mozilla.org");

  return {
    install: {
      mode: (source.INSTALL_MODE || source.PROVISION_INSTALL_MODE || "cloud-init-preferred").trim(),
    },
    probe: {
      enabled: ["1", "true", "yes", "on"].includes(String(source.PROBE_ENABLED || source.MAINLAND_PROBE_ENABLED || "").toLowerCase())
        || Boolean(probeServiceUrl),
      serviceConfigured: Boolean(probeServiceUrl),
      tokenConfigured: !isPlaceholderEnvValue(probeToken),
      managedProvider: managedProbeProvider || null,
      managedCountry: typeof source.PROBE_GLOBALPING_COUNTRY === "string" && source.PROBE_GLOBALPING_COUNTRY.trim()
        ? source.PROBE_GLOBALPING_COUNTRY.trim().toUpperCase()
        : null,
      eyeballBias: !["0", "false", "no", "off"].includes(String(source.PROBE_GLOBALPING_EYEBALL_BIAS || "true").toLowerCase()),
      timeoutMs: toPositiveNumber(source.PROBE_TIMEOUT_MS || source.MAINLAND_PROBE_TIMEOUT_MS, 5000),
      minNodes: toPositiveNumber(source.PROBE_MIN_NODES || source.MAINLAND_PROBE_MIN_NODES, 3),
      passRatio: toRatio(source.PROBE_PASS_RATIO || source.MAINLAND_PROBE_PASS_RATIO, 0.7),
    },
    disguise: {
      domainCount: disguiseDomains.length,
      defaultDomain: disguiseDomains[0] || null,
    },
  };
}

export function applyRegionOverrides<T extends { provider: string; id: string; status: string }>(
  regions: T[],
  overrides: Record<string, ProviderRegionOverride | null | undefined>,
  options: { includeDisabled?: boolean } = {},
): Array<T & { override: ProviderRegionOverride | null }> {
  return regions
    .map((region) => {
      const override = overrides[getProviderRegionOverrideKey(region.provider, region.id)] || null;
      return {
        ...region,
        status: override?.status || region.status,
        override,
      };
    })
    .filter((region) => options.includeDisabled || region.status !== "disabled");
}

export function filterPlansForAvailableRegions<T extends { provider: string; region: string; status: string }>(
  plans: T[],
  overrides: Record<string, ProviderRegionOverride | null | undefined>,
) {
  return plans
    .map((plan) => {
      const override = overrides[getProviderRegionOverrideKey(plan.provider, plan.region)] || null;
      return {
        ...plan,
        status: override?.status === "disabled" ? "disabled" : plan.status,
        regionOverride: override,
      };
    })
    .filter((plan) => plan.status !== "disabled");
}

export function buildAdminProvidersPayload(input: {
  config: CatalogRuntimeConfig;
  regions: CatalogRegion[];
  plans: CatalogPlan[];
  overrides?: Record<string, ProviderRegionOverride | null | undefined>;
  source?: NodeJS.ProcessEnv;
}) {
  const source = input.source || process.env;
  const overrides = input.overrides || {};
  const regions = applyRegionOverrides(input.regions, overrides, { includeDisabled: true });
  const plans = input.plans.map((plan) => ({
    ...plan,
    regionOverride: overrides[getProviderRegionOverrideKey(plan.provider, plan.region)] || null,
  }));

  return {
    current: input.config,
    providers: buildProviderCredentialSummaries(source),
    catalog: {
      regions,
      plans,
    },
    settings: buildRuntimeProviderSettings(source),
    generatedAt: new Date().toISOString(),
  };
}

export function buildAdminCapacityPayload(input: {
  config: CatalogRuntimeConfig;
  statusCounts: RentalStatusCountRow[];
  attemptRows: ProvisionAttemptCapacityRow[];
  rentalPlacementRows?: RentalPlacementCapacityRow[];
  queueCounts?: Record<string, number | string | undefined>;
}) {
  const statusCounts = Object.fromEntries(
    input.statusCounts.map((row) => [row.status || "unknown", toCount(row.count)]),
  );
  const activeStatuses = ["pending", "provisioning", "probing", "configuring", "active", "destroying"];
  const activeLike = activeStatuses.reduce((sum, status) => sum + (statusCounts[status] || 0), 0);
  const attemptBuckets = new Map<string, {
    provider: string;
    region: string;
    plan: string;
    attempts: Record<string, number>;
    totalAttempts: number;
    cloudCostTotal: number;
  }>();

  for (const row of input.attemptRows) {
    const provider = row.provider || input.config.provider;
    const region = row.region || input.config.region;
    const plan = row.plan || input.config.plan;
    const key = `${provider}:${region}:${plan}`;
    const bucket = attemptBuckets.get(key) || {
      provider,
      region,
      plan,
      attempts: {},
      totalAttempts: 0,
      cloudCostTotal: 0,
    };
    const status = row.status || "unknown";
    const count = toCount(row.count);
    bucket.attempts[status] = (bucket.attempts[status] || 0) + count;
    bucket.totalAttempts += count;
    bucket.cloudCostTotal = toMoney(bucket.cloudCostTotal + toMoney(row.cloudCostAmount));
    attemptBuckets.set(key, bucket);
  }

  const buckets = Array.from(attemptBuckets.values());
  const currentBucket = buckets.find((bucket) =>
    bucket.provider === input.config.provider &&
    bucket.region === input.config.region &&
    bucket.plan === input.config.plan
  );
  const rentalPlacementBuckets = new Map<string, {
    provider: string;
    region: string;
    plan: string;
    rentalStatusCounts: Record<string, number>;
    totalRentals: number;
  }>();
  for (const row of input.rentalPlacementRows || []) {
    const provider = row.provider || input.config.provider;
    const region = row.region || input.config.region;
    const plan = row.plan || input.config.plan;
    const key = `${provider}:${region}:${plan}`;
    const bucket = rentalPlacementBuckets.get(key) || {
      provider,
      region,
      plan,
      rentalStatusCounts: {},
      totalRentals: 0,
    };
    const status = row.status || "unknown";
    const count = toCount(row.count);
    bucket.rentalStatusCounts[status] = (bucket.rentalStatusCounts[status] || 0) + count;
    bucket.totalRentals += count;
    rentalPlacementBuckets.set(key, bucket);
  }
  const placementBuckets = Array.from(rentalPlacementBuckets.values());
  const currentPlacement = placementBuckets.find((bucket) =>
    bucket.provider === input.config.provider &&
    bucket.region === input.config.region &&
    bucket.plan === input.config.plan
  );
  const currentStatusCounts = currentPlacement?.rentalStatusCounts || statusCounts;
  const currentActiveLike = activeStatuses.reduce((sum, status) => sum + (currentStatusCounts[status] || 0), 0);

  return {
    mode: placementBuckets.length > 0 ? "rental-placement-persisted" : "runtime-single-catalog",
    current: {
      provider: input.config.provider,
      region: input.config.region,
      plan: input.config.plan,
      rentalStatusCounts: currentStatusCounts,
      activeLikeRentals: currentActiveLike,
      provisioningRentals: currentStatusCounts.provisioning || 0,
      activeRentals: currentStatusCounts.active || 0,
      destroyingRentals: currentStatusCounts.destroying || 0,
      failedRentals: currentStatusCounts.failed || 0,
      attempts: currentBucket?.attempts || {},
      totalAttempts: currentBucket?.totalAttempts || 0,
      cloudCostTotal: currentBucket?.cloudCostTotal || 0,
      cloudCostCurrency: "usd",
    },
    buckets,
    rentalPlacements: placementBuckets,
    queue: input.queueCounts
      ? Object.fromEntries(Object.entries(input.queueCounts).map(([key, value]) => [key, toCount(value ?? 0)]))
      : null,
    compatibilityNote: placementBuckets.length > 0
      ? null
      : "rentals.provider/region/plan are not persisted yet; rental status counts are mapped to the current runtime catalog.",
    generatedAt: new Date().toISOString(),
  };
}
