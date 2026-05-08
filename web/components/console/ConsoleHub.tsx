"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Home, LayoutDashboard, LogOut, RefreshCw, ScrollText, Server, Users, Wallet } from "lucide-react";
import { MagicLinkGate } from "@/components/auth/MagicLinkGate";
import { useAuthStore } from "@/lib/auth/store";
import { useLocaleStore } from "@/lib/i18n/store";
import { workerFetch } from "@/lib/api/client";
import { groupPaymentsByMethod, formatRedeemCodeTypeLabel } from "@/lib/payment-records";
import { isFormalRelease } from "@/lib/release-profile";
import { formatTopupRailDescription, formatTopupRailLabel } from "@/lib/topup-rails";
import { Badge, Button, Card, Input, Label, Tabs, TabsList, TabsTrigger } from "@/components/ui";
import { WorkspaceShell } from "@/components/layout/WorkspaceShell";
import { CenteredStatus } from "@/components/layout/CenteredStatus";
import { WalletEntriesTable } from "@/components/console/WalletEntriesTable";
import { CryptoTopupsTable } from "@/components/console/CryptoTopupsTable";
import { ConsoleNodesTable } from "@/components/console/ConsoleNodesTable";
import { ConsoleAuditTable } from "@/components/console/ConsoleAuditTable";
import type { LucideIcon } from "lucide-react";

export type ConsoleView = "overview" | "nodes" | "wallet" | "audit" | "referrals";

interface OverviewData {
  user: {
    email: string | null;
    isAdmin: boolean;
  };
  wallet: {
    balance: number;
    currency: string;
  };
  summary: {
    totalRentals: number;
    activeRentals: number;
    provisioningRentals: number;
    expiringSoonRentals: number;
    totalPaid: number;
  };
  recentRentals: ConsoleNode[];
  recentPayments: WalletEntry[];
  recentAuditEntries: AuditEntry[];
}

interface ConsoleNode {
  id: string;
  protocol: string;
  status: string;
  ip: string | null;
  vpsId?: string | null;
  durationHours: number;
  totalPrice: number;
  pricePerHour?: number;
  paymentMethod: string | null;
  paymentStatus?: string | null;
  remainingMinutes: number;
  createdAt: string | null;
  startedAt?: string | null;
  expiresAt: string | null;
  probeSummary?: {
    status: string;
    decision: string;
    lastRunAt: string | null;
  };
}

interface NodesData {
  nodes: ConsoleNode[];
}

interface WalletData {
  wallet: {
    balance: number;
    currency: string;
  };
  topups: WalletEntry[];
  cryptoTopups: CryptoTopup[];
  ledgerEntries: WalletEntry[];
  chainMode?: {
    environment: string;
    allowlistedOnly: boolean;
    allowlisted: boolean;
    whitelistSize?: number;
  };
}

interface WalletEntry {
  id: string;
  type?: string;
  rentalId?: string | null;
  amount: number;
  currency: string;
  method?: string;
  status: string;
  createdAt: string | null;
}

interface AuditEntry {
  id: number;
  rentalId: string | null;
  action: string;
  detail: string | null;
  createdAt: string | null;
}

interface AuditData {
  auditEntries: AuditEntry[];
  compliance: {
    status: string;
    message: string;
    profiles?: Array<{
      id: string;
      name: string;
      mode: string;
      version: string;
      blockedProtocols: string[];
      allowedPorts: number[];
      allowedCidrs: string[];
      isDefault: boolean;
    }>;
    rentals?: Array<{
      rentalId: string;
      profileId: string;
      policyVersion: string | null;
      enforcedAt: string | null;
      stats?: {
        rejectPackets: number;
        rejectBytes: number;
        lastSyncedAt: string | null;
      } | null;
    }>;
  };
  structuredEvents?: Array<{
    id: string;
    eventType: string;
    eventHash: string;
    anchorBatchId: string | null;
    createdAt: string | null;
  }>;
}

interface AuditSummary {
  profileCount: number;
  rentalCount: number;
  syncedRentalCount: number;
  rejectPackets: number;
  rejectBytes: number;
  structuredEventCount: number;
  anchoredEventCount: number;
}

interface ReferralsData {
  inviteCode: string | null;
  binding: {
    inviterId: string;
    inviteCodeId: string;
    boundAt: string | null;
  } | null;
  summary: {
    invitedUsers: number;
    rewardedAmount: number;
    pendingAmount: number;
    currency: string;
  };
  rewards: WalletEntry[];
  status: string;
  message: string;
}

interface CryptoTopup {
  id: string;
  asset: string;
  network: string;
  rail: string;
  address: string;
  expectedAmount: number;
  receivedAmount: number | null;
  fiatAmount: number;
  currency: string;
  status: string;
  txHash: string | null;
  confirmations: number;
  ledgerId: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  completedAt: string | null;
}

type WalletTopupRail = "stripe" | "wallet" | "x402";

type ConsoleData = OverviewData | NodesData | WalletData | AuditData | ReferralsData;

type ConsoleViewConfig = {
  label: string;
  path: string;
  title: string;
  icon: LucideIcon;
};

const viewConfig: Record<ConsoleView, ConsoleViewConfig> = {
  overview: { label: "Overview", path: "/api/console/overview", title: "Account Overview", icon: LayoutDashboard },
  nodes: { label: "Nodes", path: "/api/console/nodes", title: "My Nodes", icon: Server },
  wallet: { label: "Wallet", path: "/api/console/wallet", title: "Wallet", icon: Wallet },
  audit: { label: "Audit", path: "/api/console/audit", title: "Audit", icon: ScrollText },
  referrals: { label: "Referrals", path: "/api/console/referrals", title: "Referrals", icon: Users },
};

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function formatMoney(value: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(value || 0);
}

function formatCryptoAmount(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(Number(value || 0));
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1000 && unitIndex < units.length - 1) {
    size /= 1000;
    unitIndex += 1;
  }

  const fractionDigits = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

function shortId(value: string | null | undefined) {
  if (!value) return "-";
  return value.length > 10 ? `${value.slice(0, 8)}...` : value;
}

function formatCountRatio(numerator: number, denominator: number) {
  return denominator > 0 ? `${numerator}/${denominator}` : String(numerator);
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (["active", "completed", "paid"].includes(status)) return "default";
  if (["failed", "destroyed", "expired", "short_paid", "cancelled"].includes(status)) return "destructive";
  if (["provisioning", "pending", "paused"].includes(status)) return "secondary";
  return "outline";
}

const FINAL_CRYPTO_TOPUP_STATUSES = new Set(["completed", "short_paid", "expired", "cancelled", "failed"]);

function isFinalCryptoTopupStatus(status: string) {
  return FINAL_CRYPTO_TOPUP_STATUSES.has(status);
}

function getCryptoTopupStatusLabel(status: string, isZh: boolean) {
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

function getCryptoTopupStatusNote(topup: CryptoTopup, isZh: boolean) {
  switch (topup.status) {
    case "pending":
      return isZh
        ? "请按预期到账金额精确转入，系统默认每 2 分钟扫描一次链上充值。"
        : "Send the exact expected amount. The scheduler scans for topups every 2 minutes.";
    case "completed":
      return isZh
        ? "已经入账。若钱包余额列表尚未更新，可点击刷新按钮同步页面。"
        : "Funds have been credited. Refresh the page if the wallet balance list has not updated yet.";
    case "short_paid":
      return isZh
        ? "到账金额低于预期，系统不会自动入账。请新建一张充值单并按精确金额重新转账。"
        : "The transfer was below the expected amount, so it was not credited automatically. Create a new topup and resend the exact amount.";
    case "expired":
      return isZh
        ? "这张充值单已经过期，需要重新创建。"
        : "This topup has expired. Create a new one before transferring.";
    case "cancelled":
      return isZh
        ? "这张充值单已取消。"
        : "This topup has been cancelled.";
    case "failed":
      return isZh
        ? "充值处理失败，请检查链上交易或联系支持。"
        : "Topup processing failed. Check the on-chain transaction or contact support.";
    default:
      return "";
  }
}

function buildAuditSummary(data: AuditData): AuditSummary {
  const profiles = data.compliance.profiles ?? [];
  const rentals = data.compliance.rentals ?? [];
  const structuredEvents = data.structuredEvents ?? [];

  return {
    profileCount: profiles.length,
    rentalCount: rentals.length,
    syncedRentalCount: rentals.filter((rental) => Boolean(rental.stats?.lastSyncedAt)).length,
    rejectPackets: rentals.reduce((total, rental) => total + (rental.stats?.rejectPackets || 0), 0),
    rejectBytes: rentals.reduce((total, rental) => total + (rental.stats?.rejectBytes || 0), 0),
    structuredEventCount: structuredEvents.length,
    anchoredEventCount: structuredEvents.filter((event) => Boolean(event.anchorBatchId)).length,
  };
}

export function ConsoleHub({ view }: { view: ConsoleView }) {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const email = useAuthStore((s) => s.email);
  const logout = useAuthStore((s) => s.logout);
  const loadRequestRef = useRef(0);
  const [data, setData] = useState<ConsoleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeConfig = viewConfig[view];
  const pagePath = view === "overview" ? "/console" : `/console/${view}`;
  const ActiveIcon = activeConfig.icon;

  const load = async (options: { quiet?: boolean } = {}) => {
    if (!token) return;
    const requestId = ++loadRequestRef.current;
    const suppressErrors = Boolean(options.quiet && data);
    const showLoading = !suppressErrors;

    if (showLoading) {
      setLoading(true);
      setError(null);
    }
    try {
      const res = await workerFetch(activeConfig.path, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = await res.json();
      if (requestId !== loadRequestRef.current) {
        return;
      }
      if (res.status === 401) {
        logout();
        return;
      }
      if (!res.ok || payload.error) {
        throw new Error(payload.error || "Failed to load console data");
      }
      setData(payload);
    } catch (err) {
      if (requestId !== loadRequestRef.current) {
        return;
      }
      if (!suppressErrors) {
        setError(err instanceof Error ? err.message : "Failed to load console data");
      }
    } finally {
      if (requestId !== loadRequestRef.current) {
        return;
      }
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!token) {
      return;
    }
    void load();
  }, [token, view]);
  const navItems = useMemo(() => Object.entries(viewConfig) as Array<[ConsoleView, typeof viewConfig[ConsoleView]]>, []);

  if (!token) {
    return (
      <WorkspaceShell
        header={(
          <div className="flex min-h-14 flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-950 text-white shadow-lg">
                <LayoutDashboard className="h-4 w-4" />
              </div>
              <div>
                <div className="text-lg font-semibold leading-none">AnixOps Console</div>
                <div className="mt-1 text-xs text-muted-foreground">Wallet, nodes, audit, and referrals</div>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => router.push("/")}>
              <Home className="h-4 w-4" />
              Home
            </Button>
          </div>
        )}
      >
        <MagicLinkGate variant="console" returnTo={pagePath} />
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell
      header={(
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-4">
          <button onClick={() => router.push("/console")} className="flex items-center gap-3 text-left">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-950 text-white shadow-lg">
              <LayoutDashboard className="h-4 w-4" />
            </div>
            <div>
              <div className="text-lg font-semibold leading-none">AnixOps Console</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{email || "Account"}</span>
                <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
                <span>{activeConfig.title}</span>
              </div>
            </div>
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1.5 rounded-full px-3 py-1">
              <ActiveIcon className="h-3.5 w-3.5" />
              {activeConfig.label}
            </Badge>
            <Button variant="outline" size="sm" onClick={() => router.push("/")}>
              <Home className="h-4 w-4" />
              Home
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.push("/payments")}>
              <ScrollText className="h-4 w-4" />
              Payments
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                logout();
                router.push("/");
              }}
            >
              <LogOut className="h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>
      )}
    >
      <section className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1.5 rounded-full px-3 py-1">
                <ActiveIcon className="h-3.5 w-3.5" />
                {activeConfig.label}
              </Badge>
              <span className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Workspace</span>
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-[-0.04em]">{activeConfig.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Account data is loaded from the self-hosted API.</p>
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            {loading ? "Refreshing" : "Refresh"}
          </Button>
        </div>

        <Tabs
          value={view}
          onValueChange={(nextView) => {
            router.push(nextView === "overview" ? "/console" : `/console/${nextView}`);
          }}
        >
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-[1.15rem] border border-border bg-card/90 p-1.5 shadow-sm">
            {navItems.map(([key, item]) => (
              <TabsTrigger key={key} value={key} className="gap-2 rounded-xl px-3.5 py-2.5">
                <item.icon className="h-4 w-4" />
                <span>{item.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {loading && (
          <CenteredStatus
            eyebrow="Workspace"
            title="Syncing console data"
            body="Wallet, nodes, audit, and referrals are loading from the self-hosted API."
            tone="neutral"
            pulse
            iconLabel="AX"
          />
        )}
        {error && !loading && (
          <CenteredStatus
            eyebrow="Workspace"
            title="Failed to load console data"
            body={error}
            tone="danger"
            action={(
              <Button variant="outline" onClick={() => void load()}>
                Retry
              </Button>
            )}
            iconLabel="AX"
          />
        )}
        {!loading && !error && data && <ConsoleContent view={view} data={data} onReload={() => void load({ quiet: true })} />}
      </section>
    </WorkspaceShell>
  );
}

function ConsoleContent({
  view,
  data,
  onReload,
}: {
  view: ConsoleView;
  data: ConsoleData;
  onReload?: () => Promise<void> | void;
}) {
  if (view === "overview") return <OverviewView data={data as OverviewData} />;
  if (view === "nodes") return <NodesView data={data as NodesData} />;
  if (view === "wallet") return <WalletView data={data as WalletData} onReload={onReload} />;
  if (view === "audit") return <AuditView data={data as AuditData} />;
  return <ReferralsView data={data as ReferralsData} />;
}

function OverviewView({ data }: { data: OverviewData }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Balance" value={formatMoney(data.wallet.balance, data.wallet.currency)} />
        <Metric label="Active Nodes" value={String(data.summary.activeRentals)} />
        <Metric label="Provisioning" value={String(data.summary.provisioningRentals)} />
        <Metric label="Total Paid" value={formatMoney(data.summary.totalPaid)} />
      </div>
      <ConsoleNodesTable title="Recent Nodes" nodes={data.recentRentals} empty="No rentals yet." />
      <CheckoutGroups entries={data.recentPayments} />
      <ConsoleAuditTable title="Recent Audit" entries={data.recentAuditEntries} empty="No audit entries yet." />
    </div>
  );
}

function NodesView({ data }: { data: NodesData }) {
  return <ConsoleNodesTable title="Nodes" nodes={data.nodes} empty="No nodes yet." />;
}

function WalletView({ data, onReload }: { data: WalletData; onReload?: () => Promise<void> | void }) {
  const formalRelease = isFormalRelease();
  const { locale } = useLocaleStore();
  const isZh = locale === "zh";
  const cdkRedemptions = data.ledgerEntries.filter((entry) => entry.type === "redeem_code_credit").length;

  return (
    <div className="space-y-4">
      {formalRelease ? (
        <WalletCdkRedeemPanel onReload={onReload} />
      ) : (
        <WalletTopupPanel chainMode={data.chainMode} onReload={onReload} />
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label={isZh ? "余额" : "Balance"} value={formatMoney(data.wallet.balance, data.wallet.currency)} />
        <Metric
          label={formalRelease ? (isZh ? "CDK 兑换" : "CDK redemptions") : (isZh ? "充值单" : "Topups")}
          value={String(formalRelease ? cdkRedemptions : data.topups.length)}
        />
        <Metric label={isZh ? "账本条目" : "Ledger Entries"} value={String(data.ledgerEntries.length)} />
      </div>
      {!formalRelease && data.chainMode ? (
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">Chain Mode</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {data.chainMode.environment} · {data.chainMode.allowlistedOnly ? "allowlist enforced" : "open access"}
              </div>
            </div>
            <Badge variant={data.chainMode.allowlisted ? "default" : "destructive"}>
              {data.chainMode.allowlisted ? "allowed" : "blocked"}
            </Badge>
          </div>
        </Card>
      ) : null}
      <EntryList title="Ledger" entries={data.ledgerEntries} empty="No wallet ledger entries yet." />
      {!formalRelease && <CryptoTopupsTable topups={data.cryptoTopups || []} />}
    </div>
  );
}

function WalletTopupPanel({
  chainMode,
  onReload,
}: {
  chainMode?: WalletData["chainMode"];
  onReload?: () => Promise<void> | void;
}) {
  const token = useAuthStore((s) => s.token);
  const { locale } = useLocaleStore();
  const isZh = locale === "zh";
  const [amount, setAmount] = useState("10");
  const [rail, setRail] = useState<WalletTopupRail>("stripe");
  const [submitting, setSubmitting] = useState(false);
  const [refreshingTopup, setRefreshingTopup] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [createdTopup, setCreatedTopup] = useState<CryptoTopup | null>(null);
  const [copiedField, setCopiedField] = useState<"address" | "txHash" | null>(null);

  const canUseChainTopups = !chainMode?.allowlistedOnly || chainMode.allowlisted;
  const chainRailDisabled = !canUseChainTopups;
  const createdTopupId = createdTopup?.id || null;
  const createdTopupExpectedAmount = createdTopup ? formatCryptoAmount(createdTopup.expectedAmount) : "0";
  const notifyWalletReload = () => {
    void onReload?.();
  };

  useEffect(() => {
    if (chainRailDisabled && rail !== "stripe") {
      setRail("stripe");
    }
  }, [chainRailDisabled, rail]);

  useEffect(() => {
    setCopiedField(null);
  }, [createdTopupId]);

  const createdTopupStatus = createdTopup?.status || null;

  useEffect(() => {
    if (!createdTopupId || !createdTopupStatus || isFinalCryptoTopupStatus(createdTopupStatus)) {
      return;
    }

    let cancelled = false;
    const refresh = async () => {
      if (cancelled || !token) {
        return;
      }

      try {
        await refreshCreatedTopup({ quiet: true, isCancelled: () => cancelled });
      } catch {
        // Silent polling keeps the flow calm; the manual refresh button surfaces errors.
      }
    };

    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [createdTopupId, createdTopupStatus, token]);

  const setRailAndClear = (nextRail: WalletTopupRail) => {
    setRail(nextRail);
    setMessage(null);
    setCreatedTopup(null);
    setCopiedField(null);
  };

  const refreshCreatedTopup = async (options: { quiet?: boolean; isCancelled?: () => boolean } = {}) => {
    if (!token || !createdTopupId) {
      return;
    }
    const quiet = Boolean(options.quiet);

    if (!quiet) {
      setRefreshingTopup(true);
      setMessage(null);
    }

    try {
      const res = await workerFetch(`/api/wallet/crypto-topups/${createdTopupId}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok || data.error || !data.topup) {
        throw new Error(data.error || (isZh ? "刷新充值状态失败。" : "Failed to refresh topup status."));
      }
      const nextTopup = data.topup as CryptoTopup;
      if (options.isCancelled?.()) {
        return;
      }
      const previousStatus = createdTopupStatus;
      setCreatedTopup(nextTopup);
      if (options.isCancelled?.()) {
        return;
      }
      if (nextTopup.status !== "pending" && nextTopup.status !== previousStatus) {
        notifyWalletReload();
      }
      if (!quiet) {
        setMessage(
          isZh
            ? "充值状态已刷新。"
            : "Topup status refreshed.",
        );
      }
    } catch (error) {
      if (!quiet) {
        setMessage(error instanceof Error ? error.message : (isZh ? "刷新充值状态失败。" : "Failed to refresh topup status."));
      }
    } finally {
      if (!quiet) {
        setRefreshingTopup(false);
      }
    }
  };

  const copyText = async (text: string, field: "address" | "txHash") => {
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
    } catch {
      setMessage(isZh ? "复制失败，请手动选择文本。" : "Copy failed. Please select the text manually.");
    }
  };

  const handleTopup = async () => {
    if (!token) {
      setMessage(isZh ? "登录后才能发起充值。" : "You need to sign in before creating a topup.");
      return;
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setMessage(isZh ? "请输入有效的充值金额。" : "Enter a valid topup amount.");
      return;
    }

    const minAmount = rail === "stripe" ? 1 : 1;
    const maxAmount = rail === "stripe" ? 500 : 10000;
    if (numericAmount < minAmount || numericAmount > maxAmount) {
      setMessage(
        isZh
          ? `充值金额必须在 $${minAmount} 到 $${maxAmount} 之间。`
          : `Topup amount must be between $${minAmount} and $${maxAmount}.`,
      );
      return;
    }

    setSubmitting(true);
    setMessage(null);
    setCreatedTopup(null);

    try {
      if (rail === "stripe") {
        const res = await workerFetch("/api/wallet/topups/checkout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            amount: numericAmount,
            currency: "usd",
            provider: "stripe",
          }),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error || "Failed to create Stripe topup");
        }
        if (data.checkoutUrl) {
          window.location.href = data.checkoutUrl;
          return;
        }
        throw new Error("Stripe did not return a checkout URL");
      }

      const res = await workerFetch("/api/wallet/crypto-topups", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fiatAmount: numericAmount,
          rail,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to create crypto topup");
      }
      setCreatedTopup(data.topup);
      notifyWalletReload();
      const railLabel = formatTopupRailLabel(data.topup.rail, isZh);
      setMessage(
        isZh
          ? `已创建 ${railLabel} 充值单，请在 ${formatDate(data.topup.expiresAt)} 前按 ${formatCryptoAmount(data.topup.expectedAmount)} ${data.topup.asset} / ${data.topup.network} 精确转入。`
          : `Created a ${railLabel} topup order. Send exactly ${formatCryptoAmount(data.topup.expectedAmount)} ${data.topup.asset} on ${data.topup.network} before ${formatDate(data.topup.expiresAt)}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to create topup");
    } finally {
      setSubmitting(false);
    }
  };

  const topupRailButtons: Array<{ rail: WalletTopupRail; disabled?: boolean }> = [
    { rail: "stripe" },
    { rail: "wallet", disabled: chainRailDisabled },
    { rail: "x402", disabled: chainRailDisabled },
  ];

  return (
    <Card className="space-y-4 border-black/5 bg-white/90 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            {isZh ? "余额充值" : "Wallet topup"}
          </div>
          <div className="mt-1 text-lg font-semibold tracking-[-0.03em]">
            {isZh ? "为站内余额充值" : "Add funds to your wallet"}
          </div>
          <div className="mt-1 text-sm leading-6 text-muted-foreground">
            {isZh
              ? "Stripe、钱包支付和 X402 都会给同一钱包余额入账，但系统会保留各自的 rail。"
              : "Stripe, wallet payment, and X402 all fund the same wallet balance, but each rail stays distinct in records."}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="rounded-full px-3">
            {chainMode?.environment || "local"}
          </Badge>
          <Badge variant={canUseChainTopups ? "default" : "destructive"} className="rounded-full px-3">
            {canUseChainTopups ? "chain access ok" : "allowlist only"}
          </Badge>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[160px_1fr]">
        <div>
          <Label>{isZh ? "金额 (USD)" : "Amount (USD)"}</Label>
          <Input
            type="number"
            min="1"
            max="10000"
            step="1"
            value={amount}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              setAmount(event.target.value);
              setMessage(null);
              setCreatedTopup(null);
            }}
            className="mt-1 h-12 rounded-[1.15rem]"
          />
        </div>

        <div className="space-y-2">
          <Label>{isZh ? "充值方式" : "Topup method"}</Label>
          <div className="grid gap-2 sm:grid-cols-3">
            {topupRailButtons.map((item) => {
              const active = rail === item.rail;
              const disabled = Boolean(item.disabled);
              return (
                <button
                  key={item.rail}
                  type="button"
                  onClick={() => !disabled && setRailAndClear(item.rail)}
                  disabled={disabled}
                  className={`choice-card min-h-[72px] px-4 py-3 text-left text-sm ${
                    active ? "choice-card-active" : ""
                  } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold tracking-[-0.02em]">
                      {formatTopupRailLabel(item.rail, isZh)}
                    </div>
                    <Badge variant={active ? "default" : "outline"} className="rounded-full px-2 py-0.5 text-[10px]">
                      {active ? (isZh ? "已选" : "selected") : (isZh ? "切换" : "switch")}
                    </Badge>
                  </div>
                  <div className="mt-2 text-xs leading-5 text-muted-foreground">
                    {formatTopupRailDescription(item.rail, isZh)}
                  </div>
                </button>
              );
            })}
          </div>
          {!canUseChainTopups && (
            <div className="rounded-[1.2rem] border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-900">
              {isZh
                ? "当前测试服只对白名单邮箱开放链上充值，钱包支付和 X402 通道都会被限制。"
                : "Chain topups are limited to allowlisted emails on this test build. Wallet and X402 rails remain locked."}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs leading-6 text-muted-foreground">
          {rail === "stripe"
            ? (isZh
              ? "Stripe 会跳转到结账页。"
              : "Stripe redirects to checkout.")
            : (isZh
              ? "链上充值请只按预期到账金额转入，系统不会为多转或少转自动修正。"
              : "For on-chain topups, send the exact expected amount. Overpaying or underpaying will not be auto-corrected.")}
        </div>
        <Button onClick={handleTopup} disabled={submitting} className="h-11 px-5">
          {submitting
            ? (isZh ? "处理中..." : "Processing...")
            : rail === "stripe"
              ? (isZh ? "Stripe 结账" : "Start Stripe checkout")
              : (isZh ? "创建充值单" : "Create topup")}
        </Button>
      </div>

      {message && (
        <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-muted-foreground">
          {message}
        </div>
      )}

      {createdTopup && (
        <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                {isZh ? "标准充值单" : "Standard topup order"}
              </div>
              <div className="mt-1 text-lg font-semibold tracking-[-0.02em]">
                {isZh ? "按以下步骤完成转账" : "Complete the transfer in order"}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusVariant(createdTopup.status)} className="rounded-full px-3">
                {getCryptoTopupStatusLabel(createdTopup.status, isZh)}
              </Badge>
              <Badge variant="outline" className="rounded-full px-3">
                {formatTopupRailLabel(createdTopup.rail, isZh)}
              </Badge>
              <Button variant="outline" size="sm" onClick={() => void refreshCreatedTopup()} disabled={refreshingTopup}>
                {refreshingTopup ? (isZh ? "刷新中..." : "Refreshing...") : (isZh ? "刷新状态" : "Refresh status")}
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {[
              {
                step: "1",
                title: isZh ? "核对地址" : "Verify address",
                body: isZh ? "复制地址后，确认网络和资产都与这张单一致。" : "Copy the address, then verify the network and asset match this order.",
              },
              {
                step: "2",
                title: isZh ? "精确转账" : "Send exact amount",
                body: isZh ? `只转 ${createdTopupExpectedAmount} ${createdTopup.asset}，不要多转也不要少转。` : `Send exactly ${createdTopupExpectedAmount} ${createdTopup.asset}. Do not overpay or underpay.`,
              },
              {
                step: "3",
                title: isZh ? "等待确认" : "Wait for confirmations",
                body: isZh ? "链上确认后刷新状态；余额列表若未更新，再点一次页面刷新。" : "Wait for confirmations, then refresh the status. If the balance list still lags, use the page refresh button.",
              },
            ].map((item) => (
              <div key={item.step} className="rounded-[1.2rem] border border-slate-200 bg-white px-4 py-4">
                <div className="flex items-center gap-3">
                  <div className="grid h-8 w-8 place-items-center rounded-full bg-slate-950 text-xs font-semibold text-white">
                    {item.step}
                  </div>
                  <div className="font-medium tracking-[-0.02em]">{item.title}</div>
                </div>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-[1.2rem] border border-slate-200 bg-white px-4 py-4">
              <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                {isZh ? "精确到账金额" : "Exact amount"}
              </div>
              <div className="mt-2 text-2xl font-semibold tracking-[-0.04em]">
                {createdTopupExpectedAmount} {createdTopup.asset}
              </div>
              <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                <div>{isZh ? "网络" : "Network"}: {createdTopup.network}</div>
                <div>{isZh ? "法币金额" : "Fiat amount"}: {formatMoney(createdTopup.fiatAmount, createdTopup.currency)}</div>
                <div>{isZh ? "确认数" : "Confirmations"}: {createdTopup.confirmations || 0}</div>
                <div>{isZh ? "过期时间" : "Expires"}: {formatDate(createdTopup.expiresAt)}</div>
              </div>
            </div>

            <div className="rounded-[1.2rem] border border-slate-200 bg-white px-4 py-4">
              <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                {isZh ? "状态" : "Status"}
              </div>
              <div className="mt-2 text-2xl font-semibold tracking-[-0.04em]">
                {getCryptoTopupStatusLabel(createdTopup.status, isZh)}
              </div>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">
                {getCryptoTopupStatusNote(createdTopup, isZh)}
              </p>
              <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
                <div>{isZh ? "创建时间" : "Created"}: {formatDate(createdTopup.createdAt)}</div>
                {createdTopup.receivedAmount != null && (
                  <div>{isZh ? "链上到账" : "Received"}: {formatCryptoAmount(createdTopup.receivedAmount)} {createdTopup.asset}</div>
                )}
                {createdTopup.completedAt && (
                  <div>{isZh ? "完成时间" : "Completed"}: {formatDate(createdTopup.completedAt)}</div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-[1.2rem] border border-slate-200 bg-white px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                  {isZh ? "收款地址" : "Deposit address"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {isZh ? "请按上面的精确金额转入，并确认网络为" : "Send the exact amount above and confirm the network is"} {createdTopup.network}.
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => void copyText(createdTopup.address, "address")}>
                {copiedField === "address" ? (isZh ? "已复制" : "Copied") : (isZh ? "复制地址" : "Copy address")}
              </Button>
            </div>
            <div className="mt-3 break-all rounded-[1.1rem] bg-slate-50 px-3 py-3 font-mono text-xs text-foreground">
              {createdTopup.address}
            </div>
          </div>

          {createdTopup.txHash && (
            <div className="mt-4 rounded-[1.2rem] border border-slate-200 bg-white px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                    {isZh ? "交易哈希" : "Transaction hash"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {isZh ? "如果你已经完成转账，可以把哈希保存下来用于对账。" : "If the transfer is complete, keep the hash for reconciliation."}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => void copyText(createdTopup.txHash || "", "txHash")}>
                  {copiedField === "txHash" ? (isZh ? "已复制" : "Copied") : (isZh ? "复制哈希" : "Copy hash")}
                </Button>
              </div>
              <div className="mt-3 break-all rounded-[1.1rem] bg-slate-50 px-3 py-3 font-mono text-xs text-foreground">
                {createdTopup.txHash}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function AuditView({ data }: { data: AuditData }) {
  const summary = buildAuditSummary(data);
  const profiles = data.compliance.profiles ?? [];
  const rentals = data.compliance.rentals ?? [];
  const structuredEvents = data.structuredEvents ?? [];

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium">Compliance</div>
            <div className="mt-1 text-sm text-muted-foreground">{data.compliance.message}</div>
          </div>
          <Badge variant="outline">{data.compliance.status}</Badge>
        </div>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Metric
          label="Compliance Profiles"
          value={String(summary.profileCount)}
          detail="Stored policy definitions"
        />
        <Metric
          label="Tracked Rentals"
          value={String(summary.rentalCount)}
          detail="Compliance-enabled user rentals"
        />
        <Metric
          label="Synced Rentals"
          value={formatCountRatio(summary.syncedRentalCount, summary.rentalCount)}
          detail="Rentals with synced stats"
        />
        <Metric
          label="Reject Packets"
          value={String(summary.rejectPackets)}
          detail="Compliance traffic drops"
        />
        <Metric
          label="Reject Bytes"
          value={formatBytes(summary.rejectBytes)}
          detail="Aggregate rejected traffic"
        />
        <Metric
          label="Anchored Events"
          value={formatCountRatio(summary.anchoredEventCount, summary.structuredEventCount)}
          detail="Structured audit coverage"
        />
      </div>
      {profiles.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b p-4">
            <div className="font-medium">Compliance Profiles</div>
            <Badge variant="outline">{summary.profileCount}</Badge>
          </div>
          <div className="divide-y">
            {profiles.map((profile) => (
              <div key={profile.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <div className="font-medium">{profile.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{profile.id} · {profile.version}</div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    blocked protocols: {profile.blockedProtocols.length > 0 ? profile.blockedProtocols.join(", ") : "none"}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{profile.mode}</Badge>
                  {profile.isDefault ? <Badge variant="default">default</Badge> : null}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      {rentals.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b p-4">
            <div className="font-medium">Rental Compliance</div>
            <Badge variant="outline">{summary.rentalCount}</Badge>
          </div>
          <div className="divide-y">
            {rentals.map((rental) => (
              <div key={rental.rentalId} className="grid gap-3 p-4 md:grid-cols-[1fr_auto]">
                <div>
                  <div className="font-medium">{rental.profileId}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {shortId(rental.rentalId)} · {rental.policyVersion || "no-policy-version"} · {formatDate(rental.enforcedAt)}
                  </div>
                </div>
                <div className="text-left md:text-right">
                  <div className="font-medium">{String(rental.stats?.rejectPackets || 0)} rejects</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatBytes(rental.stats?.rejectBytes || 0)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {rental.stats?.lastSyncedAt ? `synced ${formatDate(rental.stats.lastSyncedAt)}` : "not synced"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      <ConsoleAuditTable title="Recent Audit" entries={data.auditEntries} empty="No audit entries yet." />
      {structuredEvents.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b p-4">
            <div className="font-medium">Structured Events</div>
            <Badge variant="outline">{formatCountRatio(summary.anchoredEventCount, summary.structuredEventCount)} anchored</Badge>
          </div>
          <div className="divide-y">
            {structuredEvents.map((event) => (
              <div key={event.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{event.eventType}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(event.createdAt)}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {shortId(event.eventHash)} · {event.anchorBatchId ? `anchored ${shortId(event.anchorBatchId)}` : "unanchored"}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function ReferralsView({ data }: { data: ReferralsData }) {
  const token = useAuthStore((s) => s.token);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [binding, setBinding] = useState(false);

  const bindCode = async () => {
    if (!token || code.trim().length < 6) return;
    setBinding(true);
    setMessage(null);
    try {
      const res = await workerFetch("/api/console/referrals/bind", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code }),
      });
      const payload = await res.json();
      if (!res.ok || payload.error) {
        throw new Error(payload.error || "Failed to bind invite code");
      }
      setMessage(payload.alreadyBound ? "Invite code was already bound." : "Invite code bound.");
      setCode("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to bind invite code");
    } finally {
      setBinding(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Invited Users" value={String(data.summary.invitedUsers)} />
        <Metric label="Rewarded" value={formatMoney(data.summary.rewardedAmount, data.summary.currency)} />
        <Metric label="Pending" value={formatMoney(data.summary.pendingAmount, data.summary.currency)} />
      </div>
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium">Invite Code</div>
            <div className="mt-1 text-sm text-muted-foreground">{data.inviteCode || data.message}</div>
          </div>
          <Badge variant="outline">{data.status}</Badge>
        </div>
      </Card>
      <Card className="p-4">
        <div className="font-medium">Bind Invite Code</div>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            className="min-h-10 flex-1 rounded-md border bg-background px-3 text-sm"
            placeholder={data.binding ? "Invite already bound" : "ANX-XXXXXXXXXX"}
            disabled={Boolean(data.binding)}
          />
          <Button onClick={bindCode} disabled={binding || Boolean(data.binding) || code.trim().length < 6}>
            {binding ? "Binding" : "Bind"}
          </Button>
        </div>
        {data.binding && (
          <div className="mt-2 text-xs text-muted-foreground">Bound at {formatDate(data.binding.boundAt)}</div>
        )}
        {message && <div className="mt-2 text-sm text-muted-foreground">{message}</div>}
      </Card>
      <EntryList title="Referral Rewards" entries={data.rewards} empty="No referral rewards yet." />
    </div>
  );
}

function WalletCdkRedeemPanel({ onReload }: { onReload?: () => Promise<void> | void }) {
  const token = useAuthStore((s) => s.token);
  const { locale } = useLocaleStore();
  const isZh = locale === "zh";
  const [code, setCode] = useState("");
  const [validating, setValidating] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [validatedType, setValidatedType] = useState<"wallet" | "duration" | null>(null);
  const [walletAmount, setWalletAmount] = useState<number | null>(null);
  const [durationHours, setDurationHours] = useState<number | null>(null);

  useEffect(() => {
    setMessage(null);
    setValidatedType(null);
    setWalletAmount(null);
    setDurationHours(null);
  }, [code]);

  const notifyWalletReload = () => {
    void onReload?.();
  };

  const validateCode = async () => {
    if (!token) {
      setMessage(isZh ? "登录后才能兑换 CDK。" : "You need to sign in before redeeming a CDK.");
      return;
    }
    if (!code || code.trim().length < 6) {
      setMessage(isZh ? "请输入有效的 CDK。" : "Enter a valid CDK.");
      return;
    }

    setValidating(true);
    setMessage(null);

    try {
      const res = await workerFetch("/api/redeem/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok || !data.valid) {
        throw new Error(data.error || (isZh ? "CDK 无效或已过期。" : "The CDK is invalid or expired."));
      }

      if (data.codeType === "wallet") {
        setValidatedType("wallet");
        setWalletAmount(typeof data.walletAmount === "number" ? data.walletAmount : null);
        setDurationHours(null);
        setMessage(
          isZh
            ? `已识别为 ${formatRedeemCodeTypeLabel("wallet", true)}，可以直接兑换到钱包。`
            : `Recognized as a ${formatRedeemCodeTypeLabel("wallet", false)} and ready to credit the wallet.`,
        );
      } else {
        setValidatedType("duration");
        setWalletAmount(null);
        setDurationHours(typeof data.durationHours === "number" ? data.durationHours : null);
        setMessage(
          isZh
            ? `这是 ${formatRedeemCodeTypeLabel("duration", true)}，请到租用页使用。`
            : `This is a ${formatRedeemCodeTypeLabel("duration", false)}. Redeem it in the rental flow.`,
        );
      }
    } catch (error) {
      setValidatedType(null);
      setWalletAmount(null);
      setDurationHours(null);
      setMessage(error instanceof Error ? error.message : (isZh ? "CDK 校验失败。" : "Failed to validate the CDK."));
    } finally {
      setValidating(false);
    }
  };

  const redeemCode = async () => {
    if (!token) {
      setMessage(isZh ? "登录后才能兑换 CDK。" : "You need to sign in before redeeming a CDK.");
      return;
    }
    if (validatedType !== "wallet") {
      if (validatedType === "duration") {
        setMessage(
          isZh
            ? `这是 ${formatRedeemCodeTypeLabel("duration", true)}，请在租用页兑换。`
            : `This is a ${formatRedeemCodeTypeLabel("duration", false)}. Redeem it in the rental flow.`,
        );
      } else {
        setMessage(isZh ? "请先验证余额型 CDK。" : "Validate the balance CDK first.");
      }
      return;
    }

    setRedeeming(true);
    setMessage(null);

    try {
      const res = await workerFetch("/api/wallet/redeem", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || (isZh ? "余额兑换失败。" : "Failed to credit the wallet."));
      }

      notifyWalletReload();
      setCode("");
      setValidatedType(null);
      setWalletAmount(null);
      setDurationHours(null);
      setMessage(
        isZh
          ? `钱包余额已增加 ${formatMoney(Number(data.balanceDelta || 0), data.currency || "usd")}。`
          : `Wallet balance increased by ${formatMoney(Number(data.balanceDelta || 0), data.currency || "usd")}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (isZh ? "余额兑换失败。" : "Failed to credit the wallet."));
    } finally {
      setRedeeming(false);
    }
  };

  return (
    <Card className="space-y-4 border-black/5 bg-white/90 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            {isZh ? "CDK 余额直充型" : "CDK wallet credit"}
          </div>
          <div className="mt-1 text-lg font-semibold tracking-[-0.03em]">
            {isZh ? "输入余额型 CDK 直接入账到钱包" : "Redeem a balance CDK directly into the wallet"}
          </div>
          <div className="mt-1 text-sm leading-6 text-muted-foreground">
            {isZh
              ? "单次型 CDK 请在租用页兑换，那里会直接创建一次租用。"
              : "Single-use CDKs belong in the rental flow, where they create a prepaid rental directly."}
          </div>
        </div>
        <Badge variant="default" className="rounded-full px-3">
          {isZh ? "余额入账" : "Wallet credit"}
        </Badge>
      </div>

      <div className="rounded-[1.2rem] border border-slate-200/70 bg-slate-50/85 px-4 py-3 text-sm leading-6 text-muted-foreground">
        {isZh
          ? "先验证 CDK 类型，再兑换到钱包。余额型和单次型会显示不同的提示，避免走错入口。"
          : "Validate the code type first, then credit the wallet. Balance and single-use CDKs surface different hints so you do not enter the wrong flow."}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
        <Input
          type="text"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder={isZh ? "输入余额型 CDK" : "Enter balance CDK"}
          className="h-12 rounded-[1.1rem] uppercase"
        />
        <Button variant="outline" onClick={validateCode} disabled={validating || code.trim().length < 6} className="h-12 px-5">
          {validating ? (isZh ? "验证中..." : "Validating...") : (isZh ? "验证" : "Validate")}
        </Button>
        <Button onClick={redeemCode} disabled={redeeming || validatedType !== "wallet" || code.trim().length < 6} className="h-12 px-5">
          {redeeming ? (isZh ? "兑换中..." : "Redeeming...") : (isZh ? "兑换余额" : "Redeem balance")}
        </Button>
      </div>

      {(validatedType || walletAmount !== null || durationHours !== null) && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={validatedType === "wallet" ? "default" : "secondary"} className="rounded-full px-3">
            {validatedType ? formatRedeemCodeTypeLabel(validatedType, isZh) : (isZh ? "未校验" : "Unvalidated")}
          </Badge>
          {walletAmount !== null && (
            <Badge variant="outline" className="rounded-full px-3">
              {isZh ? `余额 $${walletAmount.toFixed(2)}` : `Wallet amount $${walletAmount.toFixed(2)}`}
            </Badge>
          )}
          {durationHours !== null && (
            <Badge variant="outline" className="rounded-full px-3">
              {isZh ? `${durationHours} 小时` : `${durationHours}h`}
            </Badge>
          )}
        </div>
      )}

      {message && (
        <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-muted-foreground">
          {message}
        </div>
      )}
    </Card>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Card className="p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {detail && <div className="mt-1 text-xs text-muted-foreground">{detail}</div>}
    </Card>
  );
}

function EntryList({ title, entries, empty }: { title: string; entries: WalletEntry[]; empty: string }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b p-4">
        <div className="font-medium">{title}</div>
      </div>
      <div className="p-4">
        <WalletEntriesTable rows={entries} empty={empty} />
      </div>
    </Card>
  );
}

function CheckoutGroups({ entries }: { entries: WalletEntry[] }) {
  const formalRelease = isFormalRelease();
  const { locale } = useLocaleStore();
  const isZh = locale === "zh";
  const groups = useMemo(() => groupPaymentsByMethod(entries), [entries]);
  const sections = [
    {
      key: "wallet" as const,
      title: isZh ? "钱包支付" : "Wallet checkouts",
      description: isZh ? "从钱包余额直接扣费的租用记录。" : "Rentals paid from wallet balance.",
      empty: isZh ? "这里还没有钱包支付记录。" : "No wallet checkout records yet.",
      entries: groups.wallet,
    },
    {
      key: "redeem_code" as const,
      title: formatRedeemCodeTypeLabel("duration", isZh),
      description: formalRelease
        ? (isZh ? "使用 CDK 单次型创建的租用记录。" : "Rentals unlocked by CDK single-use codes.")
        : (isZh ? "通过兑换码创建的租用记录。" : "Rentals unlocked by redeem codes."),
      empty: formalRelease
        ? (isZh ? "这里还没有 CDK 单次型租用记录。" : "No CDK single-use rentals yet.")
        : (isZh ? "这里还没有兑换码租用记录。" : "No redeem-code rentals yet."),
      entries: groups.redeem_code,
    },
    ...(!formalRelease
      ? [
          {
            key: "x402" as const,
            title: isZh ? "X402 通道" : "X402 rails",
            description: isZh ? "历史 X402 直付记录。" : "Historical direct payments routed through X402.",
            empty: isZh ? "这里还没有 X402 记录。" : "No X402 records yet.",
            entries: groups.x402,
          },
          {
            key: "legacy" as const,
            title: isZh ? "历史直付" : "Legacy direct payments",
            description: isZh ? "Stripe 和更早的直接支付记录。" : "Stripe and older direct payments.",
            empty: isZh ? "这里还没有历史直付记录。" : "No legacy direct payments yet.",
            entries: groups.legacy,
          },
        ]
      : []),
  ];

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b p-4">
        <div>
          <div className="font-medium">Recent Checkout Records</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {formalRelease
              ? "Wallet checkouts and CDK single-use rentals are separated by source."
              : "Wallet checkouts, X402 rails, redeem-code rentals, and legacy direct payments are separated by source."}
          </div>
        </div>
        <Badge variant="outline">{entries.length}</Badge>
      </div>
      <div className="space-y-4 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {sections.map((section) => (
            <div key={section.key} className="rounded-2xl border border-black/5 bg-white/95 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{section.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{section.description}</div>
                </div>
                <Badge variant="outline">{section.entries.length}</Badge>
              </div>
            </div>
          ))}
        </div>
        <WalletEntriesTable rows={entries} empty="No checkout records yet." />
      </div>
    </Card>
  );
}
