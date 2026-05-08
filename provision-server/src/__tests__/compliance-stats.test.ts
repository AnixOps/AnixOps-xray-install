import { describe, expect, it } from "vitest";
import { parseComplianceIptablesStats } from "../compliance-stats.js";

describe("compliance stats parser", () => {
  it("parses reject counters from the ANIXOPS_EGRESS chain", () => {
    const stats = parseComplianceIptablesStats(`
Chain ANIXOPS_EGRESS (1 references)
 pkts bytes target     prot opt in     out     source               destination
   10   840 ACCEPT     all  --  *      *       0.0.0.0/0            0.0.0.0/0
   12  2048 REJECT     all  --  *      *       0.0.0.0/0            0.0.0.0/0 reject-with icmp-port-unreachable
`);

    expect(stats).toEqual({
      status: "ok",
      rejectPackets: 12,
      rejectBytes: 2048,
      detail: "Compliance reject counters captured",
    });
  });

  it("returns missing when the chain is not installed", () => {
    expect(parseComplianceIptablesStats("__ANIXOPS_CHAIN_MISSING__")).toEqual({
      status: "missing",
      rejectPackets: 0,
      rejectBytes: 0,
      detail: "ANIXOPS_EGRESS chain is missing",
    });
  });
});
