import { proxyAuthRequest } from "../proxy";

export async function GET(request: Request) {
  const auth = request.headers.get("Authorization") || "";
  return proxyAuthRequest("/api/auth/me", {
    headers: { Authorization: auth },
  });
}
