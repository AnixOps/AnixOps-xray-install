// Shared deployment state for self-hosted mode
// Used by both route.ts and [id]/route.ts
export const deployments = new Map<string, {
  status: string;
  progress: number;
  config?: Record<string, string>;
  error?: string;
  createdAt: number;
}>();

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
