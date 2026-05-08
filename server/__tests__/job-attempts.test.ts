import { describe, expect, it } from "vitest";
import { hasExhaustedAttempts } from "../src/lib/job-attempts.js";

describe("job attempt helpers", () => {
  it("does not release jobs that still have retries left", () => {
    expect(hasExhaustedAttempts({ attemptsMade: 3, opts: { attempts: 10 } })).toBe(false);
  });

  it("releases jobs after the final configured attempt", () => {
    expect(hasExhaustedAttempts({ attemptsMade: 10, opts: { attempts: 10 } })).toBe(true);
  });

  it("treats jobs without explicit attempts as single-attempt jobs", () => {
    expect(hasExhaustedAttempts({ attemptsMade: 1, opts: {} })).toBe(true);
  });
});
