import { proxyAdminRequest } from "../../shared";

export async function POST(request: Request) {
  return proxyAdminRequest("/api/admin/debug/provider-check", request, {
    method: "POST",
  });
}
