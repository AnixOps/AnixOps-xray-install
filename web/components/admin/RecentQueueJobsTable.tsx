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
import { Badge, Button, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui";
import { cn } from "@/components/ui/utils";

export interface RecentQueueJobRow {
  id: string;
  name: string;
  state?: string;
  data: Record<string, unknown>;
  rentalId?: string | null;
  failedReason: string | null;
  attemptsMade?: number;
  attempts?: number | null;
  timestamp?: number | null;
  processedOn?: number | null;
  finishedOn?: number | null;
  delay?: number;
  stacktrace: string[];
}

interface RecentQueueJobsTableProps {
  rows: RecentQueueJobRow[];
  onOpenRental?: (rentalId: string) => void;
}

export function RecentQueueJobsTable({ rows, onOpenRental }: RecentQueueJobsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "timestamp", desc: true }]);

  const columns = useMemo<ColumnDef<RecentQueueJobRow>[]>(
    () => [
      {
        id: "name",
        accessorFn: (row) => row.name,
        header: "Job",
        cell: ({ row }) => (
          <div>
            <div className="font-medium tracking-tight">{row.original.name}</div>
            <div className="mt-1 font-mono text-xs text-muted-foreground" title={row.original.id}>
              {shortId(row.original.id)}
            </div>
          </div>
        ),
      },
      {
        id: "rentalId",
        accessorFn: (row) => row.rentalId || "",
        header: "Rental",
        cell: ({ row }) =>
          row.original.rentalId ? (
            onOpenRental ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onOpenRental(row.original.rentalId as string)}
                className="h-8 rounded-full border-black/10 bg-white/90 px-3 text-xs shadow-sm"
              >
                {shortId(row.original.rentalId)}
              </Button>
            ) : (
              <span className="font-mono text-xs text-muted-foreground" title={row.original.rentalId}>
                {shortId(row.original.rentalId)}
              </span>
            )
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          ),
      },
      {
        id: "state",
        accessorFn: (row) => row.state || "failed",
        header: "State",
        cell: ({ row }) => (
          <Badge variant={getJobStateVariant(row.original.state || "failed")} className="rounded-full">
            {row.original.state || "failed"}
          </Badge>
        ),
      },
      {
        id: "attempts",
        accessorFn: (row) => row.attemptsMade || 0,
        header: "Attempts",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.attemptsMade ?? 0}/{row.original.attempts ?? "?"}
          </span>
        ),
      },
      {
        id: "payload",
        accessorFn: (row) => safeStringify(row.data),
        header: "Payload",
        cell: ({ row }) => {
          const payload = safeStringify(row.original.data);
          return (
            <div className="max-w-[300px] truncate font-mono text-[11px] text-muted-foreground" title={payload}>
              {payload}
            </div>
          );
        },
      },
      {
        id: "failure",
        accessorFn: (row) => row.failedReason || "",
        header: "Failure",
        cell: ({ row }) => (
          <div className="max-w-[280px] truncate text-xs text-red-600" title={row.original.failedReason || undefined}>
            {row.original.failedReason || "-"}
          </div>
        ),
      },
      {
        id: "stacktrace",
        accessorFn: (row) => row.stacktrace[0] || "",
        header: "Stack",
        cell: ({ row }) => {
          const stack = row.original.stacktrace?.[0] || "-";
          return (
            <div className="max-w-[320px] truncate text-[11px] text-muted-foreground" title={stack}>
              {stack}
            </div>
          );
        },
      },
      {
        id: "timestamp",
        accessorFn: (row) => row.timestamp ?? 0,
        header: "Time",
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatJobTime(row.original)}</span>,
      },
    ],
    [onOpenRental],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.id,
  });

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div>
          <div className="font-medium">Recent Queue Activity</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Provision queue jobs, failures, payloads, and retry state.
          </div>
        </div>
        <Badge variant="outline" className="rounded-full px-3">
          {rows.length}
        </Badge>
      </div>

      {rows.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">No recent provision jobs.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[1320px]">
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
                        cell.column.id === "rentalId" && "min-w-[170px]",
                        cell.column.id === "payload" && "min-w-[300px]",
                        cell.column.id === "failure" && "min-w-[280px]",
                        cell.column.id === "stacktrace" && "min-w-[320px]",
                        cell.column.id === "timestamp" && "text-xs",
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

function getJobStateVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "failed" || status === "error") return "destructive";
  if (status === "active" || status === "waiting" || status === "delayed") return "secondary";
  if (status === "completed") return "default";
  return "outline";
}

function shortId(value: string) {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function formatJobTime(job: Pick<RecentQueueJobRow, "finishedOn" | "processedOn" | "timestamp">) {
  const value = job.finishedOn ?? job.processedOn ?? job.timestamp;
  return value ? new Date(value).toLocaleString() : "-";
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item));
  } catch {
    return "[unserializable]";
  }
}
