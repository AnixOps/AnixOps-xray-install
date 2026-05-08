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

export interface RecentRentalRow {
  rentalId: string;
  email: string | null;
  protocol: string;
  status: string;
  ip: string | null;
  durationHours: number;
  totalPrice: number;
  createdAt: string;
  expiresAt: string | null;
}

interface RecentRentalsTableProps {
  rows: RecentRentalRow[];
  onOpenRental?: (rentalId: string) => void;
}

export function RecentRentalsTable({ rows, onOpenRental }: RecentRentalsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);

  const columns = useMemo<ColumnDef<RecentRentalRow>[]>(
    () => [
      {
        id: "user",
        accessorFn: (row) => row.email || "",
        header: "User",
        cell: ({ row }) => <span className="text-sm">{row.original.email || "Unknown user"}</span>,
      },
      {
        id: "rentalId",
        accessorFn: (row) => row.rentalId,
        header: "Rental",
        cell: ({ row }) => (
          <div className="space-y-2">
            <div className="font-mono text-xs text-muted-foreground" title={row.original.rentalId}>
              {shortId(row.original.rentalId)}
            </div>
            {onOpenRental ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onOpenRental(row.original.rentalId)}
                className="h-8 rounded-full border-black/10 bg-white/90 px-3 text-xs shadow-sm"
              >
                Inspect
              </Button>
            ) : null}
          </div>
        ),
      },
      {
        id: "protocol",
        accessorFn: (row) => row.protocol,
        header: "Protocol",
        cell: ({ row }) => <span className="text-sm font-medium tracking-tight">{row.original.protocol}</span>,
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={getRentalStatusVariant(row.original.status)} className="rounded-full">
            {row.original.status}
          </Badge>
        ),
      },
      {
        id: "totalPrice",
        accessorFn: (row) => row.totalPrice,
        header: "Price",
        cell: ({ row }) => (
          <span className="font-medium">
            ${row.original.totalPrice.toFixed(2)}
          </span>
        ),
      },
      {
        id: "durationHours",
        accessorFn: (row) => row.durationHours,
        header: "Duration",
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.durationHours}h</span>,
      },
      {
        id: "createdAt",
        accessorFn: (row) => new Date(row.createdAt).getTime(),
        header: "Created",
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>,
      },
      {
        id: "expiresAt",
        accessorFn: (row) => (row.expiresAt ? new Date(row.expiresAt).getTime() : 0),
        header: "Expires",
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDateTime(row.original.expiresAt)}</span>,
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
    getRowId: (row) => row.rentalId,
  });

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div>
          <div className="font-medium">Recent Rentals</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Latest rental records across the system, sorted by newest activity.
          </div>
        </div>
        <Badge variant="outline" className="rounded-full px-3">
          {rows.length}
        </Badge>
      </div>

      {rows.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">No rentals yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[1180px]">
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
                        "px-4 py-4",
                        cell.column.id === "totalPrice" && "text-right",
                        cell.column.id === "rentalId" && "min-w-[180px]",
                        cell.column.id === "createdAt" && "text-xs",
                        cell.column.id === "expiresAt" && "text-xs",
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

function getRentalStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "active") return "default";
  if (status === "provisioning" || status === "pending") return "secondary";
  if (status === "expired" || status === "cancelled" || status === "failed") return "destructive";
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
