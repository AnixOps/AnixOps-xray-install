import { VALID_RENTAL_DURATIONS, PRICING, type RentalProtocol } from "./pricing.js";

const PROVIDER_LABELS: Record<string, string> = {
  vultr: "Vultr",
  digitalocean: "DigitalOcean",
  aws: "AWS EC2",
};

const REGION_LABELS: Record<string, { city: string; country: string; label: string }> = {
  nrt: { city: "Tokyo", country: "JP", label: "Tokyo" },
  sgp: { city: "Singapore", country: "SG", label: "Singapore" },
  lax: { city: "Los Angeles", country: "US", label: "Los Angeles" },
  "ap-northeast-1": { city: "Tokyo", country: "JP", label: "Tokyo" },
  "ap-southeast-1": { city: "Singapore", country: "SG", label: "Singapore" },
  "us-east-1": { city: "N. Virginia", country: "US", label: "N. Virginia" },
};

export function getCatalogRuntimeConfig(source: NodeJS.ProcessEnv = process.env) {
  const provider = (source.CLOUD_PROVIDER || "vultr").trim().toLowerCase();
  const region = (source.VPS_REGION || "nrt").trim();
  const plan = (source.VPS_PLAN || "vhf-1c-1gb").trim();

  return { provider, region, plan };
}

export function buildCatalogRegions(config = getCatalogRuntimeConfig()) {
  const regionMeta = REGION_LABELS[config.region] || {
    city: config.region,
    country: "",
    label: config.region,
  };

  return [{
    id: config.region,
    provider: config.provider,
    providerLabel: PROVIDER_LABELS[config.provider] || config.provider,
    label: regionMeta.label,
    city: regionMeta.city,
    country: regionMeta.country,
    protocols: ["vless-reality", "hysteria2"] satisfies RentalProtocol[],
    defaultPlan: config.plan,
    status: "available",
    current: true,
  }];
}

export function buildCatalogPlans(config = getCatalogRuntimeConfig()) {
  return [{
    id: config.plan,
    provider: config.provider,
    providerLabel: PROVIDER_LABELS[config.provider] || config.provider,
    region: config.region,
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
    current: true,
  }];
}
