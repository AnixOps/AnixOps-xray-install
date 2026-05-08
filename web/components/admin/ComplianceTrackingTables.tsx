"use client";

import { ComplianceProfilesTable, type ComplianceProfileRow } from "@/components/admin/ComplianceProfilesTable";
import { ComplianceRentalsTable, type ComplianceRentalRow } from "@/components/admin/ComplianceRentalsTable";

interface ComplianceTrackingTablesProps {
  stats: {
    summary: {
      trackedRentals: number;
      syncedRentals: number;
      profileCount: number;
      rejectPackets: number;
      rejectBytes: number;
      latestSyncedAt: string | null;
    };
    profiles: ComplianceProfileRow[];
    rentals: ComplianceRentalRow[];
  };
}

export function ComplianceTrackingTables({ stats }: ComplianceTrackingTablesProps) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricTile label="Tracked Rentals" value={String(stats.summary.trackedRentals)} />
        <MetricTile
          label="Synced Rentals"
          value={
            stats.summary.trackedRentals > 0
              ? `${stats.summary.syncedRentals}/${stats.summary.trackedRentals}`
              : String(stats.summary.syncedRentals)
          }
        />
        <MetricTile label="Profiles" value={String(stats.summary.profileCount)} />
        <MetricTile label="Reject Packets" value={String(stats.summary.rejectPackets)} />
        <MetricTile label="Reject Bytes" value={formatBytes(stats.summary.rejectBytes)} />
        <MetricTile label="Latest Sync" value={formatDateTime(stats.summary.latestSyncedAt)} />
      </div>

      <ComplianceProfilesTable rows={stats.profiles} />
      <ComplianceRentalsTable rows={stats.rentals} />
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-sm font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1000 && unitIndex < units.length - 1) {
    size /= 1000;
    unitIndex += 1;
  }

  const fractionDigits = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(fractionDigits)} ${units[unitIndex]}`;
}
