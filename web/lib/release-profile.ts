export type ReleaseProfile = "test" | "formal";

function normalizeReleaseProfile(value: string | null | undefined): ReleaseProfile | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (["formal", "production", "prod", "release"].includes(normalized)) {
    return "formal";
  }

  if (["test", "testing", "staging", "dev", "development"].includes(normalized)) {
    return "test";
  }

  return null;
}

export function getReleaseProfile(): ReleaseProfile {
  return normalizeReleaseProfile(process.env.NEXT_PUBLIC_RELEASE_PROFILE) || "test";
}

export function isFormalRelease() {
  return getReleaseProfile() === "formal";
}
