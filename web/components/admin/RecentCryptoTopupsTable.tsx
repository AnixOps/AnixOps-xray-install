"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";
import { useLocaleStore } from "@/lib/i18n/store";
import { formatTopupRailDescription, formatTopupRailLabel } from "@/lib/topup-rails";
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
import { isFormalRelease } from "@/lib/release-profile";

export interface RecentCryptoTopupRow {
  topupId: string;
  email: string | null;
  asset: string;
  network: string;
  rail: string;
  fiatAmount: number;
  currency: string;
  status: string;
  txHash: string | null;
  createdAt: string;
}

interface RecentCryptoTopupsTableProps {
  rows: RecentCryptoTopupRow[];
}

export function RecentCryptoTopupsTable({ rows }: RecentCryptoTopupsTableProps) {
  const { locale } = useLocaleStore();
  const isZh = locale === "zh";
  const formalRelease = isFormalRelease();
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);

  const columns = useMemo<ColumnDef<RecentCryptoTopupRow>[]>(
    () => [
      {
        id: "user",
        accessorFn: (row) => row.email || "",
        header: "User",
        cell: ({ row }) => <span className="text-sm">{row.original.email || "Unknown user"}</span>,
      },
      {
        id: "asset",
        accessorFn: (row) => `${row.asset} ${row.network}`,
        header: "Asset",
        cell: ({ row }) => (
          <div>
            <div className="font-medium tracking-tight">
              {row.original.asset} · {row.original.network}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              <Badge
                variant="outline"
                className="rounded-full px-2 py-0.5 text-[10px]"
                title={formatTopupRailDescription(row.original.rail, isZh)}
              >
                {formatTopupRailLabel(row.original.rail, isZh)}
              </Badge>
            </div>
          </div>
        ),
      },
      {
        id: "amount",
        accessorFn: (row) => row.fiatAmount,
        header: "Fiat",
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.fiatAmount.toFixed(2)} {row.original.currency.toUpperCase()}
          </span>
        ),
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={getStatusVariant(row.original.status)} className="rounded-full">
            {getStatusLabel(row.original.status, isZh)}
          </Badge>
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
        accessorFn: (row) => new Date(row.createdAt).getTime(),
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
    getRowId: (row) => row.topupId,
  });

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div>
          <div className="font-medium">
            {formalRelease
              ? (isZh ? "历史链上充值订单" : "Historical crypto topups")
              : (isZh ? "链上充值订单" : "Recent crypto topups")}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {formalRelease
              ? (isZh
                ? "历史链上充值记录，按最新活动排序。"
                : "Historical on-chain topup records, sorted by newest activity.")
              : (isZh
                ? "钱包支付和 X402 是不同的 rail，但都会汇总到这张表里。"
                : "Wallet payment and X402 are different rails, but they are summarized in this table.")}
          </div>
        </div>
        <Badge variant="outline" className="rounded-full px-3">
          {rows.length}
        </Badge>
      </div>

      {rows.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">
          {isZh ? "暂无链上充值订单。" : "No crypto topups yet."}
        </div>
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
                        "px-4 py-4",
                        cell.column.id === "asset" && "min-w-[230px]",
                        cell.column.id === "status" && "min-w-[120px]",
                        cell.column.id === "txHash" && "whitespace-nowrap",
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
  if (status === "completed") return "default";
  if (status === "pending") return "secondary";
  if (status === "short_paid" || status === "expired" || status === "cancelled" || status === "failed") {
    return "destructive";
  }
  return "outline";
}

function getStatusLabel(status: string, isZh: boolean) {
  switch (status) {
    case "pending":
      return isZh ? "待确认" : "Pending";
    case "completed":
      return isZh ? "已到账" : "Completed";
    case "short_paid":
      return isZh ? "金额不足" : "Short paid";
    case "expired":
      return isZh ? "已过期" : "Expired";
    case "cancelled":
      return isZh ? "已取消" : "Cancelled";
    case "failed":
      return isZh ? "失败" : "Failed";
    default:
      return status;
  }
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
