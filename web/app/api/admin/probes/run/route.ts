import { buildAdminHeaders, proxyAdminRequest } from "../../../admin/shared";

export async function POST(request: Request) {
  const body = await request.text();
  return proxyAdminRequest("/api/admin/probes/run", request, {
    method: "POST",
    headers: buildAdminHeaders(request, "application/json"),
    body,
  });
}
