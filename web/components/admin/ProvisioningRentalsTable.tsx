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

export interface ProvisioningRentalRow {
  rentalId: string;
  email: string | null;
  protocol: string;
  status: string;
  ip: string | null;
  vpsId: string | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  ageMinutes: number;
  expiresInMinutes: number | null;
  isStale: boolean;
  canRelease: boolean;
  queueJob: {
    id: string;
    name: string;
    state: string;
    attemptsMade: number;
    attempts: number | null;
    timestamp: number | null;
    processedOn: number | null;
    finishedOn: number | null;
    failedReason: string | null;
  } | null;
  lastAudit: {
    action: string;
    detail: string | null;
    createdAt: string;
  } | null;
}

interface ProvisioningRentalsTableProps {
  rows: ProvisioningRentalRow[];
  generatedAt: string;
  onOpenRental: (rentalId: string) => void;
  onRelease: (rentalId: string) => void;
  loadingRentalId?: string | null;
  releasingRentalId?: string | null;
}

export function ProvisioningRentalsTable({
  rows,
  generatedAt,
  onOpenRental,
  onRelease,
  loadingRentalId,
  releasingRentalId,
}: ProvisioningRentalsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "ageMinutes", desc: true }]);

  const columns = useMemo<ColumnDef<ProvisioningRentalRow>[]>(
    () => [
      {
        id: "rental",
        accessorFn: (row) => row.email || "",
        header: "Rental",
        cell: ({ row }) => (
          <div className="space-y-1.5">
            <div className="text-sm font-medium tracking-tight">{row.original.email || "Unknown user"}</div>
            <div className="font-mono text-xs text-muted-foreground" title={row.original.rentalId}>
              {shortId(row.original.rentalId)}
            </div>
            <div className="text-xs text-muted-foreground">{row.original.protocol}</div>
          </div>
        ),
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        header: "State",
        cell: ({ row }) => (
          <div className="space-y-2">
            <Badge variant={getStatusVariant(row.original.status)} className="rounded-full">
              {row.original.status}
            </Badge>
            <div>
              <Badge variant={row.original.isStale ? "destructive" : "secondary"} className="rounded-full">
                {row.original.isStale ? "stale" : "deploying"}
              </Badge>
            </div>
          </div>
        ),
      },
      {
        id: "machine",
        accessorFn: (row) => `${row.ip || ""} ${row.vpsId || ""}`,
        header: "Machine",
        cell: ({ row }) => (
          <div className="space-y-1 text-xs text-muted-foreground">
            <div title={row.original.ip || undefined}>IP: {row.original.ip || "-"}</div>
            <div title={row.original.vpsId || undefined}>VPS: {row.original.vpsId || "-"}</div>
          </div>
        ),
      },
      {
        id: "payment",
        accessorFn: (row) => `${row.paymentMethod || ""} ${row.paymentStatus || ""}`,
        header: "Payment",
        cell: ({ row }) => (
          <div className="text-xs text-muted-foreground">
            {row.original.paymentMethod || "-"} / {row.original.paymentStatus || "-"}
          </div>
        ),
      },
      {
        id: "timing",
        accessorFn: (row) => row.ageMinutes,
        header: "Timing",
        cell: ({ row }) => (
          <div className="space-y-1 text-xs text-muted-foreground">
            <div>Age: {formatMinutes(row.original.ageMinutes)}</div>
            <div>
              Expires: {row.original.expiresInMinutes === null ? "-" : formatMinutes(row.original.expiresInMinutes)}
            </div>
          </div>
        ),
      },
      {
        id: "queue",
        accessorFn: (row) => row.queueJob?.name || "",
        header: "Queue",
        cell: ({ row }) =>
          row.original.queueJob ? (
            <div className="space-y-1 text-xs text-muted-foreground">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={row.original.queueJob.state === "failed" ? "destructive" : "outline"} className="rounded-full">
                  {row.original.queueJob.state}
                </Badge>
                <span className="font-medium text-foreground">{row.original.queueJob.name}</span>
              </div>
              <div>
                attempts {row.original.queueJob.attemptsMade}/{row.original.queueJob.attempts ?? "?"} | last{" "}
                {formatJobTime(row.original.queueJob)}
              </div>
              {row.original.queueJob.failedReason && (
                <div className="break-words text-red-600">{row.original.queueJob.failedReason}</div>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          ),
      },
      {
        id: "audit",
        accessorFn: (row) => row.lastAudit?.action || "",
        header: "Last Audit",
        cell: ({ row }) =>
          row.original.lastAudit ? (
            <div className="space-y-1 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">{row.original.lastAudit.action}</div>
              {row.original.lastAudit.detail && <div className="break-words">{row.original.lastAudit.detail}</div>}
              <div>{formatDateTime(row.original.lastAudit.createdAt)}</div>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          ),
      },
      {
        id: "actions",
        header: () => null,
        cell: ({ row }) => (
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onOpenRental(row.original.rentalId)}
              disabled={loadingRentalId === row.original.rentalId}
              className="h-8 rounded-full border-black/10 bg-white/90 px-3 text-xs shadow-sm"
            >
              {loadingRentalId === row.original.rentalId ? "Loading..." : "Inspect"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => onRelease(row.original.rentalId)}
              disabled={!row.original.canRelease || releasingRentalId === row.original.rentalId}
              className="h-8 rounded-full px-3 text-xs"
            >
              {releasingRentalId === row.original.rentalId ? "Releasing..." : "Release"}
            </Button>
          </div>
        ),
      },
    ],
    [loadingRentalId, onOpenRental, onRelease, releasingRentalId],
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
          <div className="font-medium">Provisioning Rentals</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Stuck and active rental records, with queue and audit summaries inline.
          </div>
          <div className="mt-1 text-xs text-muted-foreground">Generated {formatDateTime(generatedAt)}</div>
        </div>
        <Badge variant="outline" className="rounded-full px-3">
          {rows.length}
        </Badge>
      </div>

      {rows.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">No rentals are currently provisioning.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[1540px]">
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
                        className={cn(header.column.id === "actions" && "text-right")}
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
                        "px-4 py-4 align-top",
                        cell.column.id === "rental" && "min-w-[220px]",
                        cell.column.id === "status" && "min-w-[120px]",
                        cell.column.id === "machine" && "min-w-[150px]",
                        cell.column.id === "payment" && "min-w-[170px]",
                        cell.column.id === "timing" && "min-w-[150px]",
                        cell.column.id === "queue" && "min-w-[300px]",
                        cell.column.id === "audit" && "min-w-[260px]",
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

function getStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "active") return "default";
  if (status === "provisioning" || status === "pending") return "secondary";
  if (status === "expired" || status === "cancelled" || status === "failed") return "destructive";
  return "outline";
}

function shortId(value: string) {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function formatMinutes(minutes: number) {
  const absolute = Math.abs(minutes);
  const sign = minutes < 0 ? "-" : "";
  if (absolute >= 60) {
    const hours = Math.floor(absolute / 60);
    const remainder = absolute % 60;
    return `${sign}${hours}h ${remainder}m`;
  }
  return `${sign}${absolute}m`;
}

function formatJobTime(job: { finishedOn: number | null; processedOn: number | null; timestamp: number | null } | null) {
  if (!job) return "-";
  const value = job.finishedOn ?? job.processedOn ?? job.timestamp;
  return value ? new Date(value).toLocaleString() : "-";
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}
