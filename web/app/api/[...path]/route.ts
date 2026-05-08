import { NextResponse } from "next/server";
import { API_URL, buildNoStoreHeaders, fetchWithProxyTimeout, getProxyErrorDetail } from "../proxy-utils";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

function copyRequestHeaders(request: Request) {
  const headers = new Headers();
  const authorization = request.headers.get("Authorization");
  const contentType = request.headers.get("Content-Type");
  const accept = request.headers.get("Accept");
  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (authorization) headers.set("Authorization", authorization);
  if (contentType) headers.set("Content-Type", contentType);
  if (accept) headers.set("Accept", accept);
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  return headers;
}

async function proxyToApi(request: Request, context: RouteContext) {
  const { path } = await context.params;
  const sourceUrl = new URL(request.url);
  const targetUrl = `${API_URL}/api/${path.join("/")}${sourceUrl.search}`;
  const method = request.method.toUpperCase();

  try {
    const body = method === "GET" || method === "HEAD" ? undefined : await request.text();
    const upstream = await fetchWithProxyTimeout(targetUrl, {
      method,
      headers: copyRequestHeaders(request),
      body,
      cache: "no-store",
      redirect: "manual",
    });
    const text = await upstream.text();
    const contentType = upstream.headers.get("Content-Type") || "application/json";

    if (!text.trim()) {
      return NextResponse.json(
        { error: `API service returned an empty response (${upstream.status})` },
        { status: upstream.ok ? 502 : upstream.status, headers: buildNoStoreHeaders("application/json") },
      );
    }

    return new NextResponse(text, {
      status: upstream.status,
      headers: buildNoStoreHeaders(contentType),
    });
  } catch (error) {
    return NextResponse.json(
      { error: "API service unavailable", detail: getProxyErrorDetail(error) },
      { status: 502, headers: buildNoStoreHeaders("application/json") },
    );
  }
}

export const GET = proxyToApi;
export const POST = proxyToApi;
export const PUT = proxyToApi;
export const PATCH = proxyToApi;
export const DELETE = proxyToApi;
