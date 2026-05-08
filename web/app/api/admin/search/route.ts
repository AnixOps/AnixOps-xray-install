import { proxyAdminRequest } from "../shared";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  return proxyAdminRequest(`/api/admin/search?q=${encodeURIComponent(q)}`, request);
}
