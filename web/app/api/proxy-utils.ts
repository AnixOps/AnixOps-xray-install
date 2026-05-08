export const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_WORKER_URL || "http://127.0.0.1:8787";

const DEFAULT_PROXY_TIMEOUT_MS = 15000;

export function getProxyTimeoutMs(value = process.env.API_PROXY_TIMEOUT_MS): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PROXY_TIMEOUT_MS;
}

export function buildNoStoreHeaders(contentType: string) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
    "Surrogate-Control": "no-store",
  };
}

export async function fetchWithProxyTimeout(url: string, init: RequestInit = {}, timeoutMs = getProxyTimeoutMs()) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function getProxyErrorDetail(error: unknown, timeoutMs = getProxyTimeoutMs()) {
  if (error instanceof Error && error.name === "AbortError") {
    return `Upstream request timed out after ${timeoutMs}ms`;
  }
  return error instanceof Error ? error.message : "Unknown network error";
}
