import { NextResponse } from "next/server";
import { generateHysteria2Subscription, generateVlessRealitySubscription } from "@/lib/config/generator";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const format = new URL(request.url).searchParams.get("format") || "universal";
  if (!["universal", "raw"].includes(format)) {
    return NextResponse.json({ error: "Invalid format. Choose: universal, raw" }, { status: 400 });
  }

  const token = request.headers.get("Authorization");
  const apiUrl = `${process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787"}/api/rental/${id}/config`;
  let res: Response;
  try {
    res = await fetch(apiUrl, {
      headers: token ? { Authorization: token } : {},
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Worker API unreachable" }, { status: 503 });
  }

  if (!res.ok) {
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  }

  const rawConfig = await res.json();
  const payload = rawConfig.protocol === "vless-reality"
    ? generateVlessRealitySubscription(rawConfig)
    : generateHysteria2Subscription(rawConfig);

  if (format === "raw") {
    return new NextResponse(Buffer.from(payload, "base64").toString("utf-8"), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return NextResponse.json({
    protocol: rawConfig.protocol,
    format,
    subscription: payload,
  });
}
