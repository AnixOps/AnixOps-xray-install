import { proxyAdminRequest } from "../../shared";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyAdminRequest(`/api/admin/rentals/${encodeURIComponent(id)}`, request);
}
