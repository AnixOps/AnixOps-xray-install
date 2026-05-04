import { NextResponse } from "next/server";
import { buildNoStoreHeaders } from "../shared";

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_WORKER_URL || "http://127.0.0.1:8787";

function buildHeaders(request: Request) {
  const headers = new Headers();
  const auth = request.headers.get("Authorization");
  if (auth) {
    headers.set("Authorization", auth);
  }
  return headers;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const res = await fetch(`${API_URL}/api/admin/search?q=${encodeURIComponent(q)}`, {
    headers: buildHeaders(request),
    cache: "no-store",
  });

  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: buildNoStoreHeaders(res.headers.get("Content-Type") || "application/json"),
  });
}
