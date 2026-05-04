import { NextResponse } from "next/server";
import { buildNoStoreHeaders } from "../shared";

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_WORKER_URL || "http://127.0.0.1:8787";

function buildHeaders(request: Request) {
  const headers = new Headers();
  const auth = request.headers.get("Authorization");
  if (auth) {
    headers.set("Authorization", auth);
  }
  const apiSecret = request.headers.get("X-API-Secret");
  if (apiSecret) {
    headers.set("X-API-Secret", apiSecret);
  }
  return headers;
}

export async function GET(request: Request) {
  const res = await fetch(`${API_URL}/api/admin/redeem-codes`, {
    headers: buildHeaders(request),
    cache: "no-store",
  });

  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: buildNoStoreHeaders(res.headers.get("Content-Type") || "application/json"),
  });
}

export async function POST(request: Request) {
  const body = await request.text();
  const res = await fetch(`${API_URL}/api/admin/redeem-codes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...Object.fromEntries(buildHeaders(request).entries()),
    },
    body,
    cache: "no-store",
  });

  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: buildNoStoreHeaders(res.headers.get("Content-Type") || "application/json"),
  });
}
