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
import { Badge, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui";
import { cn } from "@/components/ui/utils";
import { useLocaleStore } from "@/lib/i18n/store";
import {
  classifyAdminPaymentBucket,
  formatAdminPaymentMethod,
  formatPaymentBucketLabel,
  getPaymentBucketVariant,
  getPaymentStatusVariant,
} from "./payment-utils";

export interface RecentPaymentRow {
  paymentId: string;
  rentalId: string | null;
  email: string | null;
  amount: number;
  currency: string;
  method: string | null;
  status: string;
  createdAt: string;
}

interface RecentPaymentsTableProps {
  rows: RecentPaymentRow[];
  onOpenRental?: (rentalId: string) => void;
}

export function RecentPaymentsTable({ rows, onOpenRental }: RecentPaymentsTableProps) {
  const { locale } = useLocaleStore();
  const isZh = locale === "zh";
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);

  const columns = useMemo<ColumnDef<RecentPaymentRow>[]>(
    () => [
      {
        id: "email",
        accessorFn: (row) => row.email || "",
        header: "User",
        cell: ({ row }) => <span className="text-sm">{row.original.email || "Unknown user"}</span>,
      },
      {
        id: "bucket",
        accessorFn: (row) => classifyAdminPaymentBucket(row.method),
        header: "Bucket",
        cell: ({ row }) => {
          const bucket = classifyAdminPaymentBucket(row.original.method);
          return (
            <Badge variant={getPaymentBucketVariant(bucket)} className="rounded-full">
              {formatPaymentBucketLabel(bucket, isZh)}
            </Badge>
          );
        },
      },
      {
        id: "method",
        accessorFn: (row) => formatAdminPaymentMethod(row.method, isZh),
        header: "Method",
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatAdminPaymentMethod(row.original.method, isZh)}</span>,
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
          <Badge variant={getPaymentStatusVariant(row.original.status)} className="rounded-full">
            {row.original.status}
          </Badge>
        ),
      },
      {
        id: "rentalId",
        accessorFn: (row) => row.rentalId || "",
        header: "Rental",
        cell: ({ row }) =>
          row.original.rentalId && onOpenRental ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenRental(row.original.rentalId as string)}
              className="h-8 rounded-full border-black/10 bg-white/90 px-3 text-xs shadow-sm"
            >
              Inspect
            </Button>
          ) : (
            <span className="font-mono text-xs text-muted-foreground">{row.original.rentalId || "-"}</span>
          ),
      },
      {
        id: "createdAt",
        accessorFn: (row) => new Date(row.createdAt).getTime(),
        header: "Created",
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{new Date(row.original.createdAt).toLocaleString()}</span>,
      },
    ],
    [isZh, onOpenRental],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.paymentId,
  });

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-border/70 bg-card/95 p-6 text-sm text-muted-foreground shadow-sm">
        No checkout records yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/95 shadow-sm">
      <div className="overflow-x-auto">
        <Table className="min-w-[1120px]">
          <TableHeader className="bg-muted/40 text-left text-muted-foreground">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  const headerLabel = flexRender(header.column.columnDef.header, header.getContext());

                  return (
                    <TableHead
                      key={header.id}
                      className={cn(
                        header.column.id === "amount" && "text-right",
                        header.column.id === "rentalId" && "text-center",
                      )}
                    >
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
                      cell.column.id === "rentalId" && "text-center",
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
    </div>
  );
}
