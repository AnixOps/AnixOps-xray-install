export type HealthDependency = {
  name: string;
  check: () => Promise<unknown>;
};

export type HealthCheckResult = {
  name: string;
  ok: boolean;
  error?: string;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function runHealthChecks(dependencies: HealthDependency[]): Promise<HealthCheckResult[]> {
  const checks = await Promise.allSettled(dependencies.map((dependency) => dependency.check()));

  return checks.map((result, index) => ({
    name: dependencies[index].name,
    ok: result.status === "fulfilled",
    ...(result.status === "rejected" ? { error: getErrorMessage(result.reason) } : {}),
  }));
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export async function checkProvisionServerHealth(
  baseUrl: string | null | undefined,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 5000,
) {
  if (!baseUrl) {
    throw new Error("PROVISION_SERVER_URL is not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${trimTrailingSlash(baseUrl)}/health`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Provision health returned HTTP ${res.status}`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new Error(`Provision health returned non-JSON content-type: ${contentType || "unknown"}`);
    }

    const body = await res.json() as { status?: unknown };
    if (body.status !== "ok") {
      throw new Error(`Provision health status is ${String(body.status || "unknown")}`);
    }
    return body;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Provision health timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
