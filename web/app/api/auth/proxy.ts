import { NextResponse } from "next/server";
import { API_URL, buildNoStoreHeaders, fetchWithProxyTimeout, getProxyErrorDetail } from "../proxy-utils";

export async function proxyAuthRequest(path: string, init: RequestInit = {}) {
  try {
    const res = await fetchWithProxyTimeout(`${API_URL}${path}`, {
      ...init,
      cache: "no-store",
    });
    const text = await res.text();
    const contentType = res.headers.get("Content-Type") || "application/json";

    if (!text.trim()) {
      return NextResponse.json(
        { error: `Auth service returned an empty response (${res.status})` },
        { status: res.ok ? 502 : res.status, headers: buildNoStoreHeaders("application/json") },
      );
    }

    return new NextResponse(text, {
      status: res.status,
      headers: buildNoStoreHeaders(contentType),
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Auth service unavailable", detail: getProxyErrorDetail(error) },
      { status: 502, headers: buildNoStoreHeaders("application/json") },
    );
  }
}
