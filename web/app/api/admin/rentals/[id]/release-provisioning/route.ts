import { proxyAdminRequest } from "../../../shared";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyAdminRequest(`/api/admin/rentals/${encodeURIComponent(id)}/release-provisioning`, request, {
    method: "POST",
  });
}
