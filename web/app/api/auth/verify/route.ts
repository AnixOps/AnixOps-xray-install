import { proxyAuthRequest } from "../proxy";

export async function POST(request: Request) {
  const body = await request.text();
  return proxyAuthRequest("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}
