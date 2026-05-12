import { afterEach, describe, expect, it } from "vitest";
import {
  filterComplianceProfilesForRelease,
  getDefaultComplianceProfileId,
  isProtocolAllowedForRelease,
  normalizeComplianceProfileIdForRelease,
  STRICT_COMPLIANCE_PROFILE_ID,
} from "../src/release-profile.js";

const originalReleaseProfile = process.env.NEXT_PUBLIC_RELEASE_PROFILE;

afterEach(() => {
  if (originalReleaseProfile === undefined) {
    delete process.env.NEXT_PUBLIC_RELEASE_PROFILE;
  } else {
    process.env.NEXT_PUBLIC_RELEASE_PROFILE = originalReleaseProfile;
  }
});

describe("server release profile helpers", () => {
  it("defaults every release profile to strict compliance", () => {
    delete process.env.NEXT_PUBLIC_RELEASE_PROFILE;

    expect(getDefaultComplianceProfileId()).toBe(STRICT_COMPLIANCE_PROFILE_ID);
    expect(normalizeComplianceProfileIdForRelease(undefined)).toBe(STRICT_COMPLIANCE_PROFILE_ID);
    expect(normalizeComplianceProfileIdForRelease("standard")).toBe("standard");
  });

  it("locks formal release to VLESS and the strict compliance preset", () => {
    process.env.NEXT_PUBLIC_RELEASE_PROFILE = "formal";

    expect(isProtocolAllowedForRelease("vless-reality")).toBe(true);
    expect(isProtocolAllowedForRelease("hysteria2")).toBe(false);
    expect(getDefaultComplianceProfileId()).toBe(STRICT_COMPLIANCE_PROFILE_ID);
    expect(normalizeComplianceProfileIdForRelease("standard")).toBe(STRICT_COMPLIANCE_PROFILE_ID);
    expect(
      filterComplianceProfilesForRelease([
        { id: "standard" },
        { id: STRICT_COMPLIANCE_PROFILE_ID },
      ]),
    ).toEqual([{ id: STRICT_COMPLIANCE_PROFILE_ID }]);
  });
});
