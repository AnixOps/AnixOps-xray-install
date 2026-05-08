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

export interface RecentStageLogRow {
  id: number;
  rentalId: string | null;
  stage: string;
  status: "started" | "ok" | "failed" | "info" | "warn";
  message: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

interface RecentStageLogsTableProps {
  rows: RecentStageLogRow[];
  onOpenRental?: (rentalId: string) => void;
}

export function RecentStageLogsTable({ rows, onOpenRental }: RecentStageLogsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);

  const columns = useMemo<ColumnDef<RecentStageLogRow>[]>(
    () => [
      {
        id: "stage",
        accessorFn: (row) => row.stage,
        header: "Stage",
        cell: ({ row }) => (
          <div>
            <div className="font-mono text-xs font-semibold tracking-tight">{row.original.stage}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">#{row.original.id}</div>
          </div>
        ),
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={getStageBadgeVariant(row.original.status)} className="rounded-full">
            {row.original.status}
          </Badge>
        ),
      },
      {
        id: "message",
        accessorFn: (row) => row.message,
        header: "Message",
        cell: ({ row }) => <div className="max-w-[280px] text-sm leading-6">{row.original.message}</div>,
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
        id: "meta",
        accessorFn: (row) => formatStageMeta(row.meta),
        header: "Meta",
        cell: ({ row }) => {
          const meta = formatStageMeta(row.original.meta);
          return (
            <div className="max-w-[320px] truncate text-[11px] text-muted-foreground" title={meta}>
              {meta || "-"}
            </div>
          );
        },
      },
      {
        id: "createdAt",
        accessorFn: (row) => new Date(row.createdAt).getTime(),
        header: "Time",
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>,
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
    getRowId: (row) => String(row.id),
  });

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div>
          <div className="font-medium">Recent Stage Logs</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Provision stage transitions, payload hints, and recovery context.
          </div>
        </div>
        <Badge variant="outline" className="rounded-full px-3">
          {rows.length}
        </Badge>
      </div>

      {rows.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">No provision stage logs yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[1080px]">
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
                        cell.column.id === "message" && "min-w-[280px]",
                        cell.column.id === "rentalId" && "min-w-[170px]",
                        cell.column.id === "meta" && "min-w-[320px]",
                        cell.column.id === "createdAt" && "text-xs",
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

function getStageBadgeVariant(status: RecentStageLogRow["status"]): "default" | "secondary" | "destructive" | "outline" {
  if (status === "failed") return "destructive";
  if (status === "ok") return "default";
  if (status === "warn" || status === "started") return "secondary";
  return "outline";
}

function shortId(value: string) {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function formatStageMeta(meta: Record<string, unknown>) {
  const entries = Object.entries(meta || {});
  if (entries.length === 0) {
    return "";
  }
  return entries.map(([key, value]) => `${key}=${String(value)}`).join(", ");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}
