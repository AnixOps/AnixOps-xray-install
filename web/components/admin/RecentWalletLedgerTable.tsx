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
import { useLocaleStore } from "@/lib/i18n/store";
import { formatWalletLedgerTypeLabel } from "@/lib/payment-records";

export interface RecentWalletLedgerRow {
  entryId: string;
  email: string | null;
  type: string;
  amount: number;
  currency: string;
  rentalId: string | null;
  topupId: string | null;
  balanceAfter: number;
  createdAt: string;
}

interface RecentWalletLedgerTableProps {
  rows: RecentWalletLedgerRow[];
  onOpenRental?: (rentalId: string) => void;
  onOpenTopup?: (topupId: string) => void;
  isZh?: boolean;
}

export function RecentWalletLedgerTable({ rows, onOpenRental, onOpenTopup, isZh: propIsZh = false }: RecentWalletLedgerTableProps) {
  const { locale } = useLocaleStore();
  const isZh = propIsZh || locale === "zh";
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);

  const columns = useMemo<ColumnDef<RecentWalletLedgerRow>[]>(
    () => [
      {
        id: "entryId",
        accessorFn: (row) => row.entryId,
        header: "Entry",
        cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{shortId(row.original.entryId)}</span>,
      },
      {
        id: "user",
        accessorFn: (row) => row.email || "",
        header: "User",
        cell: ({ row }) => <span className="text-sm">{row.original.email || "Unknown user"}</span>,
      },
      {
        id: "type",
        accessorFn: (row) => row.type,
        header: "Type",
        cell: ({ row }) => (
          <Badge variant={row.original.amount >= 0 ? "default" : "destructive"} className="rounded-full">
            {formatWalletLedgerTypeLabel(row.original.type, isZh)}
          </Badge>
        ),
      },
      {
        id: "amount",
        accessorFn: (row) => row.amount,
        header: "Amount",
        cell: ({ row }) => (
          <span className={cn("font-medium", row.original.amount < 0 && "text-destructive")}>
            {formatSignedAmount(row.original.amount)} {row.original.currency.toUpperCase()}
          </span>
        ),
      },
      {
        id: "balanceAfter",
        accessorFn: (row) => row.balanceAfter,
        header: "Balance After",
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.balanceAfter.toFixed(2)} {row.original.currency.toUpperCase()}
          </span>
        ),
      },
      {
        id: "linked",
        accessorFn: (row) => `${row.rentalId || ""}:${row.topupId || ""}`,
        header: "Linked",
        cell: ({ row }) => (
          <div className="space-y-1 text-xs text-muted-foreground">
            <div>Rental: {shortId(row.original.rentalId)}</div>
            <div>Topup: {shortId(row.original.topupId)}</div>
          </div>
        ),
      },
      {
        id: "createdAt",
        accessorFn: (row) => new Date(row.createdAt).getTime(),
        header: "Created",
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>,
      },
      {
        id: "actions",
        header: () => null,
        cell: ({ row }) => {
          const rentalId = row.original.rentalId;
          const topupId = row.original.topupId;

          if (!rentalId && !topupId) {
            return <span className="text-xs text-muted-foreground">-</span>;
          }

          return (
            <div className="flex flex-wrap justify-end gap-2">
              {rentalId ? (
                onOpenRental ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onOpenRental(rentalId)}
                    className="h-8 rounded-full border-black/10 bg-white/90 px-3 text-xs shadow-sm"
                  >
                    {isZh ? "租用" : "Rental"}
                  </Button>
                ) : (
                  <span className="font-mono text-xs text-muted-foreground">{shortId(rentalId)}</span>
                )
              ) : null}
              {topupId ? (
                onOpenTopup ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onOpenTopup(topupId)}
                    className="h-8 rounded-full border-black/10 bg-white/90 px-3 text-xs shadow-sm"
                  >
                    {isZh ? "充值" : "Topup"}
                  </Button>
                ) : (
                  <span className="font-mono text-xs text-muted-foreground">{shortId(topupId)}</span>
                )
              ) : null}
            </div>
          );
        },
      },
    ],
    [isZh, onOpenRental, onOpenTopup],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.entryId,
  });

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div>
          <div className="font-medium">Recent Wallet Ledger</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Credits, debits, and balance snapshots that drive wallet state.
          </div>
        </div>
        <Badge variant="outline" className="rounded-full px-3">
          {rows.length}
        </Badge>
      </div>

      {rows.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">No wallet ledger entries yet.</div>
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
                        cell.column.id === "entryId" && "whitespace-nowrap",
                        cell.column.id === "amount" && "text-right",
                        cell.column.id === "balanceAfter" && "text-right",
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

function shortId(value: string | null | undefined) {
  if (!value) return "-";
  return value.length > 12 ? `${value.slice(0, 8)}...` : value;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function formatSignedAmount(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}
