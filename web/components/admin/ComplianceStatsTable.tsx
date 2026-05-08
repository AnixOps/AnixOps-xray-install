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

export interface ComplianceStatRow {
  rentalId: string;
  complianceProfileId: string | null;
  policyVersion: string | null;
  rejectPackets: number;
  rejectBytes: number;
  lastSyncedAt: string | null;
}

interface ComplianceStatsTableProps {
  rows: ComplianceStatRow[];
}

export function ComplianceStatsTable({ rows }: ComplianceStatsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "lastSyncedAt", desc: true }]);

  const columns = useMemo<ColumnDef<ComplianceStatRow>[]>(
    () => [
      {
        id: "rentalId",
        accessorFn: (row) => row.rentalId,
        header: "Rental",
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground" title={row.original.rentalId}>
            {shortId(row.original.rentalId)}
          </span>
        ),
      },
      {
        id: "profile",
        accessorFn: (row) => row.complianceProfileId || "standard",
        header: "Profile",
        cell: ({ row }) => <span className="text-sm">{row.original.complianceProfileId || "standard"}</span>,
      },
      {
        id: "policy",
        accessorFn: (row) => row.policyVersion || "",
        header: "Policy",
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.policyVersion || "-"}</span>,
      },
      {
        id: "rejectPackets",
        accessorFn: (row) => row.rejectPackets,
        header: "Rejects",
        cell: ({ row }) => <span className="font-medium">{row.original.rejectPackets.toLocaleString()}</span>,
      },
      {
        id: "rejectBytes",
        accessorFn: (row) => row.rejectBytes,
        header: "Bytes",
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{formatBytes(row.original.rejectBytes)}</span>,
      },
      {
        id: "lastSyncedAt",
        accessorFn: (row) => (row.lastSyncedAt ? new Date(row.lastSyncedAt).getTime() : 0),
        header: "Synced",
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDateTime(row.original.lastSyncedAt)}</span>,
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
          <div className="font-medium">Recent Compliance Stats</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Latest reject counters collected from tracked rentals.
          </div>
        </div>
        <Badge variant="outline" className="rounded-full px-3">
          {rows.length}
        </Badge>
      </div>

      {rows.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">No compliance stats yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[920px]">
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
                        cell.column.id === "rentalId" && "min-w-[160px]",
                        cell.column.id === "profile" && "min-w-[160px]",
                        cell.column.id === "policy" && "min-w-[150px]",
                        cell.column.id === "rejectPackets" && "text-right",
                        cell.column.id === "rejectBytes" && "text-right",
                        cell.column.id === "lastSyncedAt" && "text-xs",
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
