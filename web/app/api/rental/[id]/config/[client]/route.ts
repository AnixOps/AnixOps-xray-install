import { NextResponse } from "next/server";
import { generateVlessRealityConfig, generateHysteria2Config, normalizeRentalConfig } from "@/lib/config/generator";

// Get rental config formatted for a specific client
// GET /api/rental/[id]/config/[client]
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; client: string }> }
) {
  const { id, client } = await params;
  const validClients = ["clash-meta", "singbox", "v2rayn", "shadowrocket"] as const;

  if (!validClients.includes(client as (typeof validClients)[number])) {
    return NextResponse.json(
      { error: `Invalid client. Choose: ${validClients.join(", ")}` },
      { status: 400 }
    );
  }

  // Fetch raw config from the rental API
  const token = request.headers.get("Authorization");
  const apiBase = process.env.API_URL || process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
  const workerUrl = `${apiBase}/api/rental/${id}/config`;
  let res: Response;
  try {
    res = await fetch(workerUrl, {
      headers: token ? { Authorization: token } : {},
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Worker API unreachable" }, { status: 503 });
  }

  if (!res.ok) {
    const text = await res.text();
    try {
      return NextResponse.json(JSON.parse(text), { status: res.status });
    } catch {
      return NextResponse.json({ error: text || "Upstream request failed" }, { status: res.status });
    }
  }

  const rawConfig = await res.json();
  const validation = normalizeRentalConfig(rawConfig);

  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: validation.status });
  }

  // Generate client-specific config
  const config = validation.config.protocol === "vless-reality"
    ? generateVlessRealityConfig(validation.config)
    : generateHysteria2Config(validation.config);

  const clientKey = client.replace("-", "") as keyof typeof config;

  return NextResponse.json({
    protocol: rawConfig.protocol,
    client,
    config: config[clientKey] || config.clashMeta,
  });
}
