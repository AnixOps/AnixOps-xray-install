"use client";

import { Card, Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui";

interface SystemHealthChecksTableProps {
  rows: Array<{
    name: string;
    ok: boolean;
    error?: string;
  }>;
}

export function SystemHealthChecksTable({ rows }: SystemHealthChecksTableProps) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div>
          <div className="font-medium">Runtime Checks</div>
          <div className="mt-1 text-sm text-muted-foreground">
            API dependency probes used to gate provisioning.
          </div>
        </div>
        <Badge variant="outline" className="rounded-full px-3">
          {rows.length}
        </Badge>
      </div>

      {rows.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">No system health checks yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[760px]">
            <TableHeader className="bg-muted/40 text-left text-muted-foreground">
              <TableRow>
                <TableHead>Check</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.name}>
                  <TableCell className="px-4 py-4">
                    <div className="font-medium tracking-tight capitalize">{row.name}</div>
                  </TableCell>
                  <TableCell className="px-4 py-4">
                    <Badge variant={row.ok ? "default" : "destructive"} className="rounded-full">
                      {row.ok ? "ok" : "failed"}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-4 py-4">
                    <div
                      className={`max-w-[460px] break-words text-sm ${
                        row.error ? "text-red-600" : "text-muted-foreground"
                      }`}
                    >
                      {row.error || "-"}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}
