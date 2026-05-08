import { proxyAdminRequest } from "../shared";

export async function GET(request: Request) {
  return proxyAdminRequest("/api/admin/overview", request);
}
