import { NextResponse } from "next/server";
import { deployments, cleanupDeployments } from "@/lib/deploy/self-hosted-state";
const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_WORKER_URL || "http://127.0.0.1:8787";

async function isAuthorized(request: Request) {
  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return false;
  }
  const res = await fetch(`${API_URL}/api/auth/me`, {
    headers: { Authorization: auth },
    cache: "no-store",
  });
  return res.ok;
}

export { deployments };

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const deploy = deployments.get(id);

  if (!deploy) {
    return NextResponse.json(
      { error: "Deployment not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    id,
    status: deploy.status,
    progress: deploy.progress,
    config: deploy.config,
    error: deploy.error,
    logs: deploy.logs || [],
  });
}
