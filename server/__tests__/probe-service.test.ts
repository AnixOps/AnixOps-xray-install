import { describe, expect, it } from "vitest";
import { normalizeProbeNodeStatus, normalizeProbePolicy, summarizeProbeResults } from "../src/lib/probe-service.js";

describe("structured probe service helpers", () => {
  it("normalizes probe policy with safe defaults", () => {
    expect(normalizeProbePolicy({ minNodes: "5", timeoutMs: 2500, passRatio: "0.8" })).toEqual({
      minNodes: 5,
      timeoutMs: 2500,
      passRatio: 0.8,
    });
    expect(normalizeProbePolicy({ minNodes: 0, timeoutMs: -1, passRatio: 2 })).toEqual({
      minNodes: 3,
      timeoutMs: 5000,
      passRatio: 0.7,
    });
  });

  it("keeps probe runs running until quorum is reached", () => {
    expect(summarizeProbeResults([{ ok: true }, { ok: false }], { minNodes: 3, passRatio: 0.7 })).toEqual({
      completedNodes: 2,
      passedNodes: 1,
      passRatio: 0.5,
      status: "running",
      decision: null,
    });
  });

  it("passes or fails once quorum is reached", () => {
    expect(summarizeProbeResults([{ ok: true }, { ok: true }, { ok: false }], { minNodes: 3, passRatio: 0.7 })).toEqual({
      completedNodes: 3,
      passedNodes: 2,
      passRatio: 0.6667,
      status: "failed",
      decision: "fail",
    });
    expect(summarizeProbeResults([{ ok: true }, { ok: true }, { ok: true }], { minNodes: 3, passRatio: 0.7 })).toEqual({
      completedNodes: 3,
      passedNodes: 3,
      passRatio: 1,
      status: "passed",
      decision: "pass",
    });
  });

  it("normalizes probe node statuses", () => {
    expect(normalizeProbeNodeStatus("OFFLINE")).toBe("offline");
    expect(normalizeProbeNodeStatus("unknown")).toBe("active");
  });
});
