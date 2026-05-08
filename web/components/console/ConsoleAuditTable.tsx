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

export interface ConsoleAuditRow {
  id: number;
  rentalId: string | null;
  action: string;
  detail: string | null;
  createdAt: string | null;
}

interface ConsoleAuditTableProps {
  entries: ConsoleAuditRow[];
  title: string;
  empty: string;
}

export function ConsoleAuditTable({ entries, title, empty }: ConsoleAuditTableProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);

  const columns = useMemo<ColumnDef<ConsoleAuditRow>[]>(
    () => [
      {
        id: "action",
        accessorFn: (row) => row.action,
        header: "Action",
        cell: ({ row }) => <span className="font-medium tracking-tight">{row.original.action}</span>,
      },
      {
        id: "rentalId",
        accessorFn: (row) => row.rentalId || "",
        header: "Rental",
        cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{shortId(row.original.rentalId)}</span>,
      },
      {
        id: "detail",
        accessorFn: (row) => row.detail || "",
        header: "Detail",
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.detail || "-"}</span>,
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
    data: entries,
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
          <div className="font-medium">{title}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Latest state-changing events shown in a compact table for quicker scanning.
          </div>
        </div>
        <Badge variant="outline" className="rounded-full px-3">
          {entries.length}
        </Badge>
      </div>

      {entries.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">{empty}</div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[900px]">
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
                    <TableCell key={cell.id} className={cn("px-4 py-4", cell.column.id === "detail" && "max-w-[520px]")}>
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
