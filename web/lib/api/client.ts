// API client for Cloudflare Worker endpoints
// In production on same-domain Pages+Worker deployment, this resolves to relative paths.
// For local dev, set NEXT_PUBLIC_WORKER_URL=http://127.0.0.1:8787
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || "";

export async function workerFetch(path: string, options: RequestInit = {}) {
  const url = `${WORKER_URL}${path}`;
  const res = await fetch(url, options);
  return res;
}
