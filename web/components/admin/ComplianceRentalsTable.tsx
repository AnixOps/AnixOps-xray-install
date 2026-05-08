"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Badge, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui";
import { cn } from "@/components/ui/utils";

export interface ComplianceRentalRow {
  rentalId: string;
  userId: string | null;
  ip: string | null;
  status: string;
  complianceProfileId: string | null;
  compliancePolicyVersion: string | null;
  stats: {
    rentalId: string;
    complianceProfileId: string | null;
    policyVersion: string | null;
    rejectPackets: number;
    rejectBytes: number;
    lastSyncedAt: string | null;
    sourceIp: string | null;
    detail: string | null;
  } | null;
}

interface ComplianceRentalsTableProps {
  rows: ComplianceRentalRow[];
}

export function ComplianceRentalsTable({ rows }: ComplianceRentalsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "lastSyncedAt", desc: true }]);

  const columns = useMemo<ColumnDef<ComplianceRentalRow>[]>(
    () => [
      {
        id: "rentalId",
        accessorFn: (row) => row.rentalId,
        header: "Rental",
        cell: ({ row }) => (
          <div>
            <div className="font-mono text-xs font-medium" title={row.original.rentalId}>
              {shortId(row.original.rentalId)}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              user {shortId(row.original.userId || "-")}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              IP: {row.original.ip || row.original.stats?.sourceIp || "-"}
            </div>
          </div>
        ),
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={getStatusVariant(row.original.status)} className="rounded-full">
            {row.original.status}
          </Badge>
        ),
      },
      {
        id: "policy",
        accessorFn: (row) => `${row.complianceProfileId || "standard"} ${row.compliancePolicyVersion || ""}`,
        header: "Policy",
        cell: ({ row }) => (
          <div className="space-y-1 text-sm">
            <div>{row.original.complianceProfileId || row.original.stats?.complianceProfileId || "standard"}</div>
            <div className="text-xs text-muted-foreground">
              {row.original.compliancePolicyVersion || row.original.stats?.policyVersion || "-"}
            </div>
          </div>
        ),
      },
      {
        id: "rejects",
        accessorFn: (row) => row.stats?.rejectPackets || 0,
        header: "Rejects",
        cell: ({ row }) => (
          <div className="space-y-1 text-sm">
            <div className="font-medium">{(row.original.stats?.rejectPackets || 0).toLocaleString()} packets</div>
            <div className="text-xs text-muted-foreground">{formatBytes(row.original.stats?.rejectBytes || 0)}</div>
          </div>
        ),
      },
      {
        id: "lastSyncedAt",
        accessorFn: (row) => (row.stats?.lastSyncedAt ? new Date(row.stats.lastSyncedAt).getTime() : 0),
        header: "Synced",
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDateTime(row.original.stats?.lastSyncedAt)}</span>,
      },
      {
        id: "detail",
        accessorFn: (row) => row.stats?.detail || "",
        header: "Detail",
        cell: ({ row }) => (
          <div className="max-w-[280px] text-xs text-muted-foreground">
            {row.original.stats?.detail || "-"}
          </div>
        ),
      },
    ],
    [],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.rentalId,
  });

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div>
          <div className="font-medium">Tracked Rentals</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Latest synced rentals with reject counters and policy versions.
          </div>
        </div>
        <Badge variant="outline" className="rounded-full px-3">
          {rows.length}
        </Badge>
      </div>

      {rows.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">No tracked rentals yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[1280px]">
            <TableHeader className="bg-muted/40 text-left text-muted-foreground">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    const sorted = header.column.getIsSorted();
                    const headerLabel = flexRender(header.column.columnDef.header, header.getContext());

                    return (
                      <TableHead key={header.id}>
                        {header.isPlaceholder ? null : canSort ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className="inline-flex items-center gap-1.5 text-left text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground transition hover:text-foreground"
                          >
                            <span>{headerLabel}</span>
                            {sorted === "asc" ? (
                              <ChevronUp className="h-3.5 w-3.5" />
                            ) : sorted === "desc" ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ArrowUpDown className="h-3.5 w-3.5" />
                            )}
                          </button>
                        ) : (
                          headerLabel
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        "px-4 py-4 align-top",
                        cell.column.id === "rentalId" && "min-w-[220px]",
                        cell.column.id === "status" && "min-w-[120px]",
                        cell.column.id === "policy" && "min-w-[190px]",
                        cell.column.id === "rejects" && "min-w-[150px]",
                        cell.column.id === "lastSyncedAt" && "text-xs",
                        cell.column.id === "detail" && "min-w-[220px]",
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

function getStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "active" || status === "synced") return "default";
  if (status === "pending" || status === "syncing") return "secondary";
  if (status === "failed" || status === "error" || status === "restricted") return "destructive";
  return "outline";
}

function shortId(value: string) {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
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
