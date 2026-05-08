import { buildAdminHeaders, proxyAdminRequest } from "../../shared";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.text();
  return proxyAdminRequest(`/api/admin/redeem-codes/${encodeURIComponent(id)}`, request, {
    method: "PATCH",
    headers: buildAdminHeaders(request, "application/json"),
    body,
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyAdminRequest(`/api/admin/redeem-codes/${encodeURIComponent(id)}`, request, {
    method: "DELETE",
  });
}
