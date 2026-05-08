"use client";

import { useLocaleStore } from "@/lib/i18n/store";
import { formatRedeemCodeTypeLabel } from "@/lib/payment-records";
import { Card, Badge, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui";

export interface CodeTemplateRow {
  label: string;
  codeType: "duration" | "wallet";
  durationHours?: number;
  walletAmount?: number;
  count: number;
  note: string;
}

interface CodeTemplatesTableProps {
  templates: CodeTemplateRow[];
  onApplyTemplate: (template: CodeTemplateRow) => void;
}

export function CodeTemplatesTable({ templates, onApplyTemplate }: CodeTemplatesTableProps) {
  const { locale } = useLocaleStore();
  const isZh = locale === "zh";
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div>
          <div className="font-medium">Template Presets</div>
          <div className="mt-1 text-sm text-muted-foreground">
            One-click starter batches for redeem-code generation.
          </div>
        </div>
        <Badge variant="outline" className="rounded-full px-3">
          {templates.length}
        </Badge>
      </div>

      {templates.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">No code templates configured.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[960px]">
            <TableHeader className="bg-muted/40 text-left text-muted-foreground">
              <TableRow>
                <TableHead>Template</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Count</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={template.label}>
                  <TableCell className="px-4 py-4">
                    <div className="font-medium tracking-tight">{template.label}</div>
                  </TableCell>
                  <TableCell className="px-4 py-4">
                    <Badge variant="outline" className="rounded-full px-2.5 py-0.5 text-xs">
                      {formatRedeemCodeTypeLabel(template.codeType, isZh)}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-4 py-4">
                    <span className="text-sm text-muted-foreground">
                      {template.codeType === "wallet"
                        ? `$${Number(template.walletAmount || 0).toFixed(2)}`
                        : `${template.durationHours || 0}h`}
                    </span>
                  </TableCell>
                  <TableCell className="px-4 py-4">
                    <span className="text-sm text-muted-foreground">{template.count} codes</span>
                  </TableCell>
                  <TableCell className="px-4 py-4">
                    <div className="max-w-[380px] text-sm text-muted-foreground">{template.note}</div>
                  </TableCell>
                  <TableCell className="px-4 py-4 text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onApplyTemplate(template)}
                      className="h-8 rounded-full border-black/10 bg-white/90 px-3 text-xs shadow-sm"
                    >
                      Apply
                    </Button>
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
