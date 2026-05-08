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
import { isFormalRelease } from "@/lib/release-profile";

export interface RecentFiatTopupRow {
  topupId: string;
  email: string | null;
  provider: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

interface RecentFiatTopupsTableProps {
  rows: RecentFiatTopupRow[];
  onOpenTopup?: (topupId: string) => void;
  isZh?: boolean;
}

export function RecentFiatTopupsTable({ rows, onOpenTopup, isZh = false }: RecentFiatTopupsTableProps) {
  const formalRelease = isFormalRelease();
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);

  const columns = useMemo<ColumnDef<RecentFiatTopupRow>[]>(
    () => [
      {
        id: "user",
        accessorFn: (row) => row.email || "",
        header: "User",
        cell: ({ row }) => <span className="text-sm">{row.original.email || "Unknown user"}</span>,
      },
      {
        id: "provider",
        accessorFn: (row) => row.provider,
        header: "Provider",
        cell: ({ row }) => <span className="text-sm font-medium tracking-tight">{row.original.provider}</span>,
      },
      {
        id: "amount",
        accessorFn: (row) => row.amount,
        header: "Amount",
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.amount.toFixed(2)} {row.original.currency.toUpperCase()}
          </span>
        ),
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={getTopupStatusVariant(row.original.status)} className="rounded-full">
            {row.original.status}
          </Badge>
        ),
      },
      {
        id: "createdAt",
        accessorFn: (row) => new Date(row.createdAt).getTime(),
        header: "Created",
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>,
      },
      {
        id: "completedAt",
        accessorFn: (row) => (row.completedAt ? new Date(row.completedAt).getTime() : 0),
        header: "Completed",
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDateTime(row.original.completedAt)}</span>,
      },
      {
        id: "actions",
        header: () => null,
        cell: ({ row }) =>
          onOpenTopup ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onOpenTopup(row.original.topupId)}
              className="h-8 rounded-full border-black/10 bg-white/90 px-3 text-xs shadow-sm"
            >
              {isZh ? "详情" : "Details"}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          ),
      },
    ],
    [formalRelease, onOpenTopup, isZh],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.topupId,
  });

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div>
          <div className="font-medium">{formalRelease ? "Historical Fiat Topups" : "Recent Fiat Topups"}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {formalRelease
              ? "Legacy balance recharge records, sorted by newest activity."
              : "Stripe-backed balance recharge records, sorted by newest activity."}
          </div>
        </div>
        <Badge variant="outline" className="rounded-full px-3">
          {rows.length}
        </Badge>
      </div>

      {rows.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">No fiat topups yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[1160px]">
            <TableHeader className="bg-muted/40 text-left text-muted-foreground">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    const sorted = header.column.getIsSorted();
                    const headerLabel = flexRender(header.column.columnDef.header, header.getContext());

                    return (
                      <TableHead key={header.id} className={cn(header.column.id === "actions" && "text-right")}>
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
                        "px-4 py-4",
                        cell.column.id === "amount" && "text-right",
                        cell.column.id === "status" && "min-w-[120px]",
                        cell.column.id === "actions" && "text-right",
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

function getTopupStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default";
  if (status === "pending") return "secondary";
  if (status === "refunded" || status === "failed") return "destructive";
  return "outline";
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}
