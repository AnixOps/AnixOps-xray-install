import { VALID_RENTAL_DURATIONS, PRICING, type RentalProtocol } from "./pricing.js";

const PROVIDER_LABELS: Record<string, string> = {
  vultr: "Vultr",
  digitalocean: "DigitalOcean",
  aws: "AWS EC2",
};

const REGION_LABELS: Record<string, { city: string; country: string; label: string }> = {
  nrt: { city: "Tokyo", country: "JP", label: "Tokyo" },
  sgp: { city: "Singapore", country: "SG", label: "Singapore" },
  sin: { city: "Singapore", country: "SG", label: "Singapore" },
  lax: { city: "Los Angeles", country: "US", label: "Los Angeles" },
  sea: { city: "Seattle", country: "US", label: "Seattle" },
  fra: { city: "Frankfurt", country: "DE", label: "Frankfurt" },
  "ap-northeast-1": { city: "Tokyo", country: "JP", label: "Tokyo" },
  "ap-southeast-1": { city: "Singapore", country: "SG", label: "Singapore" },
  "us-east-1": { city: "N. Virginia", country: "US", label: "N. Virginia" },
  "us-west-2": { city: "Oregon", country: "US", label: "Oregon" },
  "eu-central-1": { city: "Frankfurt", country: "DE", label: "Frankfurt" },
};

export function getCatalogRuntimeConfig(source: NodeJS.ProcessEnv = process.env) {
  const provider = (source.CLOUD_PROVIDER || "vultr").trim().toLowerCase();
  const region = (source.VPS_REGION || "nrt").trim();
  const plan = (source.VPS_PLAN || "vhf-1c-1gb").trim();

  return { provider, region, plan };
}

export function getCatalogRegionPool(source: NodeJS.ProcessEnv = process.env, fallback = source.VPS_REGION || "nrt") {
  const fallbackRegion = fallback.trim() || "nrt";
  const raw = source.VPS_REGION_POOL || source.PROVISION_REGION_POOL || fallbackRegion;
  const regions = raw
    .split(",")
    .map((region) => region.trim())
    .filter((region) => /^[A-Za-z0-9._-]{1,80}$/.test(region));
  return [...new Set(regions.length > 0 ? regions : [fallbackRegion])];
}

export function buildCatalogRegions(config = getCatalogRuntimeConfig(), source: NodeJS.ProcessEnv = process.env) {
  return getCatalogRegionPool(source, config.region).map((region) => {
    const regionMeta = REGION_LABELS[region] || {
      city: region,
      country: "",
      label: region,
    };

    return {
      id: region,
      provider: config.provider,
      providerLabel: PROVIDER_LABELS[config.provider] || config.provider,
      label: regionMeta.label,
      city: regionMeta.city,
      country: regionMeta.country,
      protocols: ["vless-reality", "hysteria2"] satisfies RentalProtocol[],
      defaultPlan: config.plan,
      status: "available",
      current: region === config.region,
      automatic: true,
    };
  });
}

export function buildCatalogPlans(config = getCatalogRuntimeConfig(), source: NodeJS.ProcessEnv = process.env) {
  return getCatalogRegionPool(source, config.region).map((region) => ({
    id: config.plan,
    provider: config.provider,
    providerLabel: PROVIDER_LABELS[config.provider] || config.provider,
    region,
    label: config.plan,
    protocols: ["vless-reality", "hysteria2"] satisfies RentalProtocol[],
    durations: VALID_RENTAL_DURATIONS.map((hours) => ({
      durationHours: hours,
      durationMinutes: hours * 60,
      pricePerHour: PRICING[hours].pricePerHour,
      totalPrice: PRICING[hours].totalPrice,
      currency: "usd",
    })),
    status: "available",
    current: region === config.region,
    automatic: true,
  }));
}
