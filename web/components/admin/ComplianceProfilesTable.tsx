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

export interface ComplianceProfileRow {
  id: string;
  name: string;
  mode: "standard" | "restricted";
  version: string;
  blockedProtocols: string[];
  allowedPorts: number[];
  allowedCidrs: string[];
  isDefault: boolean;
}

interface ComplianceProfilesTableProps {
  rows: ComplianceProfileRow[];
}

export function ComplianceProfilesTable({ rows }: ComplianceProfilesTableProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);

  const columns = useMemo<ColumnDef<ComplianceProfileRow>[]>(
    () => [
      {
        id: "name",
        accessorFn: (row) => row.name,
        header: "Profile",
        cell: ({ row }) => (
          <div>
            <div className="font-medium tracking-tight">{row.original.name}</div>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground" title={row.original.id}>
              {shortId(row.original.id)} · {row.original.version}
            </div>
          </div>
        ),
      },
      {
        id: "mode",
        accessorFn: (row) => row.mode,
        header: "Mode",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-2">
            <Badge variant={row.original.mode === "standard" ? "default" : "secondary"} className="rounded-full">
              {row.original.mode}
            </Badge>
            {row.original.isDefault ? (
              <Badge variant="outline" className="rounded-full">
                default
              </Badge>
            ) : null}
          </div>
        ),
      },
      {
        id: "blockedProtocols",
        accessorFn: (row) => row.blockedProtocols.join(", "),
        header: "Blocked",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.blockedProtocols.length > 0 ? row.original.blockedProtocols.join(", ") : "none"}
          </span>
        ),
      },
      {
        id: "allowedPorts",
        accessorFn: (row) => row.allowedPorts.join(", "),
        header: "Ports",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.allowedPorts.length > 0 ? row.original.allowedPorts.join(", ") : "all"}
          </span>
        ),
      },
      {
        id: "allowedCidrs",
        accessorFn: (row) => row.allowedCidrs.join(", "),
        header: "CIDRs",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.allowedCidrs.length > 0 ? row.original.allowedCidrs.join(", ") : "all"}
          </span>
        ),
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
    getRowId: (row) => row.id,
  });

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div>
          <div className="font-medium">Compliance Profiles</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Policy profiles and their traffic restrictions.
          </div>
        </div>
        <Badge variant="outline" className="rounded-full px-3">
          {rows.length}
        </Badge>
      </div>

      {rows.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">No compliance profiles yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[1040px]">
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
                        "px-4 py-4 align-top",
                        cell.column.id === "name" && "min-w-[220px]",
                        cell.column.id === "mode" && "min-w-[160px]",
                        cell.column.id === "blockedProtocols" && "min-w-[180px]",
                        cell.column.id === "allowedPorts" && "min-w-[180px]",
                        cell.column.id === "allowedCidrs" && "min-w-[220px]",
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

function shortId(value: string) {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}
