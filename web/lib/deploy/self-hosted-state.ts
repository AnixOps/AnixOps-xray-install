export interface DeploymentLogEntry {
  ts: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface DeploymentState {
  status: string;
  progress: number;
  config?: Record<string, string>;
  error?: string;
  createdAt: number;
  logs?: DeploymentLogEntry[];
}

// Shared deployment state for self-hosted mode
// Used by both route.ts and [id]/route.ts
export const deployments = new Map<string, DeploymentState>();

// Clean up old deployments (> 1 hour)
export function cleanupDeployments() {
  const now = Date.now();
  for (const [id, deploy] of deployments.entries()) {
    if (now - deploy.createdAt > 3600000) {
      deployments.delete(id);
    }
  }
}

// Run cleanup every 10 minutes
if (typeof setInterval !== "undefined") {
  setInterval(cleanupDeployments, 600000);
}
