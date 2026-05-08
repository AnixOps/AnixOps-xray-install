import { describe, expect, it } from "vitest";
import { normalizeReturnToPath } from "../redirect";

describe("auth redirect helpers", () => {
  it("keeps internal return-to paths and rejects external URLs", () => {
    expect(normalizeReturnToPath("/console/wallet")).toBe("/console/wallet");
    expect(normalizeReturnToPath("/console/wallet?view=audit")).toBe("/console/wallet?view=audit");
    expect(normalizeReturnToPath("https://evil.example")).toBe("/");
    expect(normalizeReturnToPath("//evil.example")).toBe("/");
    expect(normalizeReturnToPath("")).toBe("/");
  });
});
