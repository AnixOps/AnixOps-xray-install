export const PROVIDER_STARTUP_COSTS_USD: Record<string, number> = {
  vultr: 0.01,
};

export function getProviderStartupCostUsd(provider: string | null | undefined) {
  const normalized = String(provider || "").trim().toLowerCase();
  return PROVIDER_STARTUP_COSTS_USD[normalized] || 0;
}
