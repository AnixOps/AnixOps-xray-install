"use client";

import type { ReactNode } from "react";
import { Badge, Button, Card, Input, Label } from "@/components/ui";
import { CodeTemplatesTable, type CodeTemplateRow } from "@/components/admin/CodeTemplatesTable";
import { RedeemCodesTable, type RedeemCodeRow } from "@/components/admin/RedeemCodesTable";
import { formatRedeemCodeTypeLabel } from "@/lib/payment-records";

const CODE_TEMPLATES = [
  {
    label: "CDK Balance $10",
    codeType: "wallet" as const,
    walletAmount: 10,
    count: 10,
    note: "Balance topup CDKs for wallet credit.",
  },
  {
    label: "CDK Balance $25",
    codeType: "wallet" as const,
    walletAmount: 25,
    count: 10,
    note: "Medium-value balance topup batch.",
  },
  {
    label: "CDK 1h",
    codeType: "duration" as const,
    durationHours: 1,
    count: 10,
    note: "Fast-access one-time rental batch.",
  },
  {
    label: "CDK 24h",
    codeType: "duration" as const,
    durationHours: 24,
    count: 20,
    note: "Default single-day package.",
  },
];

const CODE_FILTERS: Array<{ id: "all" | "available" | "used"; label: string }> = [
  { id: "all", label: "All" },
  { id: "available", label: "Available" },
  { id: "used", label: "Used" },
];

type CodeType = "duration" | "wallet";
type CodeFilter = "all" | "available" | "used";

export function AdminCodesSection({
  isZh,
  loading,
  refreshing,
  submitting,
  bulkDeleting,
  count,
  codeType,
  durationHours,
  walletAmount,
  expiresAt,
  codeFilter,
  filteredCodes,
  selectedCodeIds,
  allVisibleSelected,
  editingCodeId,
  editingValue,
  editingExpiresAt,
  onSetCount,
  onSetCodeType,
  onSetDurationHours,
  onSetWalletAmount,
  onSetExpiresAt,
  onSetCodeFilter,
  onApplyTemplate,
  onRefresh,
  onGenerate,
  onBulkDelete,
  onToggleSelectAllVisible,
  onToggleCodeSelection,
  onStartEdit,
  onCancelEdit,
  onUpdateCode,
  onDeleteCode,
  onEditingValueChange,
  onEditingExpiresAtChange,
}: {
  isZh: boolean;
  loading: boolean;
  refreshing: boolean;
  submitting: boolean;
  bulkDeleting: boolean;
  count: string;
  codeType: CodeType;
  durationHours: string;
  walletAmount: string;
  expiresAt: string;
  codeFilter: CodeFilter;
  filteredCodes: RedeemCodeRow[];
  selectedCodeIds: string[];
  allVisibleSelected: boolean;
  editingCodeId: string | null;
  editingValue: string;
  editingExpiresAt: string;
  onSetCount: (value: string) => void;
  onSetCodeType: (value: CodeType) => void;
  onSetDurationHours: (value: string) => void;
  onSetWalletAmount: (value: string) => void;
  onSetExpiresAt: (value: string) => void;
  onSetCodeFilter: (value: CodeFilter) => void;
  onApplyTemplate: (template: CodeTemplateRow) => void;
  onRefresh: () => void;
  onGenerate: () => void;
  onBulkDelete: () => void;
  onToggleSelectAllVisible: () => void;
  onToggleCodeSelection: (id: string) => void;
  onStartEdit: (row: RedeemCodeRow) => void;
  onCancelEdit: () => void;
  onUpdateCode: () => void;
  onDeleteCode: (row: RedeemCodeRow) => void;
  onEditingValueChange: (value: string) => void;
  onEditingExpiresAtChange: (value: string) => void;
}) {
  return (
    <div className="space-y-6">
      <PanelCard>
        <PanelHeader
          title="Code Templates"
          description="Pre-fill the generator with common campaign packages."
          action={<Badge variant="outline" className="rounded-full px-3">{CODE_TEMPLATES.length}</Badge>}
        />
        <CodeTemplatesTable templates={CODE_TEMPLATES} onApplyTemplate={onApplyTemplate} />
      </PanelCard>

      <PanelCard>
        <PanelHeader
          title="Generate Codes"
          description="Create a CDK batch for either wallet credit or one-time rental."
        />
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <Label>Count</Label>
              <Input
                value={count}
                onChange={(e) => onSetCount(e.target.value)}
                type="number"
                min="1"
                max="100"
                className="mt-1 rounded-2xl border-black/10 bg-white/95 shadow-sm"
              />
            </div>
            <div>
              <Label>Code Type</Label>
              <div className="mt-1 grid gap-2 sm:grid-cols-2">
                {(["wallet", "duration"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => onSetCodeType(type)}
                    className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${
                      codeType === type
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-black/10 bg-white/90 text-foreground hover:bg-white"
                    }`}
                  >
                    <div className="font-medium">{formatRedeemCodeTypeLabel(type, isZh)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {type === "wallet"
                        ? (isZh ? "生成后进入钱包余额。" : "Credits the wallet balance on redemption.")
                        : (isZh ? "生成后直接创建一次租用。" : "Creates one prepaid rental on redemption.")}
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>{codeType === "wallet" ? (isZh ? "金额 (USD)" : "Amount (USD)") : (isZh ? "时长 (小时)" : "Duration (hours)")}</Label>
              <Input
                value={codeType === "wallet" ? walletAmount : durationHours}
                onChange={(e) => {
                  if (codeType === "wallet") {
                    onSetWalletAmount(e.target.value);
                  } else {
                    onSetDurationHours(e.target.value);
                  }
                }}
                type="number"
                min={codeType === "wallet" ? "0.01" : "1"}
                step={codeType === "wallet" ? "0.01" : "1"}
                className="mt-1 rounded-2xl border-black/10 bg-white/95 shadow-sm"
              />
            </div>
            <div>
              <Label>Expires At</Label>
              <Input
                value={expiresAt}
                onChange={(e) => onSetExpiresAt(e.target.value)}
                type="datetime-local"
                className="mt-1 rounded-2xl border-black/10 bg-white/95 shadow-sm"
              />
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={onGenerate} disabled={submitting} className="rounded-full px-5 shadow-sm">
            {submitting ? "Generating..." : "Generate and Copy"}
          </Button>
        </div>
      </PanelCard>

      <PanelCard>
        <PanelHeader
          title="Redeem Codes"
          description="Edit code type, control expiry, filter visible rows, and delete in bulk."
          action={(
            <div className="flex flex-wrap gap-2">
              {CODE_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  onClick={() => onSetCodeFilter(filter.id)}
                  className={`rounded-full border px-4 py-2 text-xs transition ${
                    codeFilter === filter.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-black/10 bg-white/90 text-foreground hover:bg-white"
                  }`}
                >
                  {filter.label}
                </button>
              ))}
              <Button
                variant="outline"
                onClick={onRefresh}
                disabled={loading || refreshing}
                className="rounded-full border-black/10 bg-white/90 shadow-sm"
              >
                {loading || refreshing ? "Refreshing..." : "Refresh"}
              </Button>
              <Button
                variant="destructive"
                onClick={onBulkDelete}
                disabled={bulkDeleting || !selectedCodeIds.length}
                className="rounded-full shadow-sm"
              >
                {bulkDeleting
                  ? "Deleting..."
                  : (selectedCodeIds.length
                    ? `Delete Selected (${selectedCodeIds.length})`
                    : "Delete Selected")}
              </Button>
            </div>
          )}
        />

        {loading ? (
          <EmptyMessage>Loading...</EmptyMessage>
        ) : (
          <RedeemCodesTable
            rows={filteredCodes}
            selectedCodeIds={selectedCodeIds}
            allVisibleSelected={allVisibleSelected}
            editingCodeId={editingCodeId}
            editingValue={editingValue}
            editingExpiresAt={editingExpiresAt}
            onToggleSelectAllVisible={onToggleSelectAllVisible}
            onToggleCodeSelection={onToggleCodeSelection}
            onStartEdit={onStartEdit}
            onCancelEdit={onCancelEdit}
            onUpdateCode={onUpdateCode}
            onDeleteCode={onDeleteCode}
            onEditingValueChange={onEditingValueChange}
            onEditingExpiresAtChange={onEditingExpiresAtChange}
          />
        )}
      </PanelCard>
    </div>
  );
}

function PanelCard({ children }: { children: ReactNode }) {
  return (
    <Card className="space-y-5 rounded-[28px] border border-black/5 bg-white/90 p-6 shadow-[0_10px_40px_rgba(15,23,42,0.06)] backdrop-blur">
      {children}
    </Card>
  );
}

function PanelHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-black/5 pb-4 md:flex-row md:items-center md:justify-between">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

function EmptyMessage({ children }: { children: ReactNode }) {
  return <div className="text-sm text-muted-foreground">{children}</div>;
}
