import type { ProbeRunSummary } from "./probe-observability.js";

export type MetricCountRow = {
  key: string | null;
  count: number | string | null;
};

export type MetricAmountRow = {
  key: string | null;
  count: number | string | null;
  amount: number | string | null;
};

export type MetricCountAmountRow = MetricCountRow & {
  amount?: number | string | null;
};

function toCount(value: number | string | null | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toMoney(value: number | string | null | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function countMap(rows: MetricCountRow[]) {
  return Object.fromEntries(rows.map((row) => [row.key || "unknown", toCount(row.count)]));
}

function amountMap(rows: MetricAmountRow[]) {
  return Object.fromEntries(rows.map((row) => [row.key || "unknown", {
    count: toCount(row.count),
    amount: toMoney(row.amount),
  }]));
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 10000) / 10000 : null;
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

export function buildProvisioningMetrics(input: {
  rentalStatusRows: MetricCountRow[];
  attemptStatusRows: MetricCountAmountRow[];
  queueCounts?: Record<string, number | string | undefined>;
  generatedAt?: string;
}) {
  const rentalsByStatus = countMap(input.rentalStatusRows);
  const attemptsByStatus = countMap(input.attemptStatusRows);
  const cloudCostByStatus = amountMap(input.attemptStatusRows.map((row) => ({
    key: row.key,
    count: row.count,
    amount: row.amount || 0,
  })));
  const cloudCostTotal = toMoney(Object.values(cloudCostByStatus)
    .reduce((sum, entry) => sum + entry.amount, 0));
  const terminalAttempts = (attemptsByStatus.succeeded || 0)
    + (attemptsByStatus.failed || 0)
    + (attemptsByStatus.failed_destroyed || 0)
    + (attemptsByStatus.abandoned || 0);
  const failedAttempts = (attemptsByStatus.failed || 0)
    + (attemptsByStatus.failed_destroyed || 0)
    + (attemptsByStatus.abandoned || 0);

  return {
    generatedAt: input.generatedAt || new Date().toISOString(),
    rentals: {
      byStatus: rentalsByStatus,
      activeLike: ["pending", "provisioning", "probing", "configuring", "active", "destroying"]
        .reduce((sum, status) => sum + (rentalsByStatus[status] || 0), 0),
      failed: rentalsByStatus.failed || 0,
    },
    attempts: {
      byStatus: attemptsByStatus,
      terminal: terminalAttempts,
      running: attemptsByStatus.running || 0,
      succeeded: attemptsByStatus.succeeded || 0,
      failed: failedAttempts,
      successRate: ratio(attemptsByStatus.succeeded || 0, terminalAttempts),
      cloudCost: {
        currency: "usd",
        total: cloudCostTotal,
        byStatus: cloudCostByStatus,
      },
    },
    queue: input.queueCounts
      ? Object.fromEntries(Object.entries(input.queueCounts).map(([key, value]) => [key, toCount(value ?? 0)]))
      : null,
  };
}

export function buildBillingMetrics(input: {
  ledgerRows: MetricAmountRow[];
  tickRows: MetricAmountRow[];
  topupRows: MetricAmountRow[];
  walletRentalRows: MetricCountRow[];
  generatedAt?: string;
}) {
  const ledgerByType = amountMap(input.ledgerRows);
  const ticksByStatus = amountMap(input.tickRows);
  const topupsByStatus = amountMap(input.topupRows);
  const walletRentalsByStatus = countMap(input.walletRentalRows);
  const ledgerEntries = Object.values(ledgerByType);
  const grossCredits = toMoney(ledgerEntries
    .filter((entry) => entry.amount > 0)
    .reduce((sum, entry) => sum + entry.amount, 0));
  const grossDebits = toMoney(Math.abs(ledgerEntries
    .filter((entry) => entry.amount < 0)
    .reduce((sum, entry) => sum + entry.amount, 0)));

  return {
    generatedAt: input.generatedAt || new Date().toISOString(),
    wallet: {
      ledgerByType,
      grossCredits,
      grossDebits,
      net: toMoney(grossCredits - grossDebits),
    },
    billingTicks: {
      byStatus: ticksByStatus,
      chargedAmount: ticksByStatus.charged?.amount || 0,
      chargedCount: ticksByStatus.charged?.count || 0,
    },
    topups: {
      byStatus: topupsByStatus,
      completedAmount: topupsByStatus.completed?.amount || 0,
      pendingAmount: topupsByStatus.pending?.amount || 0,
    },
    walletRentals: {
      byStatus: walletRentalsByStatus,
      activeLike: ["pending", "provisioning", "probing", "configuring", "active", "destroying"]
        .reduce((sum, status) => sum + (walletRentalsByStatus[status] || 0), 0),
    },
  };
}

export function buildProbeMetrics(input: {
  scannedEvents: number;
  runs: ProbeRunSummary[];
  generatedAt?: string;
}) {
  const byStatus: Record<string, number> = {};
  const byDecision: Record<string, number> = {};
  const passRatios: number[] = [];
  const latencies: number[] = [];

  for (const run of input.runs) {
    byStatus[run.status] = (byStatus[run.status] || 0) + 1;
    byDecision[String(run.decision || "unknown")] = (byDecision[String(run.decision || "unknown")] || 0) + 1;
    if (typeof run.passRatio === "number") {
      passRatios.push(run.passRatio);
    }
    if (typeof run.latencyMs === "number") {
      latencies.push(run.latencyMs);
    }
  }

  const terminalRuns = (byStatus.passed || 0) + (byStatus.failed || 0) + (byStatus.skipped || 0);

  return {
    generatedAt: input.generatedAt || new Date().toISOString(),
    scannedEvents: input.scannedEvents,
    runs: {
      total: input.runs.length,
      byStatus,
      byDecision,
      terminal: terminalRuns,
      passRate: ratio(byStatus.passed || 0, terminalRuns),
      averagePassRatio: average(passRatios),
      averageLatencyMs: average(latencies),
    },
  };
}
