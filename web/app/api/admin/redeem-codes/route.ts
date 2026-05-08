import { buildAdminHeaders, proxyAdminRequest } from "../shared";

export async function GET(request: Request) {
  return proxyAdminRequest("/api/admin/redeem-codes", request);
}

export async function POST(request: Request) {
  const body = await request.text();
  return proxyAdminRequest("/api/admin/redeem-codes", request, {
    method: "POST",
    headers: buildAdminHeaders(request, "application/json"),
    body,
  });
}
