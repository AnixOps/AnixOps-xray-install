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

export interface RecentAnchorBatchRow {
  batchId: string;
  eventCount: number;
  merkleRoot: string;
  status: string;
  chain: string | null;
  txHash: string | null;
  hasReceipt: boolean;
  receiptSummary: {
    blockNumber: number | null;
    status: number | null;
    gasUsed: string | null;
    from: string | null;
    to: string | null;
  } | null;
  submissionStartedAt: string | null;
  createdAt: string | null;
  anchoredAt: string | null;
}

interface RecentAnchorBatchesTableProps {
  rows: RecentAnchorBatchRow[];
  onVerify?: (batchId: string) => void;
  verifyingBatchId?: string | null;
}

export function RecentAnchorBatchesTable({ rows, onVerify, verifyingBatchId }: RecentAnchorBatchesTableProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);

  const columns = useMemo<ColumnDef<RecentAnchorBatchRow>[]>(
    () => [
      {
        id: "batchId",
        accessorFn: (row) => row.batchId,
        header: "Batch",
        cell: ({ row }) => (
          <div>
            <div className="font-mono text-xs font-medium">{shortId(row.original.batchId)}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {shortId(row.original.merkleRoot)}
            </div>
          </div>
        ),
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={getStatusVariant(row.original.status)} className="rounded-full">
            {row.original.status}
          </Badge>
        ),
      },
      {
        id: "chain",
        accessorFn: (row) => row.chain || "",
        header: "Chain",
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.chain || "-"}</span>,
      },
      {
        id: "events",
        accessorFn: (row) => row.eventCount,
        header: "Events",
        cell: ({ row }) => <span className="font-medium">{row.original.eventCount}</span>,
      },
      {
        id: "receipt",
        accessorFn: (row) => Number(row.receiptSummary?.blockNumber || 0),
        header: "Receipt",
        cell: ({ row }) => (
          <div className="space-y-1 text-xs text-muted-foreground">
            <div>{row.original.hasReceipt ? "Receipt present" : "Receipt missing"}</div>
            {row.original.receiptSummary ? (
              <div>
                block {row.original.receiptSummary.blockNumber ?? "-"} · status {row.original.receiptSummary.status ?? "-"} · gas{" "}
                {row.original.receiptSummary.gasUsed || "-"}
              </div>
            ) : (
              <div>{row.original.txHash ? "Can be recovered from txHash" : "No txHash recorded"}</div>
            )}
          </div>
        ),
      },
      {
        id: "txHash",
        accessorFn: (row) => row.txHash || "",
        header: "Tx",
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground" title={row.original.txHash || undefined}>
            {shortId(row.original.txHash)}
          </span>
        ),
      },
      {
        id: "createdAt",
        accessorFn: (row) => (row.createdAt ? new Date(row.createdAt).getTime() : 0),
        header: "Created",
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>,
      },
      {
        id: "anchoredAt",
        accessorFn: (row) => (row.anchoredAt ? new Date(row.anchoredAt).getTime() : 0),
        header: "Anchored",
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDateTime(row.original.anchoredAt)}</span>,
      },
      {
        id: "actions",
        header: () => null,
        cell: ({ row }) =>
          onVerify ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onVerify(row.original.batchId)}
              disabled={verifyingBatchId === row.original.batchId}
              className="h-8 rounded-full border-black/10 bg-white/90 px-3 text-xs shadow-sm"
            >
              {verifyingBatchId === row.original.batchId ? "Verifying..." : "Verify"}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          ),
      },
    ],
    [onVerify, verifyingBatchId],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.batchId,
  });

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div>
          <div className="font-medium">Recent Audit Anchors</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Anchor batches, chain receipts, and recovery hints for audit verification.
          </div>
        </div>
        <Badge variant="outline" className="rounded-full px-3">
          {rows.length}
        </Badge>
      </div>

      {rows.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">No audit anchor batches yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[1340px]">
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
                        cell.column.id === "batchId" && "min-w-[220px]",
                        cell.column.id === "status" && "min-w-[120px]",
                        cell.column.id === "txHash" && "whitespace-nowrap",
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
  if (status === "anchored") return "default";
  if (status === "pending" || status === "verifying") return "secondary";
  if (status === "failed" || status === "rejected") return "destructive";
  return "outline";
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
