import { buildAdminHeaders, proxyAdminRequest } from "../../shared";

export async function POST(request: Request) {
  const body = await request.text();
  return proxyAdminRequest("/api/admin/debug/provision-test", request, {
    method: "POST",
    headers: buildAdminHeaders(request, "application/json"),
    body,
  });
}
