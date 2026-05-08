import { proxyAuthRequest } from "../proxy";

export async function POST(request: Request) {
  const body = await request.text();
  return proxyAuthRequest("/api/auth/request-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}
