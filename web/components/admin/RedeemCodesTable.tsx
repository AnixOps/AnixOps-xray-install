"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown, ChevronDown, ChevronUp, Edit2, Trash2 } from "lucide-react";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Badge, Button, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui";
import { cn } from "@/components/ui/utils";
import { useLocaleStore } from "@/lib/i18n/store";
import { formatRedeemCodeTypeLabel } from "@/lib/payment-records";

export interface RedeemCodeRow {
  redeem_codes: {
    id: string;
    code: string;
    codeType: "duration" | "wallet";
    durationHours: number;
    walletAmount: number | null;
    usedBy: string | null;
    usedAt: string | null;
    expiresAt: string | null;
    createdAt: string;
  };
  users: {
    id: string;
    email: string | null;
  } | null;
}

interface RedeemCodesTableProps {
  rows: RedeemCodeRow[];
  selectedCodeIds: string[];
  allVisibleSelected: boolean;
  editingCodeId: string | null;
  editingValue: string;
  editingExpiresAt: string;
  onToggleSelectAllVisible: () => void;
  onToggleCodeSelection: (id: string) => void;
  onStartEdit: (row: RedeemCodeRow) => void;
  onCancelEdit: () => void;
  onUpdateCode: () => void;
  onDeleteCode: (row: RedeemCodeRow) => void;
  onEditingValueChange: (value: string) => void;
  onEditingExpiresAtChange: (value: string) => void;
}

export function RedeemCodesTable({
  rows,
  selectedCodeIds,
  allVisibleSelected,
  editingCodeId,
  editingValue,
  editingExpiresAt,
  onToggleSelectAllVisible,
  onToggleCodeSelection,
  onStartEdit,
  onCancelEdit,
  onUpdateCode,
  onDeleteCode,
  onEditingValueChange,
  onEditingExpiresAtChange,
}: RedeemCodesTableProps) {
  const { locale } = useLocaleStore();
  const isZh = locale === "zh";
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);

  const columns = useMemo<ColumnDef<RedeemCodeRow>[]>(
    () => [
      {
        id: "select",
        header: () => null,
        cell: ({ row }) => {
          const code = row.original.redeem_codes;
          const used = Boolean(code.usedBy);

          return (
            <input
              type="checkbox"
              checked={selectedCodeIds.includes(code.id)}
              disabled={used}
              onChange={() => onToggleCodeSelection(code.id)}
              className="h-4 w-4"
            />
          );
        },
      },
      {
        id: "code",
        accessorFn: (row) => row.redeem_codes.code,
        header: "Code",
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.redeem_codes.code}</span>,
      },
      {
        id: "durationHours",
        accessorFn: (row) => row.redeem_codes.codeType === "wallet" ? row.redeem_codes.walletAmount || 0 : row.redeem_codes.durationHours,
        header: "Value",
        cell: ({ row }) => {
          const code = row.original.redeem_codes;
          const isEditing = editingCodeId === code.id;
          const isWalletCode = code.codeType === "wallet";

          return isEditing ? (
            <Input
              value={editingValue}
              onChange={(e) => onEditingValueChange(e.target.value)}
              type="number"
              min={isWalletCode ? "0.01" : "1"}
              step={isWalletCode ? "0.01" : "1"}
              className="h-9 w-28 rounded-xl"
            />
          ) : isWalletCode ? (
            `$${Number(code.walletAmount || 0).toFixed(2)}`
          ) : (
            `${code.durationHours}h`
          );
        },
      },
      {
        id: "codeType",
        accessorFn: (row) => row.redeem_codes.codeType,
        header: "Type",
        cell: ({ row }) => {
          const code = row.original.redeem_codes;
          const isWalletCode = code.codeType === "wallet";
          return (
            <Badge variant={isWalletCode ? "default" : "secondary"} className="rounded-full">
              {formatRedeemCodeTypeLabel(code.codeType, isZh)}
            </Badge>
          );
        },
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => {
          const used = Boolean(row.original.redeem_codes.usedBy);
          return (
            <Badge variant={used ? "secondary" : "default"} className="rounded-full">
              {used ? "Used" : "Available"}
            </Badge>
          );
        },
      },
      {
        id: "usedBy",
        header: "Used By",
        cell: ({ row }) => <span className="text-xs">{row.original.users?.email || "-"}</span>,
      },
      {
        id: "expiresAt",
        accessorFn: (row) => (row.redeem_codes.expiresAt ? new Date(row.redeem_codes.expiresAt).getTime() : 0),
        header: "Expires",
        cell: ({ row }) => {
          const code = row.original.redeem_codes;
          const isEditing = editingCodeId === code.id;

          return isEditing ? (
            <Input
              value={editingExpiresAt}
              onChange={(e) => onEditingExpiresAtChange(e.target.value)}
              type="datetime-local"
              className="h-9 min-w-[180px] rounded-xl"
            />
          ) : code.expiresAt ? (
            new Date(code.expiresAt).toLocaleString()
          ) : (
            "-"
          );
        },
      },
      {
        id: "createdAt",
        accessorFn: (row) => new Date(row.redeem_codes.createdAt).getTime(),
        header: "Created",
        cell: ({ row }) => <span className="text-xs">{new Date(row.original.redeem_codes.createdAt).toLocaleString()}</span>,
      },
      {
        id: "actions",
        header: () => null,
        cell: ({ row }) => {
          const code = row.original.redeem_codes;
          const used = Boolean(code.usedBy);
          const isEditing = editingCodeId === code.id;

          if (isEditing) {
            return (
              <div className="flex justify-end gap-2">
                <Button size="sm" onClick={onUpdateCode} className="rounded-xl">
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onCancelEdit}
                  className="rounded-xl"
                >
                  Cancel
                </Button>
              </div>
            );
          }

          return (
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onStartEdit(row.original)}
                className="rounded-xl"
              >
                <Edit2 className="h-3.5 w-3.5" />
                Edit
              </Button>
              {!used && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => onDeleteCode(row.original)}
                  className="rounded-xl"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [
      editingCodeId,
      editingValue,
      editingExpiresAt,
      onCancelEdit,
      onDeleteCode,
      onEditingValueChange,
      onEditingExpiresAtChange,
      onStartEdit,
      onToggleCodeSelection,
      onUpdateCode,
      selectedCodeIds,
      isZh,
    ],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.redeem_codes.id,
  });

  const selectableRows = table.getRowModel().rows.filter((row) => !row.original.redeem_codes.usedBy);
  const canSelectAll = selectableRows.length > 0;

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-border/70 bg-card/95 p-6 text-sm text-muted-foreground shadow-sm">
        No redeem codes match the current filter.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/95 shadow-sm">
      <div className="overflow-x-auto">
        <Table className="min-w-[1220px]">
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
                        header.column.id === "select" && "w-12 px-4",
                        header.column.id === "actions" && "text-right",
                      )}
                    >
                      {header.isPlaceholder ? null : header.column.id === "select" ? (
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          disabled={!canSelectAll}
                          onChange={onToggleSelectAllVisible}
                          className="h-4 w-4"
                        />
                      ) : canSort ? (
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
                      cell.column.id === "actions" && "text-right",
                      cell.column.id === "code" && "font-mono text-xs",
                      cell.column.id === "codeType" && "min-w-[140px]",
                      cell.column.id === "usedBy" && "text-xs",
                      cell.column.id === "expiresAt" && "text-xs",
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
