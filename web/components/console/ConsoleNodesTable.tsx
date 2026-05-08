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

export interface ConsoleNodeRow {
  id: string;
  protocol: string;
  status: string;
  ip: string | null;
  vpsId?: string | null;
  durationHours: number;
  totalPrice: number;
  pricePerHour?: number;
  paymentMethod: string | null;
  paymentStatus?: string | null;
  remainingMinutes: number;
  createdAt: string | null;
  startedAt?: string | null;
  expiresAt: string | null;
  probeSummary?: {
    status: string;
    decision: string;
    lastRunAt: string | null;
  };
}

interface ConsoleNodesTableProps {
  nodes: ConsoleNodeRow[];
  title: string;
  empty: string;
}

export function ConsoleNodesTable({ nodes, title, empty }: ConsoleNodesTableProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);

  const columns = useMemo<ColumnDef<ConsoleNodeRow>[]>(
    () => [
      {
        id: "protocol",
        accessorFn: (row) => row.protocol,
        header: "Protocol",
        cell: ({ row }) => (
          <div>
            <div className="font-medium tracking-tight">{row.original.protocol}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge variant={getNodeStatusVariant(row.original.status)} className="rounded-full">
                {row.original.status}
              </Badge>
              {row.original.probeSummary ? (
                <Badge variant="outline" className="rounded-full">
                  Probe: {row.original.probeSummary.status}
                </Badge>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        id: "identity",
        accessorFn: (row) => row.id,
        header: "Identity",
        cell: ({ row }) => (
          <div className="space-y-1 text-xs text-muted-foreground">
            <div className="font-mono">{shortId(row.original.id)}</div>
            <div>IP: {row.original.ip || "pending"}</div>
            <div>VPS: {row.original.vpsId || "-"}</div>
          </div>
        ),
      },
      {
        id: "remainingMinutes",
        accessorFn: (row) => row.remainingMinutes,
        header: "Remaining",
        cell: ({ row }) => (
          <div className="text-sm">
            <div className="font-medium">{formatMinutes(row.original.remainingMinutes)}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Duration {row.original.durationHours}h
            </div>
          </div>
        ),
      },
      {
        id: "expiresAt",
        accessorFn: (row) => (row.expiresAt ? new Date(row.expiresAt).getTime() : 0),
        header: "Expires",
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDateTime(row.original.expiresAt)}</span>,
      },
      {
        id: "price",
        accessorFn: (row) => row.totalPrice,
        header: "Price",
        cell: ({ row }) => (
          <div className="text-sm">
            <div className="font-medium">{formatMoney(row.original.totalPrice)}</div>
            <div className="mt-1 text-xs text-muted-foreground">{row.original.paymentMethod || "unknown"}</div>
          </div>
        ),
      },
      {
        id: "paymentStatus",
        accessorFn: (row) => row.paymentStatus || "",
        header: "Payment",
        cell: ({ row }) => (
          <Badge variant={getPaymentVariant(row.original.paymentStatus)} className="rounded-full">
            {row.original.paymentStatus || "-"}
          </Badge>
        ),
      },
      {
        id: "createdAt",
        accessorFn: (row) => (row.createdAt ? new Date(row.createdAt).getTime() : 0),
        header: "Created",
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>,
      },
    ],
    [],
  );

  const table = useReactTable({
    data: nodes,
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
          <div className="font-medium">{title}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Node status, IP, expiry, and payment data are grouped in one dense table.
          </div>
        </div>
        <Badge variant="outline" className="rounded-full px-3">
          {nodes.length}
        </Badge>
      </div>

      {nodes.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">{empty}</div>
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
                        cell.column.id === "identity" && "whitespace-nowrap",
                        cell.column.id === "paymentStatus" && "min-w-[120px]",
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

function getNodeStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (["active", "completed", "paid"].includes(status)) return "default";
  if (["failed", "destroyed", "expired", "short_paid", "cancelled"].includes(status)) return "destructive";
  if (["provisioning", "pending", "paused"].includes(status)) return "secondary";
  return "outline";
}

function getPaymentVariant(status: string | null | undefined): "default" | "secondary" | "destructive" | "outline" {
  if (!status) return "outline";
  if (["completed", "paid"].includes(status)) return "default";
  if (["failed", "destroyed", "expired", "short_paid", "cancelled"].includes(status)) return "destructive";
  if (["provisioning", "pending", "paused"].includes(status)) return "secondary";
  return "outline";
}

function shortId(value: string | null | undefined) {
  if (!value) return "-";
  return value.length > 12 ? `${value.slice(0, 8)}...` : value;
}

function formatMinutes(value: number) {
  const rounded = Math.trunc(value);
  const sign = rounded < 0 ? "-" : "";
  const absolute = Math.abs(rounded);
  if (absolute >= 1440) {
    const days = Math.floor(absolute / 1440);
    const hours = Math.floor((absolute % 1440) / 60);
    return `${sign}${days}d ${hours}h`;
  }
  if (absolute >= 60) {
    const hours = Math.floor(absolute / 60);
    const minutes = absolute % 60;
    return `${sign}${hours}h ${minutes}m`;
  }
  return `${sign}${absolute}m`;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value || 0);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}
