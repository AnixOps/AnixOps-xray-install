import { NextResponse } from "next/server";
import { API_URL, buildNoStoreHeaders, fetchWithProxyTimeout, getProxyErrorDetail } from "../proxy-utils";

export { buildNoStoreHeaders };

export function buildAdminHeaders(request: Request, contentType?: string) {
  const headers = new Headers();
  const auth = request.headers.get("Authorization");
  const apiSecret = request.headers.get("X-API-Secret");
  if (auth) headers.set("Authorization", auth);
  if (apiSecret) headers.set("X-API-Secret", apiSecret);
  if (contentType) headers.set("Content-Type", contentType);
  return headers;
}

export async function proxyAdminRequest(path: string, request: Request, init: RequestInit = {}) {
  try {
    const res = await fetchWithProxyTimeout(`${API_URL}${path}`, {
      ...init,
      headers: init.headers || buildAdminHeaders(request),
      cache: "no-store",
    });
    const text = await res.text();
    const contentType = res.headers.get("Content-Type") || "application/json";
    if (!text.trim()) {
      return NextResponse.json(
        { error: `Admin API returned an empty response (${res.status})` },
        { status: res.ok ? 502 : res.status, headers: buildNoStoreHeaders("application/json") },
      );
    }
    if (!contentType.toLowerCase().includes("json")) {
      return NextResponse.json(
        { error: text || `Admin API request failed (${res.status})`, upstreamStatus: res.status },
        { status: res.status, headers: buildNoStoreHeaders("application/json") },
      );
    }
    return new NextResponse(text, {
      status: res.status,
      headers: buildNoStoreHeaders(contentType),
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Admin API unavailable", detail: getProxyErrorDetail(error) },
      { status: 502, headers: buildNoStoreHeaders("application/json") },
    );
  }
}
