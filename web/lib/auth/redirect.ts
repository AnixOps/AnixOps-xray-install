export function normalizeReturnToPath(value: string | null | undefined, fallback = "/"): string {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return fallback;
  }
  if (!normalized.startsWith("/") || normalized.startsWith("//") || normalized.includes("://")) {
    return fallback;
  }
  return normalized;
}
