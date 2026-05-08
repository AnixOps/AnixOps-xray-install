import { NodeSSH } from "node-ssh";
import { getOrCreateSSHKey } from "./provision.js";

export type ComplianceStatsSnapshot = {
  status: "ok" | "missing";
  rejectPackets: number;
  rejectBytes: number;
  detail?: string;
};

function toCount(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

export function parseComplianceIptablesStats(output: string): ComplianceStatsSnapshot {
  const text = String(output || "").trim();
  if (!text || text.includes("__ANIXOPS_CHAIN_MISSING__")) {
    return {
      status: "missing",
      rejectPackets: 0,
      rejectBytes: 0,
      detail: "ANIXOPS_EGRESS chain is missing",
    };
  }

  const lines = text.split(/\r?\n/);
  let rejectPackets = 0;
  let rejectBytes = 0;

  for (const line of lines) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+REJECT\b/);
    if (!match) {
      continue;
    }
    rejectPackets += toCount(match[1]);
    rejectBytes += toCount(match[2]);
  }

  return {
    status: "ok",
    rejectPackets,
    rejectBytes,
    detail: rejectPackets > 0 || rejectBytes > 0 ? "Compliance reject counters captured" : "No compliance rejects recorded",
  };
}

export async function collectComplianceStats(ip: string) {
  const { privateKey } = getOrCreateSSHKey();
  const ssh = new NodeSSH();
  try {
    await ssh.connect({
      host: ip,
      username: "root",
      privateKey,
      readyTimeout: 10000,
    });
    const result = await ssh.execCommand([
      "if command -v iptables >/dev/null 2>&1 && iptables -L ANIXOPS_EGRESS >/dev/null 2>&1; then",
      "  iptables -nvx -L ANIXOPS_EGRESS",
      "else",
      "  echo __ANIXOPS_CHAIN_MISSING__",
      "fi",
    ].join("\n"));
    if (result.code && result.code !== 0) {
      throw new Error(result.stderr || `iptables probe failed with exit code ${result.code}`);
    }
    return parseComplianceIptablesStats(result.stdout || "");
  } finally {
    ssh.dispose();
  }
}
