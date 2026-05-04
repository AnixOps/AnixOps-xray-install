import { NextResponse } from "next/server";

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_WORKER_URL || "http://127.0.0.1:8787";

export async function GET(request: Request) {
  const auth = request.headers.get("Authorization") || "";
  const res = await fetch(`${API_URL}/api/auth/me`, {
    headers: { Authorization: auth },
    cache: "no-store",
  });

  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" },
  });
}
