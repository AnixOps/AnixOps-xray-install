import { NextResponse } from "next/server";
import { deployments, cleanupDeployments } from "@/lib/deploy/self-hosted-state";

export { deployments };

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
