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
import { Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui";
import { cn } from "@/components/ui/utils";

export interface SearchUserRow {
  userId: string;
  email: string | null;
  createdAt: string;
}

interface SearchUsersTableProps {
  rows: SearchUserRow[];
}

export function SearchUsersTable({ rows }: SearchUsersTableProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);

  const columns = useMemo<ColumnDef<SearchUserRow>[]>(
    () => [
      {
        id: "email",
        accessorFn: (row) => row.email || "",
        header: "User",
        cell: ({ row }) => <span className="text-sm font-medium tracking-tight">{row.original.email || "Unknown"}</span>,
      },
      {
        id: "userId",
        accessorFn: (row) => row.userId,
        header: "User ID",
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground" title={row.original.userId}>
            {shortId(row.original.userId)}
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
    [],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.userId,
  });

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b p-4">
        <div>
          <div className="font-medium">Users</div>
          <div className="mt-1 text-sm text-muted-foreground">Matched user records for the current search.</div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">No users matched.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[700px]">
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
                      className={cn("px-4 py-4", cell.column.id === "createdAt" && "text-xs")}
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

function shortId(value: string) {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}
