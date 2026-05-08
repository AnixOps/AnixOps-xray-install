"use client";

import { Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge } from "@/components/ui";

interface ChainModeReadinessTableProps {
  readiness: {
    environment: "testnet" | "mainnet";
    cryptoTopup: {
      enabled: boolean;
      missingKeys: string[];
    };
    auditAnchor: {
      enabled: boolean;
      missingKeys: string[];
    };
  };
}

export function ChainModeReadinessTable({ readiness }: ChainModeReadinessTableProps) {
  const rows = [
    {
      subsystem: "Crypto Topup",
      enabled: readiness.cryptoTopup.enabled,
      missingKeys: readiness.cryptoTopup.missingKeys,
    },
    {
      subsystem: "Audit Anchor",
      enabled: readiness.auditAnchor.enabled,
      missingKeys: readiness.auditAnchor.missingKeys,
    },
  ];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div>
          <div className="font-medium">Readiness Matrix</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Required chain-backed features and the keys they still need.
          </div>
        </div>
        <Badge variant="outline" className="rounded-full px-3">
          {readiness.environment}
        </Badge>
      </div>

      <div className="overflow-x-auto">
        <Table className="min-w-[760px]">
          <TableHeader className="bg-muted/40 text-left text-muted-foreground">
            <TableRow>
              <TableHead>Subsystem</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Missing Keys</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const missing = row.missingKeys.length > 0 ? row.missingKeys.join(", ") : "-";

              return (
                <TableRow key={row.subsystem}>
                  <TableCell className="px-4 py-4">
                    <div className="font-medium tracking-tight">{row.subsystem}</div>
                  </TableCell>
                  <TableCell className="px-4 py-4">
                    <Badge variant={row.enabled ? "default" : "destructive"} className="rounded-full">
                      {row.enabled ? "ready" : "disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-4 py-4">
                    <div className="max-w-[460px] break-words text-sm text-muted-foreground" title={missing}>
                      {missing}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
