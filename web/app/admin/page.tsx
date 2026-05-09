"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import versions from "@/../versions.json";
import { WorkspaceShell } from "@/components/layout/WorkspaceShell";
import { useAuthStore } from "@/lib/auth/store";
import { workerFetch } from "@/lib/api/client";
import { useLocaleStore } from "@/lib/i18n/store";
import { generateHysteria2Config, generateVlessRealityConfig } from "@/lib/config/generator";
import { type RedeemCodeRow } from "@/components/admin/RedeemCodesTable";
import { RecentFailedJobsTable } from "@/components/admin/RecentFailedJobsTable";
import { ProvisioningRentalsTable } from "@/components/admin/ProvisioningRentalsTable";
import { RecentRentalsTable } from "@/components/admin/RecentRentalsTable";
import { RecentQueueJobsTable } from "@/components/admin/RecentQueueJobsTable";
import { SearchRentalsTable } from "@/components/admin/SearchRentalsTable";
import { SearchUsersTable } from "@/components/admin/SearchUsersTable";
import { RecentStageLogsTable } from "@/components/admin/RecentStageLogsTable";
import { ChainModeReadinessTable } from "@/components/admin/ChainModeReadinessTable";
import { ComplianceStatsTable } from "@/components/admin/ComplianceStatsTable";
import { ComplianceTrackingTables } from "@/components/admin/ComplianceTrackingTables";
import { SystemHealthChecksTable } from "@/components/admin/SystemHealthChecksTable";
import { AdminActivitySection } from "@/components/admin/AdminActivitySection";
import { AdminCodesSection } from "@/components/admin/AdminCodesSection";
import { type AdminTopupDetailResponse } from "@/components/admin/topup-detail-types";
import { ConsoleAuditTable } from "@/components/console/ConsoleAuditTable";
import { CenteredStatus } from "@/components/layout/CenteredStatus";
import { Button, Card, Input, Label, Badge, Textarea, useToast } from "@/components/ui";

interface ProvisionDebugJob {
  id: string;
  name: string;
  state: string;
  data: Record<string, unknown>;
  rentalId: string | null;
  failedReason: string | null;
  attemptsMade: number;
  attempts: number | null;
  timestamp: number | null;
  processedOn: number | null;
  finishedOn: number | null;
  delay: number;
  stacktrace: string[];
}

interface ProvisioningDebugRental {
  rentalId: string;
  email: string | null;
  protocol: string;
  status: string;
  ip: string | null;
  vpsId: string | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  ageMinutes: number;
  expiresInMinutes: number | null;
  isStale: boolean;
  canRelease: boolean;
  lastAudit: {
    id: number;
    rentalId: string | null;
    action: string;
    detail: string | null;
    createdAt: string;
  } | null;
  queueJob: ProvisionDebugJob | null;
}

interface ProvisionStageAuditEntry {
  id: number;
  rentalId: string | null;
  stage: string;
  status: "started" | "ok" | "failed" | "info" | "warn";
  message: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

interface ProviderCheckResponse {
  ok: boolean;
  status: number;
  provider: string | null;
  stageLogs: Array<{
    stage: string;
    status: ProvisionStageAuditEntry["status"];
    message: string;
    timestamp: string;
    meta?: Record<string, unknown>;
  }>;
  error: string | null;
}

interface AdminOverviewResponse {
  summary: {
    totalUsers: number;
    activeRentals: number;
    provisioningRentals: number;
    totalRevenue: number;
    availableRedeemCodes: number;
    usedRedeemCodes: number;
    complianceTrackedRentals: number;
    complianceRejectPackets: number;
  };
  chainMode?: {
    environment: string;
    allowlistedOnly: boolean;
    whitelistSize: number;
    readiness?: {
      environment: "testnet" | "mainnet";
      cryptoTopup: { enabled: boolean; missingKeys: string[] };
      auditAnchor: { enabled: boolean; missingKeys: string[] };
    };
  };
  compliance?: {
    recentStats: Array<{
      rentalId: string;
      complianceProfileId: string | null;
      policyVersion: string | null;
      rejectPackets: number;
      rejectBytes: number;
      lastSyncedAt: string | null;
    }>;
  };
  recentRentals: Array<{
    rentalId: string;
    email: string | null;
    protocol: string;
    status: string;
    ip: string | null;
    durationHours: number;
    totalPrice: number;
    createdAt: string;
    expiresAt: string | null;
  }>;
  recentPayments: Array<{
    paymentId: string;
    rentalId: string | null;
    email: string | null;
    amount: number;
    currency: string;
    method: string;
    status: string;
    createdAt: string;
  }>;
  recentTopups: Array<{
    topupId: string;
    email: string | null;
    provider: string;
    amount: number;
    currency: string;
    status: string;
    createdAt: string;
    completedAt: string | null;
  }>;
  recentCryptoTopups: Array<{
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
  }>;
  recentWalletLedgerEntries: Array<{
    entryId: string;
    email: string | null;
    type: string;
    amount: number;
    currency: string;
    rentalId: string | null;
    topupId: string | null;
    balanceAfter: number;
    createdAt: string;
  }>;
  recentAnchorBatches: Array<{
    batchId: string;
    eventCount: number;
    merkleRoot: string;
    status: string;
    chain: string | null;
    txHash: string | null;
    hasReceipt: boolean;
    receiptSummary: {
      blockNumber: number | null;
      status: number | null;
      gasUsed: string | null;
      from: string | null;
      to: string | null;
    } | null;
    submissionStartedAt: string | null;
    createdAt: string | null;
    anchoredAt: string | null;
  }>;
  recentAuditEntries: Array<{
    id: number;
    rentalId: string | null;
    action: string;
    detail: string | null;
    createdAt: string;
  }>;
  recentFailedJobs: Array<{
    id: string;
    name: string;
    state?: string;
    data: Record<string, unknown>;
    rentalId?: string | null;
    failedReason: string | null;
    attemptsMade?: number;
    attempts?: number | null;
    timestamp?: number | null;
    processedOn?: number | null;
    finishedOn?: number | null;
    delay?: number;
    stacktrace: string[];
  }>;
  systemHealth?: {
    status: "ok" | "degraded";
    checks: Array<{
      name: string;
      ok: boolean;
      error?: string;
    }>;
  };
  debug?: {
    generatedAt: string;
    staleThresholdMinutes: number;
    provisionServerUrl: string;
    queue: {
      name: string;
      isPaused: boolean;
      counts: Record<string, number>;
      recentJobs: ProvisionDebugJob[];
    };
    provisioningRentals: ProvisioningDebugRental[];
    stageLogs: ProvisionStageAuditEntry[];
  };
}

interface SearchResponse {
  users: Array<{
    userId: string;
    email: string | null;
    createdAt: string;
  }>;
  rentals: Array<{
    rentalId: string;
    email: string | null;
    protocol: string;
    status: string;
    ip: string | null;
    vpsId: string | null;
    createdAt: string;
    expiresAt: string | null;
  }>;
}

interface RentalDetailResponse {
  rental: {
    rentalId: string;
    userId: string | null;
    email: string | null;
    protocol: string;
    status: string;
    ip: string | null;
    vpsId: string | null;
    durationHours: number;
    pricePerHour: number;
    totalPrice: number;
    paymentMethod: string | null;
    paymentStatus: string | null;
    startedAt: string | null;
    expiresAt: string | null;
    pausedAt: string | null;
    createdAt: string;
    updatedAt: string;
    remainingMinutes: number;
  };
  config: Record<string, unknown> | null;
  recentAuditEntries: Array<{
    id: number;
    action: string;
    detail: string | null;
    createdAt: string;
  }>;
  stageLogs?: ProvisionStageAuditEntry[];
}

interface ComplianceStatsResponse {
  summary: {
    trackedRentals: number;
    syncedRentals: number;
    profileCount: number;
    rejectPackets: number;
    rejectBytes: number;
    latestSyncedAt: string | null;
  };
  profiles: Array<{
    id: string;
    name: string;
    mode: "standard" | "restricted";
    version: string;
    blockedProtocols: string[];
    allowedPorts: number[];
    allowedCidrs: string[];
    isDefault: boolean;
  }>;
  rentals: Array<{
    rentalId: string;
    userId: string | null;
    ip: string | null;
    status: string;
    complianceProfileId: string | null;
    compliancePolicyVersion: string | null;
    stats: {
      rentalId: string;
      complianceProfileId: string | null;
      policyVersion: string | null;
      rejectPackets: number;
      rejectBytes: number;
      lastSyncedAt: string | null;
      sourceIp: string | null;
      detail: string | null;
    } | null;
  }>;
}

interface ClientConfig {
  clashMeta: string;
  singbox: string;
  v2rayN: string;
  shadowrocket: string;
}

export type AdminSection = "overview" | "system-health" | "provisioning" | "rentals" | "codes" | "activity";

const ADMIN_NAV: Array<{ section: AdminSection; href: string; label: string; description: string }> = [
  { section: "overview", href: "/admin", label: "Overview", description: "Summary and shortcuts" },
  { section: "system-health", href: "/admin/system-health", label: "System Health", description: "API, Redis, DB, provision" },
  { section: "provisioning", href: "/admin/provisioning", label: "Provisioning", description: "Stage logs and test rentals" },
  { section: "rentals", href: "/admin/rentals", label: "Rentals", description: "Search, inspect, destroy" },
  { section: "codes", href: "/admin/codes", label: "Codes", description: "Generate and manage redeem codes" },
  { section: "activity", href: "/admin/activity", label: "Activity", description: "Topups, ledger, payments, and audit trail" },
];

export function AdminConsole({ section = "overview" }: { section?: AdminSection }) {
  const router = useRouter();
  const detailRef = useRef<HTMLDivElement | null>(null);
  const topupDetailRef = useRef<HTMLDivElement | null>(null);
  const { showToast } = useToast();
  const { locale } = useLocaleStore();
  const token = useAuthStore((s) => s.token);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const isZh = locale === "zh";

  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [codes, setCodes] = useState<RedeemCodeRow[]>([]);
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);
  const [selectedRental, setSelectedRental] = useState<RentalDetailResponse | null>(null);
  const [selectedRentalId, setSelectedRentalId] = useState<string | null>(null);
  const [loadingRentalId, setLoadingRentalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [searching, setSearching] = useState(false);
  const [destroying, setDestroying] = useState(false);
  const [releasingRentalId, setReleasingRentalId] = useState<string | null>(null);
  const [selectedTopup, setSelectedTopup] = useState<AdminTopupDetailResponse | null>(null);
  const [selectedTopupId, setSelectedTopupId] = useState<string | null>(null);
  const [loadingTopupId, setLoadingTopupId] = useState<string | null>(null);
  const [creatingProvisionTest, setCreatingProvisionTest] = useState(false);
  const [checkingProvider, setCheckingProvider] = useState(false);
  const [providerCheck, setProviderCheck] = useState<ProviderCheckResponse | null>(null);
  const [complianceStats, setComplianceStats] = useState<ComplianceStatsResponse | null>(null);
  const [verifyingAnchorBatchId, setVerifyingAnchorBatchId] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [syncingComplianceStats, setSyncingComplianceStats] = useState(false);
  const [count, setCount] = useState("10");
  const [codeType, setCodeType] = useState<"duration" | "wallet">("duration");
  const [durationHours, setDurationHours] = useState("24");
  const [walletAmount, setWalletAmount] = useState("10");
  const [expiresAt, setExpiresAt] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [editingCodeId, setEditingCodeId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [editingExpiresAt, setEditingExpiresAt] = useState("");
  const [codeFilter, setCodeFilter] = useState<"all" | "available" | "used">("all");
  const [selectedCodeIds, setSelectedCodeIds] = useState<string[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const showOverview = section === "overview";
  const showSystemHealth = section === "system-health";
  const showProvisioning = section === "provisioning";
  const showRentals = section === "rentals";
  const showCodes = section === "codes";
  const showActivity = section === "activity";
  const showRentalDetail = showRentals || showProvisioning;
  const copy = {
    redirectTitle: isZh ? "正在校验后台权限。" : "Checking admin access.",
    redirectBody: isZh
      ? "如果当前账号具备管理员权限，你会直接进入控制台。"
      : "If the current account is an administrator, you will move straight into the console.",
    loadingTitle: isZh ? "正在同步运营数据。" : "Syncing operations data.",
    loadingBody: isZh
      ? "概览、兑换码、租用状态与失败任务会在同一处加载完成。"
      : "Overview, redeem codes, rental state, and failed jobs are loading into one control surface.",
    shellLabel: ADMIN_NAV.find((item) => item.section === section)?.label || "Operations Console",
  };

  const selectedConfigText = useMemo(() => {
    if (!selectedRental?.config) {
      return "";
    }
    return JSON.stringify(selectedRental.config, null, 2);
  }, [selectedRental]);

  const selectedRawDetailText = useMemo(() => {
    if (!selectedRental) {
      return "";
    }
    return JSON.stringify(selectedRental, null, 2);
  }, [selectedRental]);

  const selectedClientConfig = useMemo<ClientConfig | null>(() => {
    if (!selectedRental?.config) {
      return null;
    }

    const config = selectedRental.config;
    try {
      if (selectedRental.rental.protocol === "vless-reality") {
        const ip = getConfigString(config, "ip");
        const port = getConfigNumber(config, "port");
        const uuid = getConfigString(config, "uuid");
        const serverName = getConfigString(config, "serverName");
        const publicKey = getConfigString(config, "publicKey");
        const shortId = getConfigString(config, "shortId");
        if (!ip || !port || !uuid || !serverName || !publicKey || !shortId) {
          return null;
        }
        return generateVlessRealityConfig({ ip, port, uuid, serverName, publicKey, shortId });
      }

      if (selectedRental.rental.protocol === "hysteria2") {
        const ip = getConfigString(config, "ip");
        const port = getConfigString(config, "port");
        const password = getConfigString(config, "password");
        const obfs = getConfigString(config, "obfs");
        const insecureValue = config.insecure;
        const insecure = insecureValue === undefined ? true : String(insecureValue) !== "false";
        if (!ip || !port || !password) {
          return null;
        }
        return generateHysteria2Config({ ip, port, password, obfs, insecure });
      }
    } catch {
      return null;
    }

    return null;
  }, [selectedRental]);

  const selectedNodeInfo = useMemo(() => {
    if (!selectedRental) {
      return [];
    }
    const rental = selectedRental.rental;
    const config = selectedRental.config || {};
    const stageLogs = selectedRental.stageLogs || [];
    const ip = rental.ip || getConfigString(config, "ip") || getStageMetaString(stageLogs, "ip") || "-";
    const vpsId = rental.vpsId || getStageMetaString(stageLogs, "vpsId") || "-";
    const port = getConfigString(config, "port") || getStageMetaString(stageLogs, "port") || "-";
    const provider = getStageMetaString(stageLogs, "provider") || "-";
    const region = getStageMetaString(stageLogs, "region") || "-";
    const plan = getStageMetaString(stageLogs, "plan") || "-";
    const endpoint = ip !== "-" && port !== "-" ? `${ip}:${port}` : "-";

    return [
      ["Status", rental.status],
      ["Protocol", rental.protocol],
      ["Endpoint", endpoint],
      ["IP", ip],
      ["Port", port],
      ["VPS ID", vpsId],
      ["Provider", provider],
      ["Region", region],
      ["Plan", plan],
      ["Payment", `${rental.paymentMethod || "-"} / ${rental.paymentStatus || "-"}`],
      ["Started", formatDateTime(rental.startedAt)],
      ["Expires", formatDateTime(rental.expiresAt)],
    ];
  }, [selectedRental]);

  const filteredCodes = useMemo(() => {
    if (codeFilter === "all") {
      return codes;
    }
    return codes.filter((row) =>
      codeFilter === "used" ? Boolean(row.redeem_codes.usedBy) : !row.redeem_codes.usedBy,
    );
  }, [codes, codeFilter]);

  const selectableVisibleCodeIds = useMemo(
    () => filteredCodes.filter((row) => !row.redeem_codes.usedBy).map((row) => row.redeem_codes.id),
    [filteredCodes],
  );

  const allVisibleSelected =
    selectableVisibleCodeIds.length > 0 &&
    selectableVisibleCodeIds.every((id) => selectedCodeIds.includes(id));

  const loadCodes = async () => {
    if (!token) return;
    const res = await workerFetch("/api/admin/redeem-codes", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || "Failed to load redeem codes");
    }
    setCodes(data.codes || []);
  };

  const loadOverview = async () => {
    if (!token) return;
    const res = await workerFetch("/api/admin/overview", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || "Failed to load overview");
    }
    setOverview(data);
  };

  const loadComplianceStats = async (sync = false) => {
    if (!token) return;
    const query = new URLSearchParams({ limit: "50" });
    if (sync) {
      query.set("sync", "1");
    }
    const res = await workerFetch(`/api/admin/compliance/stats?${query.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || "Failed to load compliance stats");
    }
    setComplianceStats(data);
  };

  const loadAll = async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    try {
      await Promise.all([loadOverview(), loadCodes(), loadComplianceStats(false)]);
      setLastUpdatedAt(new Date().toISOString());
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to load admin dashboard", "error");
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const loadRentalDetail = async (rentalId: string, options?: { scroll?: boolean }) => {
    if (!token) return;
    setSelectedRentalId(rentalId);
    setLoadingRentalId(rentalId);
    try {
      const res = await workerFetch(`/api/admin/rentals/${rentalId}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to load rental detail");
      }
      setSelectedRental(data);
      if (options?.scroll !== false) {
        window.requestAnimationFrame(() => {
          detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to load rental detail", "error");
    } finally {
      setLoadingRentalId(null);
    }
  };

  const loadTopupDetail = async (topupId: string, options?: { scroll?: boolean }) => {
    if (!token) return;
    setSelectedTopupId(topupId);
    setLoadingTopupId(topupId);
    try {
      const res = await workerFetch(`/api/admin/topups/${topupId}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to load topup detail");
      }
      setSelectedTopup(data);
      if (options?.scroll !== false) {
        window.requestAnimationFrame(() => {
          topupDetailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    } catch (error) {
      setSelectedTopup(null);
      setSelectedTopupId(null);
      showToast(error instanceof Error ? error.message : "Failed to load topup detail", "error");
    } finally {
      setLoadingTopupId(null);
    }
  };

  const refreshSearchResults = async () => {
    if (!token || searchQuery.trim().length < 2) {
      return;
    }
    try {
      const res = await workerFetch(`/api/admin/search?q=${encodeURIComponent(searchQuery.trim())}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok && !data.error) {
        setSearchResult(data);
      }
    } catch {
      // Best-effort only
    }
  };

  const refreshAdminState = async () => {
    setRefreshing(true);
    try {
      await loadAll(true);
      if (selectedRentalId) {
        await loadRentalDetail(selectedRentalId, { scroll: false });
      }
      if (selectedTopupId) {
        await loadTopupDetail(selectedTopupId, { scroll: false });
      }
      await refreshSearchResults();
    } finally {
      setRefreshing(false);
    }
  };

  const handleSyncComplianceStats = async () => {
    setSyncingComplianceStats(true);
    try {
      await loadComplianceStats(true);
      await loadOverview();
      showToast("Compliance stats synced", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to sync compliance stats", "error");
    } finally {
      setSyncingComplianceStats(false);
    }
  };

  const handleVerifyAnchorBatch = async (batchId: string) => {
    if (!token) return;
    setVerifyingAnchorBatchId(batchId);
    try {
      const res = await workerFetch(`/api/admin/audit/anchors/${batchId}/verify`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to verify anchor batch");
      }
      showToast(
        data.ok
          ? `Anchor batch ${batchId} verified`
          : `Anchor batch ${batchId} mismatch`,
        data.ok ? "success" : "warning",
      );
      await loadAll(true);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to verify anchor batch", "error");
    } finally {
      setVerifyingAnchorBatchId(null);
    }
  };

  const handleClearTopupDetail = () => {
    setSelectedTopup(null);
    setSelectedTopupId(null);
    setLoadingTopupId(null);
  };

  useEffect(() => {
    if (!token) {
      router.push("/");
      return;
    }
    if (!isAdmin) {
      router.push("/");
      return;
    }
    loadAll();
  }, [token, isAdmin]);

  useEffect(() => {
    if (!token || !isAdmin) {
      return;
    }

    const refresh = () => {
      refreshAdminState();
    };

    const interval = setInterval(refresh, 15000);
    const onFocus = () => refresh();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [token, isAdmin, selectedRentalId, selectedTopupId, searchQuery]);

  const handleGenerate = async () => {
    if (!token) return;
    setSubmitting(true);
    try {
      const normalizedCodeType = codeType === "wallet" ? "wallet" : "duration";
      const res = await workerFetch("/api/admin/redeem-codes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          count: Number(count),
          codeType: normalizedCodeType,
          durationHours: normalizedCodeType === "duration" ? Number(durationHours) : undefined,
          walletAmount: normalizedCodeType === "wallet" ? Number(walletAmount) : undefined,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to generate redeem codes");
      }
      const generated = (data.codes || []).map((item: { code: string }) => item.code).join("\n");
      if (generated) {
        await navigator.clipboard?.writeText(generated);
      }
      showToast(`Generated ${data.count} code(s)`, "success");
      await refreshAdminState();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to generate redeem codes", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSearch = async () => {
    if (!token) return;
    if (searchQuery.trim().length < 2) {
      showToast("Search query must be at least 2 characters", "warning");
      return;
    }
    setSearching(true);
    try {
      const res = await workerFetch(`/api/admin/search?q=${encodeURIComponent(searchQuery.trim())}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to search");
      }
      setSearchResult(data);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to search", "error");
    } finally {
      setSearching(false);
    }
  };

  const handleForceDestroy = async () => {
    if (!token || !selectedRentalId) return;
    if (!confirm(`Force destroy rental ${selectedRentalId}?`)) return;
    setDestroying(true);
    try {
      const res = await workerFetch(`/api/admin/rentals/${selectedRentalId}/destroy`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to destroy rental");
      }
      showToast(`Destroy queued for ${selectedRentalId}`, "success");
      await refreshAdminState();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to destroy rental", "error");
    } finally {
      setDestroying(false);
    }
  };

  const handleReleaseProvisioning = async (rentalId: string) => {
    if (!token) return;
    if (!confirm(`Release stuck provisioning rental ${rentalId}? This only expires rows with no IP or VPS ID.`)) return;
    setReleasingRentalId(rentalId);
    try {
      const res = await workerFetch(`/api/admin/rentals/${rentalId}/release-provisioning`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to release provisioning rental");
      }
      showToast(`Released ${rentalId}`, "success");
      await refreshAdminState();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to release provisioning rental", "error");
    } finally {
      setReleasingRentalId(null);
    }
  };

  const handleCreateProvisionTest = async () => {
    if (!token) return;
    if (!confirm("Create a real debug VPS rental now? Destroy it from Rental Detail after the test is active.")) return;
    setCreatingProvisionTest(true);
    try {
      const res = await workerFetch("/api/admin/debug/provision-test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ protocol: "vless-reality", durationHours: 1 }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to create provision test");
      }
      const rentalId = String(data.rentalId);
      setSearchQuery(rentalId);
      showToast(`Provision test queued: ${rentalId}`, "success");
      await refreshAdminState();
      await loadRentalDetail(rentalId);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to create provision test", "error");
    } finally {
      setCreatingProvisionTest(false);
    }
  };

  const handleProviderCheck = async () => {
    if (!token) return;
    setCheckingProvider(true);
    try {
      const res = await workerFetch("/api/admin/debug/provider-check", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setProviderCheck(data);
      if (!res.ok || data.error || data.ok === false) {
        throw new Error(data.error || data.stageLogs?.at?.(-1)?.meta?.detail || "Provider check failed");
      }
      showToast("Cloud provider API access is allowed", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Provider check failed", "error");
    } finally {
      setCheckingProvider(false);
    }
  };

  const startEditCode = (row: RedeemCodeRow) => {
    setEditingCodeId(row.redeem_codes.id);
    setEditingValue(
      row.redeem_codes.codeType === "wallet"
        ? String(row.redeem_codes.walletAmount || "")
        : String(row.redeem_codes.durationHours),
    );
    setEditingExpiresAt(
      row.redeem_codes.expiresAt
        ? new Date(row.redeem_codes.expiresAt).toISOString().slice(0, 16)
        : "",
    );
  };

  const applyCodeUpdate = (updatedCode: RedeemCodeRow["redeem_codes"]) => {
    setCodes((current) =>
      current.map((row) =>
        row.redeem_codes.id === updatedCode.id ? { ...row, redeem_codes: updatedCode } : row,
      ),
    );
  };

  const removeCodesFromState = (ids: string[]) => {
    setCodes((current) => current.filter((row) => !ids.includes(row.redeem_codes.id)));
    setSelectedCodeIds((current) => current.filter((id) => !ids.includes(id)));
  };

  const handleUpdateCode = async () => {
    if (!token || !editingCodeId) return;
    const current = codes.find((row) => row.redeem_codes.id === editingCodeId);
    if (!current) return;

    const payload = current.redeem_codes.codeType === "wallet"
      ? {
          codeType: "wallet",
          walletAmount: Number(editingValue),
          expiresAt: editingExpiresAt ? new Date(editingExpiresAt).toISOString() : null,
        }
      : {
          codeType: "duration",
          durationHours: Number(editingValue),
          expiresAt: editingExpiresAt ? new Date(editingExpiresAt).toISOString() : null,
        };

    try {
      const res = await workerFetch(`/api/admin/redeem-codes/${editingCodeId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to update redeem code");
      }
      if (data.code) {
        applyCodeUpdate(data.code);
      }
      setEditingCodeId(null);
      showToast("Redeem code updated", "success");
      await refreshAdminState();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to update redeem code", "error");
    }
  };

  const handleDeleteCode = async (row: RedeemCodeRow) => {
    if (!token) return;
    if (!confirm(`Delete code ${row.redeem_codes.code}?`)) return;
    try {
      const res = await workerFetch(`/api/admin/redeem-codes/${row.redeem_codes.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to delete redeem code");
      }
      removeCodesFromState([row.redeem_codes.id]);
      showToast("Redeem code deleted", "success");
      await refreshAdminState();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to delete redeem code", "error");
    }
  };

  const toggleCodeSelection = (id: string) => {
    setSelectedCodeIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  const toggleSelectAllVisible = () => {
    setSelectedCodeIds((current) => {
      if (allVisibleSelected) {
        return current.filter((id) => !selectableVisibleCodeIds.includes(id));
      }
      const next = new Set(current);
      selectableVisibleCodeIds.forEach((id) => next.add(id));
      return Array.from(next);
    });
  };

  const handleBulkDelete = async () => {
    if (!token || selectedCodeIds.length === 0) return;
    if (!confirm(`Delete ${selectedCodeIds.length} selected redeem code(s)?`)) return;
    setBulkDeleting(true);
    try {
      for (const id of selectedCodeIds) {
        const res = await workerFetch(`/api/admin/redeem-codes/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error || `Failed to delete redeem code ${id}`);
        }
      }
      removeCodesFromState(selectedCodeIds);
      showToast(`Deleted ${selectedCodeIds.length} redeem code(s)`, "success");
      await refreshAdminState();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to delete selected redeem codes", "error");
    } finally {
      setBulkDeleting(false);
    }
  };

  if (!token || !isAdmin) {
    return (
      <CenteredStatus
        eyebrow="Admin"
        title={copy.redirectTitle}
        body={copy.redirectBody}
        tone="neutral"
      />
    );
  }

  if (loading && !overview && codes.length === 0) {
    return (
      <CenteredStatus
        eyebrow="Admin"
        title={copy.loadingTitle}
        body={copy.loadingBody}
        tone="neutral"
        pulse
      />
    );
  }

  return (
    <WorkspaceShell
      header={(
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.28em] text-muted-foreground">
              AnixOps Admin
            </div>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">
              {copy.shellLabel}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
              Search users, inspect rentals, and manage redeem codes through a calmer, more deliberate control surface.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 md:justify-end">
            <TopPill label="Auto refresh" value="15s" />
            <TopPill label="Build" value={`${versions.frontend} / ${versions.commit || "dev"}`} />
            <TopPill
              label="Synced"
              value={lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString() : "Waiting"}
              muted={!lastUpdatedAt}
            />
            <Button
              variant="outline"
              onClick={() => router.push("/")}
              className="rounded-full border-black/10 bg-white/90 px-5 shadow-sm"
            >
              Back
            </Button>
          </div>
        </div>
      )}
    >
    <div className="space-y-8 md:space-y-10">
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {ADMIN_NAV.map((item) => (
          <Link
            key={item.section}
            href={item.href}
            className={`rounded-[22px] border p-4 text-sm shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
              item.section === section
                ? "border-slate-950 bg-slate-950 text-white"
                : "border-black/5 bg-white/90 text-foreground"
            }`}
          >
            <div className="font-semibold tracking-tight">{item.label}</div>
            <div className={`mt-1 text-xs leading-5 ${item.section === section ? "text-white/65" : "text-muted-foreground"}`}>
              {item.description}
            </div>
          </Link>
        ))}
      </div>

      {showOverview && overview && (
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-8">
          <SummaryCard label="Users" value={String(overview.summary.totalUsers)} />
          <SummaryCard label="Active Rentals" value={String(overview.summary.activeRentals)} />
          <SummaryCard label="Provisioning" value={String(overview.summary.provisioningRentals)} />
          <SummaryCard label="Revenue" value={`$${overview.summary.totalRevenue.toFixed(2)}`} />
          <SummaryCard label="Codes Available" value={String(overview.summary.availableRedeemCodes)} />
          <SummaryCard label="Codes Used" value={String(overview.summary.usedRedeemCodes)} />
          <SummaryCard label="Compliance Rentals" value={String(overview.summary.complianceTrackedRentals || 0)} />
          <SummaryCard label="Reject Hits" value={String(overview.summary.complianceRejectPackets || 0)} />
        </div>
      )}

      {showOverview && overview?.chainMode ? (
        <GlassCard>
          <SectionHeader
            title="Chain Mode"
            description="Controls how chain-backed topup and anchor features are exposed on this environment."
          />
          <div className="grid gap-3 md:grid-cols-3">
            <DebugMetric label="Environment" value={overview.chainMode.environment} />
            <DebugMetric label="Allowlisted Only" value={overview.chainMode.allowlistedOnly ? "yes" : "no"} />
            <DebugMetric label="Whitelist Size" value={String(overview.chainMode.whitelistSize || 0)} />
          </div>
          {overview.chainMode.readiness ? (
            <div className="mt-4">
              <ChainModeReadinessTable readiness={overview.chainMode.readiness} />
            </div>
          ) : null}
        </GlassCard>
      ) : null}

      {showOverview && (
        <GlassCard>
          <SectionHeader
            title="Admin Sections"
            description="The admin console is split into focused pages so each workflow stays readable."
          />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {ADMIN_NAV.filter((item) => item.section !== "overview").map((item) => (
              <Link
                key={item.section}
                href={item.href}
                className="rounded-2xl border border-black/5 bg-white/95 p-4 text-sm shadow-sm transition hover:-translate-y-0.5 hover:border-black/10 hover:shadow-md"
              >
                <div className="font-semibold tracking-tight">{item.label}</div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</div>
              </Link>
            ))}
          </div>
        </GlassCard>
      )}

      {showOverview && overview?.compliance?.recentStats?.length ? (
        <GlassCard>
          <SectionHeader
            title="Compliance Stats"
            description="Latest reject counters collected from tracked rentals."
          />
          <ComplianceStatsTable rows={overview.compliance.recentStats} />
        </GlassCard>
      ) : null}

      {showSystemHealth && overview?.systemHealth && (
        <GlassCard>
          <SectionHeader
            title="System Health"
            description="Runtime dependency checks from the API server. Provision must be healthy before rental delivery is production-ready."
            action={(
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  onClick={handleSyncComplianceStats}
                  disabled={syncingComplianceStats}
                  className="rounded-full border-black/10 bg-white/90 shadow-sm"
                >
                  {syncingComplianceStats ? "Syncing Compliance..." : "Sync Compliance Stats"}
                </Button>
                <Badge
                  variant={overview.systemHealth.status === "ok" ? "default" : "destructive"}
                  className="rounded-full px-3"
                >
                  {overview.systemHealth.status}
                </Badge>
              </div>
            )}
          />

          <SystemHealthChecksTable rows={overview.systemHealth.checks} />
        </GlassCard>
      )}

      {showSystemHealth && complianceStats ? (
        <GlassCard>
          <SectionHeader
            title="Compliance Tracking"
            description="Tracked rentals with the latest reject counters collected from restricted policy chains."
          />
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <DebugMetric label="Tracked Rentals" value={String(complianceStats.summary.trackedRentals)} />
            <DebugMetric
              label="Synced Rentals"
              value={
                complianceStats.summary.trackedRentals > 0
                  ? `${complianceStats.summary.syncedRentals}/${complianceStats.summary.trackedRentals}`
                  : String(complianceStats.summary.syncedRentals)
              }
            />
            <DebugMetric label="Profiles" value={String(complianceStats.summary.profileCount)} />
            <DebugMetric label="Reject Packets" value={String(complianceStats.summary.rejectPackets)} />
            <DebugMetric label="Reject Bytes" value={formatBytes(complianceStats.summary.rejectBytes)} />
            <DebugMetric label="Latest Sync" value={formatDateTime(complianceStats.summary.latestSyncedAt)} />
          </div>
          <ComplianceTrackingTables stats={complianceStats} />
        </GlassCard>
      ) : null}

      {showProvisioning && overview?.debug && (
        <GlassCard className="border-amber-200/70 bg-amber-50/70">
          <SectionHeader
            title="Deployment Debug"
            description="Admin-only provision queue, stuck rental, and delivery diagnostics for rentals that remain in provisioning."
            action={(
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={handleCreateProvisionTest}
                  disabled={creatingProvisionTest}
                  className="rounded-full border-black/10 bg-white/90 shadow-sm"
                >
                  {creatingProvisionTest ? "Queuing Test..." : "Create Test Rental"}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleProviderCheck}
                  disabled={checkingProvider}
                  className="rounded-full border-black/10 bg-white/90 shadow-sm"
                >
                  {checkingProvider ? "Checking Provider..." : "Provider Check"}
                </Button>
                <Badge
                  variant={overview.debug.provisioningRentals.some((rental) => rental.isStale) ? "destructive" : "default"}
                  className="rounded-full px-3"
                >
                  {overview.debug.provisioningRentals.filter((rental) => rental.isStale).length} stale
                </Badge>
                <Badge
                  variant={getQueueCount(overview.debug.queue.counts, "failed") > 0 ? "destructive" : "outline"}
                  className="rounded-full px-3"
                >
                  {getQueueCount(overview.debug.queue.counts, "failed")} failed jobs
                </Badge>
              </div>
            )}
          />

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <DebugMetric label="Provision URL" value={overview.debug.provisionServerUrl} mono className="xl:col-span-2" />
            <DebugMetric label="Queue" value={overview.debug.queue.isPaused ? "paused" : "running"} />
            <DebugMetric label="Waiting" value={String(getQueueCount(overview.debug.queue.counts, "waiting"))} />
            <DebugMetric label="Active" value={String(getQueueCount(overview.debug.queue.counts, "active"))} />
            <DebugMetric label="Delayed" value={String(getQueueCount(overview.debug.queue.counts, "delayed"))} />
            <DebugMetric label="Failed" value={String(getQueueCount(overview.debug.queue.counts, "failed"))} />
          </div>

          <div className="rounded-2xl border border-amber-200/70 bg-white/80 p-4 text-sm leading-6 text-amber-950 shadow-sm">
            判断规则：`provisioning` 超过 {overview.debug.staleThresholdMinutes} 分钟且没有 IP/VPS，通常是交付失败或队列重试中；可以用 Release 释放占用，用户就能重新兑换。已有 IP/VPS 的记录不要直接释放，先打开详情执行 Force Destroy，避免遗留机器。
          </div>

          {providerCheck && (
            <div className={`rounded-2xl border p-4 text-sm leading-6 shadow-sm ${
              providerCheck.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                : "border-red-200 bg-red-50 text-red-950"
            }`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="font-semibold tracking-tight">
                  Provider Check: {providerCheck.provider || "unknown"} / {providerCheck.ok ? "allowed" : "blocked"}
                </div>
                <Badge variant={providerCheck.ok ? "default" : "destructive"} className="rounded-full px-3">
                  HTTP {providerCheck.status}
                </Badge>
              </div>
              {providerCheck.stageLogs.slice(-2).map((entry) => (
                <div key={`${entry.stage}-${entry.timestamp}`} className="mt-2 break-words text-xs">
                  {entry.stage} | {entry.status} | {entry.message}
                  {entry.meta?.detail ? ` | ${String(entry.meta.detail)}` : ""}
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-2 md:grid-cols-5">
            <DebugField label="stage1" value="cloud VPS create" />
            <DebugField label="stage2" value="SSH readiness" />
            <DebugField label="stage3" value="protocol install" />
            <DebugField label="stage4" value="API cache / DB" />
            <DebugField label="stage5" value="destroy cleanup" />
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,0.8fr)]">
            <ProvisioningRentalsTable
              rows={overview.debug.provisioningRentals}
              generatedAt={overview.debug.generatedAt}
              onOpenRental={loadRentalDetail}
              onRelease={handleReleaseProvisioning}
              loadingRentalId={loadingRentalId}
              releasingRentalId={releasingRentalId}
            />

            <div className="space-y-6">
              <RecentQueueJobsTable
                rows={overview.debug.queue.recentJobs.slice(0, 8)}
                onOpenRental={loadRentalDetail}
              />
              <RecentStageLogsTable
                rows={overview.debug.stageLogs.slice(0, 12)}
                onOpenRental={loadRentalDetail}
              />
            </div>
          </div>
        </GlassCard>
      )}

      {(showRentals || showCodes) && (
        <div className="space-y-6">
          {showRentals && (
            <div className="grid gap-6 xl:grid-cols-3">
              <GlassCard className="xl:col-span-2">
                <SectionHeader
                  title="Search Users / Rentals"
                  description="Find users, rental IDs, IPs, protocols, and active states quickly."
                  action={(
                    <Button
                      variant="outline"
                      onClick={handleSearch}
                      disabled={searching}
                      className="rounded-full border-black/10 bg-white/90 px-5 shadow-sm"
                    >
                      {searching ? "Searching..." : "Search"}
                    </Button>
                  )}
                />

                <div className="flex gap-3">
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="email, rental id, IP, protocol, status"
                    className="rounded-2xl border-black/10 bg-white/95 shadow-sm"
                  />
                </div>

                {searchResult && (
                  <div className="grid gap-4 xl:grid-cols-2">
                    <SearchUsersTable rows={searchResult.users} />
                    <SearchRentalsTable rows={searchResult.rentals} onOpenRental={loadRentalDetail} />
                  </div>
                )}
              </GlassCard>
            </div>
          )}

          {showCodes && (
            <AdminCodesSection
              isZh={isZh}
              loading={loading}
              refreshing={refreshing}
              submitting={submitting}
              bulkDeleting={bulkDeleting}
              count={count}
              codeType={codeType}
              durationHours={durationHours}
              walletAmount={walletAmount}
              expiresAt={expiresAt}
              codeFilter={codeFilter}
              filteredCodes={filteredCodes}
              selectedCodeIds={selectedCodeIds}
              allVisibleSelected={allVisibleSelected}
              editingCodeId={editingCodeId}
              editingValue={editingValue}
              editingExpiresAt={editingExpiresAt}
              onSetCount={setCount}
              onSetCodeType={setCodeType}
              onSetDurationHours={setDurationHours}
              onSetWalletAmount={setWalletAmount}
              onSetExpiresAt={setExpiresAt}
              onSetCodeFilter={setCodeFilter}
              onApplyTemplate={(template) => {
                setCount(String(template.count));
                setCodeType(template.codeType);
                if (template.codeType === "wallet") {
                  setWalletAmount(String(template.walletAmount ?? 10));
                } else {
                  setDurationHours(String(template.durationHours ?? 24));
                }
              }}
              onRefresh={() => loadAll()}
              onGenerate={handleGenerate}
              onBulkDelete={handleBulkDelete}
              onToggleSelectAllVisible={toggleSelectAllVisible}
              onToggleCodeSelection={toggleCodeSelection}
              onStartEdit={startEditCode}
              onCancelEdit={() => setEditingCodeId(null)}
              onUpdateCode={handleUpdateCode}
              onDeleteCode={handleDeleteCode}
              onEditingValueChange={setEditingValue}
              onEditingExpiresAtChange={setEditingExpiresAt}
            />
          )}
        </div>
      )}

      {(showRentalDetail || showProvisioning) && (
      <div className="grid gap-6 xl:grid-cols-3">
        {showRentalDetail && (
        <div ref={detailRef} className="scroll-mt-6 xl:col-span-2">
        <GlassCard>
          <SectionHeader
            title="Rental Detail"
            description="Inspect the exact node data, generated client config, raw API payload, and audit trail."
            action={
              selectedRentalId ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="rounded-full px-3">
                    {loadingRentalId === selectedRentalId ? "loading detail" : "detail loaded"}
                  </Badge>
                  <Button
                    variant="destructive"
                    onClick={handleForceDestroy}
                    disabled={destroying}
                    className="rounded-full shadow-sm"
                  >
                    {destroying ? "Destroying..." : "Force Destroy"}
                  </Button>
                </div>
              ) : null
            }
          />

          {!selectedRental ? (
            <EmptyMessage>Select a rental from search results or recent rentals.</EmptyMessage>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <DetailItem label="Rental ID" value={selectedRental.rental.rentalId} mono />
                <DetailItem label="User" value={selectedRental.rental.email || "-"} />
                <DetailItem label="Protocol" value={selectedRental.rental.protocol} />
                <DetailItem label="Status" value={selectedRental.rental.status} />
                <DetailItem label="IP" value={selectedRental.rental.ip || "-"} mono />
                <DetailItem label="VPS ID" value={selectedRental.rental.vpsId || "-"} mono />
                <DetailItem label="Duration" value={`${selectedRental.rental.durationHours}h`} />
                <DetailItem label="Remaining" value={`${selectedRental.rental.remainingMinutes}m`} />
                <DetailItem label="Price" value={`$${selectedRental.rental.totalPrice.toFixed(2)}`} />
                <DetailItem
                  label="Payment"
                  value={`${selectedRental.rental.paymentMethod || "-"} / ${selectedRental.rental.paymentStatus || "-"}`}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium tracking-tight">Node Delivery Summary</div>
                  <Badge variant={selectedRental.rental.ip || selectedRental.config ? "default" : "outline"} className="rounded-full px-3">
                    {selectedRental.rental.ip || selectedRental.config ? "machine data present" : "no machine data"}
                  </Badge>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  {selectedNodeInfo.map(([label, value]) => (
                    <DebugField key={label} label={label} value={String(value)} mono={["Endpoint", "IP", "VPS ID"].includes(label)} />
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium tracking-tight">Generated Client Config</div>
                  <Badge variant={selectedClientConfig ? "default" : "outline"} className="rounded-full px-3">
                    {selectedClientConfig ? "ready" : "not available"}
                  </Badge>
                </div>
                <Textarea
                  value={selectedClientConfig?.v2rayN || selectedClientConfig?.shadowrocket || "No generated client config. Provisioning must finish and config cache must exist."}
                  readOnly
                  className="min-h-[96px] rounded-2xl border-black/10 bg-slate-950 font-mono text-xs text-white shadow-inner"
                />
                {selectedClientConfig?.clashMeta && (
                  <Textarea
                    value={selectedClientConfig.clashMeta}
                    readOnly
                    className="min-h-[180px] rounded-2xl border-black/10 bg-slate-50 font-mono text-xs shadow-inner"
                  />
                )}
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium tracking-tight">Raw Provision Config</div>
                <Textarea
                  value={selectedConfigText || "No cached config"}
                  readOnly
                  className="min-h-[180px] rounded-2xl border-black/10 bg-slate-50 font-mono text-xs shadow-inner"
                />
              </div>

              <div className="space-y-2">
                <RecentStageLogsTable rows={selectedRental.stageLogs || []} />
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium tracking-tight">Raw Inspect API Response</div>
                <Textarea
                  value={selectedRawDetailText}
                  readOnly
                  className="min-h-[260px] rounded-2xl border-black/10 bg-slate-50 font-mono text-xs shadow-inner"
                />
              </div>

              <div className="space-y-2">
                <ConsoleAuditTable
                  title="Recent Rental Audit"
                  entries={selectedRental.recentAuditEntries.map((entry) => ({
                    ...entry,
                    rentalId: selectedRental.rental.rentalId,
                  }))}
                  empty="No audit entries for this rental yet."
                />
              </div>
            </div>
          )}
        </GlassCard>
        </div>
        )}

        {showProvisioning && overview?.debug && (
          <RecentFailedJobsTable rows={overview?.recentFailedJobs ?? []} onOpenRental={loadRentalDetail} />
        )}
      </div>
      )}

      {overview && (showRentals || showActivity) && (
        <div className="grid gap-6 xl:grid-cols-3">
          {showRentals && <RecentRentalsTable rows={overview.recentRentals} onOpenRental={loadRentalDetail} />}

          {showActivity && (
            <AdminActivitySection
              isZh={isZh}
              recentTopups={overview.recentTopups}
              recentCryptoTopups={overview.recentCryptoTopups}
              recentWalletLedgerEntries={overview.recentWalletLedgerEntries}
              recentPayments={overview.recentPayments}
              recentAnchorBatches={overview.recentAnchorBatches}
              recentAuditEntries={overview.recentAuditEntries}
              selectedTopup={selectedTopup}
              selectedTopupId={selectedTopupId}
              loadingTopupId={loadingTopupId}
              onOpenRental={loadRentalDetail}
              onOpenTopup={loadTopupDetail}
              onClearTopup={handleClearTopupDetail}
              onVerifyAnchorBatch={handleVerifyAnchorBatch}
              verifyingAnchorBatchId={verifyingAnchorBatchId}
              topupDetailRef={topupDetailRef}
            />
          )}
        </div>
      )}

    </div>
    </WorkspaceShell>
  );
}

export default function AdminPage() {
  return <AdminConsole section="overview" />;
}

function getQueueCount(counts: Record<string, number>, key: string) {
  return Number(counts[key] ?? 0);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
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

function getConfigString(config: Record<string, unknown>, key: string) {
  const value = config[key];
  if (value === null || value === undefined || value === "") {
    return "";
  }
  return String(value);
}

function getConfigNumber(config: Record<string, unknown>, key: string) {
  const value = Number(config[key]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function getStageMetaString(logs: ProvisionStageAuditEntry[], key: string) {
  for (const entry of logs) {
    const value = entry.meta?.[key];
    if (value !== null && value !== undefined && value !== "") {
      return String(value);
    }
  }
  return "";
}

function GlassCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card
      className={`space-y-5 rounded-[28px] border border-black/5 bg-white/90 p-6 shadow-[0_10px_40px_rgba(15,23,42,0.06)] backdrop-blur ${className}`}
    >
      {children}
    </Card>
  );
}

function DebugMetric({
  label,
  value,
  mono = false,
  className = "",
}: {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm ${className}`}>
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className={`mt-2 text-sm font-semibold tracking-tight ${mono ? "break-all font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function DebugField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-black/5 bg-white/80 p-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xs ${mono ? "break-all font-mono" : "font-medium text-foreground"}`}>{value}</div>
    </div>
  );
}

function SectionHeader({
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

function TopPill({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="rounded-full border border-black/5 bg-white/80 px-4 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur">
      <span className={`font-medium ${muted ? "text-muted-foreground" : "text-foreground"}`}>{label}</span>
      <span className="ml-2">{value}</span>
    </div>
  );
}

function EmptyMessage({ children }: { children: ReactNode }) {
  return <div className="text-sm text-muted-foreground">{children}</div>;
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="rounded-[26px] border border-black/5 bg-white/90 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] backdrop-blur">
      <div className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">{label}</div>
      <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
    </Card>
  );
}

function DetailItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white/95 p-4 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className={`mt-2 text-sm ${mono ? "font-mono break-all" : "font-medium tracking-tight"}`}>{value}</div>
    </div>
  );
}
