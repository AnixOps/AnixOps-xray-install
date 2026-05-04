import { NextResponse } from "next/server";

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
  headers.set("Content-Type", "application/json");
  return headers;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.text();
  const res = await fetch(`${API_URL}/api/admin/redeem-codes/${id}`, {
    method: "PATCH",
    headers: buildHeaders(request),
    body,
    cache: "no-store",
  });

  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" },
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const res = await fetch(`${API_URL}/api/admin/redeem-codes/${id}`, {
    method: "DELETE",
    headers: buildHeaders(request),
    cache: "no-store",
  });

  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" },
  });
}
