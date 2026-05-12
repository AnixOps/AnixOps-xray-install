export type ReleaseProfile = "test" | "formal";

export const STRICT_COMPLIANCE_PROFILE_ID = "restricted-egress";
export const FORMAL_RELEASE_PROTOCOLS = ["vless-reality"] as const;

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

export function isFormalRelease(source: NodeJS.ProcessEnv = process.env) {
  return normalizeReleaseProfile(source.NEXT_PUBLIC_RELEASE_PROFILE) === "formal";
}

export function isProtocolAllowedForRelease(
  protocol: string | null | undefined,
  formalRelease = isFormalRelease(),
) {
  if (protocol !== "vless-reality" && protocol !== "hysteria2") {
    return false;
  }

  return !formalRelease || protocol === "vless-reality";
}

export function getDefaultComplianceProfileId(formalRelease = isFormalRelease()) {
  return STRICT_COMPLIANCE_PROFILE_ID;
}

export function normalizeComplianceProfileIdForRelease(
  profileId: string | null | undefined,
  formalRelease = isFormalRelease(),
) {
  if (formalRelease) {
    return STRICT_COMPLIANCE_PROFILE_ID;
  }

  return profileId?.trim() || STRICT_COMPLIANCE_PROFILE_ID;
}

export function filterComplianceProfilesForRelease<T extends { id: string }>(
  profiles: T[],
  formalRelease = isFormalRelease(),
) {
  if (!formalRelease) {
    return profiles;
  }

  return profiles.filter((profile) => profile.id === STRICT_COMPLIANCE_PROFILE_ID);
}
