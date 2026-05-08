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
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui";
import { cn } from "@/components/ui/utils";
import { formatWalletLedgerTypeLabel } from "@/lib/payment-records";
import { useLocaleStore } from "@/lib/i18n/store";

export interface WalletEntryRow {
  id: string;
  type?: string;
  rentalId?: string | null;
  amount: number;
  currency: string;
  method?: string | null;
  status: string;
  createdAt: string | null;
}

interface WalletEntriesTableProps {
  rows: WalletEntryRow[];
  empty: string;
}

export function WalletEntriesTable({ rows, empty }: WalletEntriesTableProps) {
  const { locale } = useLocaleStore();
  const isZh = locale === "zh";
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);

  const columns = useMemo<ColumnDef<WalletEntryRow>[]>(
    () => [
      {
        id: "type",
        accessorFn: (row) => row.type || "",
        header: "Type",
        cell: ({ row }) => <span className="text-sm font-medium">{row.original.type || "-"}</span>,
      },
      {
        id: "source",
        accessorFn: (row) => formatWalletLedgerTypeLabel(row.type || row.method, isZh),
        header: "Source",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {formatWalletLedgerTypeLabel(row.original.type || row.original.method, isZh)}
          </span>
        ),
      },
      {
        id: "amount",
        accessorFn: (row) => row.amount,
        header: "Amount",
        cell: ({ row }) => (
          <span className={cn("font-medium", row.original.amount < 0 && "text-destructive")}>
            {row.original.amount >= 0 ? "+" : ""}
            {row.original.amount.toFixed(2)} {row.original.currency.toUpperCase()}
          </span>
        ),
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        header: "Status",
        cell: ({ row }) => {
          const status = row.original.status;
          const variant = status === "failed" ? "destructive" : status === "completed" || status === "paid" ? "default" : "secondary";
          return (
            <Badge variant={variant} className="rounded-full">
              {status}
            </Badge>
          );
        },
      },
      {
        id: "rental",
        accessorFn: (row) => row.rentalId || "",
        header: "Rental",
        cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.rentalId || "-"}</span>,
      },
      {
        id: "createdAt",
        accessorFn: (row) => (row.createdAt ? new Date(row.createdAt).getTime() : 0),
        header: "Created",
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>,
      },
    ],
    [isZh],
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

  if (rows.length === 0) {
    return <div className="text-sm text-muted-foreground">{empty}</div>;
  }

  return (
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
                <TableCell key={cell.id} className="px-4 py-4">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}
