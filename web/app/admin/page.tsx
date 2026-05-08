"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import versions from "@/../versions.json";
import { useAuthStore } from "@/lib/auth/store";
import { workerFetch } from "@/lib/api/client";
import { useLocaleStore } from "@/lib/i18n/store";
import { generateHysteria2Config, generateVlessRealityConfig } from "@/lib/config/generator";
import { Button, Card, Input, Label, Badge, Textarea, useToast } from "@/components/ui";

interface RedeemCodeRow {
  redeem_codes: {
    id: string;
    code: string;
    durationHours: number;
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

const CODE_TEMPLATES = [
  { label: "1h Trial", durationHours: 1, count: 10, note: "Fast-access trial batch" },
  { label: "6h Burst", durationHours: 6, count: 10, note: "Short promo or testing wave" },
  { label: "24h Standard", durationHours: 24, count: 20, note: "Default single-day package" },
  { label: "72h Promo", durationHours: 72, count: 5, note: "Longer invite-only batch" },
];

const CODE_FILTERS: Array<{ id: "all" | "available" | "used"; label: string }> = [
  { id: "all", label: "All" },
  { id: "available", label: "Available" },
  { id: "used", label: "Used" },
];

export type AdminSection = "overview" | "system-health" | "provisioning" | "rentals" | "codes" | "activity";

const ADMIN_NAV: Array<{ section: AdminSection; href: string; label: string; description: string }> = [
  { section: "overview", href: "/admin", label: "Overview", description: "Summary and shortcuts" },
  { section: "system-health", href: "/admin/system-health", label: "System Health", description: "API, Redis, DB, provision" },
  { section: "provisioning", href: "/admin/provisioning", label: "Provisioning", description: "Stage logs and test rentals" },
  { section: "rentals", href: "/admin/rentals", label: "Rentals", description: "Search, inspect, destroy" },
  { section: "codes", href: "/admin/codes", label: "Codes", description: "Generate and manage redeem codes" },
  { section: "activity", href: "/admin/activity", label: "Activity", description: "Payments and audit trail" },
];

export function AdminConsole({ section = "overview" }: { section?: AdminSection }) {
  const router = useRouter();
  const detailRef = useRef<HTMLDivElement | null>(null);
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
  const [creatingProvisionTest, setCreatingProvisionTest] = useState(false);
  const [checkingProvider, setCheckingProvider] = useState(false);
  const [providerCheck, setProviderCheck] = useState<ProviderCheckResponse | null>(null);
  const [complianceStats, setComplianceStats] = useState<ComplianceStatsResponse | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [syncingComplianceStats, setSyncingComplianceStats] = useState(false);
  const [count, setCount] = useState("10");
  const [durationHours, setDurationHours] = useState("24");
  const [expiresAt, setExpiresAt] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [editingCodeId, setEditingCodeId] = useState<string | null>(null);
  const [editingDuration, setEditingDuration] = useState("");
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
        const port = getConfigNumber(config, "port");
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

  const loadRentalDetail = async (rentalId: string) => {
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
      window.requestAnimationFrame(() => {
        detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to load rental detail", "error");
    } finally {
      setLoadingRentalId(null);
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
        await loadRentalDetail(selectedRentalId);
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
  }, [token, isAdmin, selectedRentalId, searchQuery]);

  const handleGenerate = async () => {
    if (!token) return;
    setSubmitting(true);
    try {
      const res = await workerFetch("/api/admin/redeem-codes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          count: Number(count),
          durationHours: Number(durationHours),
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
    setEditingDuration(String(row.redeem_codes.durationHours));
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
    try {
      const res = await workerFetch(`/api/admin/redeem-codes/${editingCodeId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          durationHours: Number(editingDuration),
          expiresAt: editingExpiresAt ? new Date(editingExpiresAt).toISOString() : null,
        }),
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
      <AdminStatusScreen
        eyebrow="Admin"
        title={copy.redirectTitle}
        body={copy.redirectBody}
      />
    );
  }

  if (loading && !overview && codes.length === 0) {
    return (
      <AdminStatusScreen
        eyebrow="Admin"
        title={copy.loadingTitle}
        body={copy.loadingBody}
      />
    );
  }

  return (
    <div className="mx-auto max-w-[1480px] space-y-8 px-1 py-10 md:space-y-10 md:py-14">
      <div className="flex flex-col gap-5 border-b border-black/5 pb-7 md:flex-row md:items-end md:justify-between">
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
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <MiniPanel>
                <div className="font-medium">Crypto Topup Readiness</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {overview.chainMode.readiness.cryptoTopup.enabled ? "ready" : "disabled"} · missing {overview.chainMode.readiness.cryptoTopup.missingKeys.length}
                </div>
              </MiniPanel>
              <MiniPanel>
                <div className="font-medium">Audit Anchor Readiness</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {overview.chainMode.readiness.auditAnchor.enabled ? "ready" : "disabled"} · missing {overview.chainMode.readiness.auditAnchor.missingKeys.length}
                </div>
              </MiniPanel>
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
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {overview.compliance.recentStats.map((entry) => (
              <MiniPanel key={entry.rentalId}>
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium tracking-tight">{entry.complianceProfileId || "standard"}</div>
                  <Badge variant="outline" className="rounded-full">{entry.rejectPackets} rejects</Badge>
                </div>
                <div className="mt-2 text-xs leading-5 text-muted-foreground">
                  {entry.policyVersion || "no-policy-version"}
                </div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">
                  {entry.rentalId} · {formatDateTime(entry.lastSyncedAt)}
                </div>
              </MiniPanel>
            ))}
          </div>
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

          <div className="grid gap-3 md:grid-cols-3">
            {overview.systemHealth.checks.map((check) => (
              <MiniPanel key={check.name}>
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium capitalize tracking-tight">{check.name}</div>
                  <Badge variant={check.ok ? "default" : "destructive"} className="rounded-full">
                    {check.ok ? "ok" : "failed"}
                  </Badge>
                </div>
                {check.error && (
                  <div className="mt-2 break-words text-xs leading-5 text-red-600">{check.error}</div>
                )}
              </MiniPanel>
            ))}
          </div>
        </GlassCard>
      )}

      {showSystemHealth && complianceStats?.rentals?.length ? (
        <GlassCard>
          <SectionHeader
            title="Compliance Tracking"
            description="Tracked rentals with the latest reject counters collected from restricted policy chains."
          />
          <div className="grid gap-3">
            {complianceStats.rentals.map((entry) => (
              <MiniPanel key={entry.rentalId}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium tracking-tight">{entry.complianceProfileId || "standard"}</div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">
                      {entry.rentalId} · {entry.ip || "pending-ip"} · {entry.compliancePolicyVersion || "no-policy-version"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium">{String(entry.stats?.rejectPackets || 0)} rejects</div>
                    <div className="mt-1 text-xs text-muted-foreground">{formatDateTime(entry.stats?.lastSyncedAt || null)}</div>
                  </div>
                </div>
                <div className="mt-2 text-xs leading-5 text-muted-foreground">
                  bytes={String(entry.stats?.rejectBytes || 0)} · status={entry.status} · detail={entry.stats?.detail || "not-synced"}
                </div>
              </MiniPanel>
            ))}
          </div>
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
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
                  Provisioning Rentals
                </div>
                <div className="text-xs text-muted-foreground">
                  Generated {formatDateTime(overview.debug.generatedAt)}
                </div>
              </div>

              {overview.debug.provisioningRentals.length === 0 ? (
                <EmptyMessage>No rentals are currently provisioning.</EmptyMessage>
              ) : (
                overview.debug.provisioningRentals.map((rental) => (
                  <MiniPanel key={rental.rentalId}>
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => loadRentalDetail(rental.rentalId)}
                            className="font-mono text-xs font-semibold text-foreground underline-offset-4 hover:underline"
                          >
                            {rental.rentalId}
                          </button>
                          <Badge variant={rental.isStale ? "destructive" : "secondary"} className="rounded-full">
                            {rental.isStale ? "stale" : "deploying"}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {rental.email || "Unknown user"} | {rental.protocol} | age {formatMinutes(rental.ageMinutes)}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => loadRentalDetail(rental.rentalId)}
                          disabled={loadingRentalId === rental.rentalId}
                          className="rounded-full border-black/10 bg-white/90"
                        >
                          {loadingRentalId === rental.rentalId ? "Loading..." : "Inspect"}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleReleaseProvisioning(rental.rentalId)}
                          disabled={!rental.canRelease || releasingRentalId === rental.rentalId}
                          className="rounded-full"
                        >
                          {releasingRentalId === rental.rentalId ? "Releasing..." : "Release"}
                        </Button>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-2 md:grid-cols-4">
                      <DebugField label="IP" value={rental.ip || "-"} mono />
                      <DebugField label="VPS" value={rental.vpsId || "-"} mono />
                      <DebugField label="Payment" value={`${rental.paymentMethod || "-"} / ${rental.paymentStatus || "-"}`} />
                      <DebugField label="Expires In" value={rental.expiresInMinutes === null ? "-" : formatMinutes(rental.expiresInMinutes)} />
                    </div>

                    <div className="mt-3 grid gap-3 lg:grid-cols-2">
                      <div className="rounded-2xl border border-black/5 bg-slate-50/80 p-3">
                        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                          Queue Match
                        </div>
                        {rental.queueJob ? (
                          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge
                                variant={rental.queueJob.state === "failed" ? "destructive" : "outline"}
                                className="rounded-full"
                              >
                                {rental.queueJob.state}
                              </Badge>
                              <span>{rental.queueJob.name} #{rental.queueJob.id || "-"}</span>
                            </div>
                            <div>
                              attempts {rental.queueJob.attemptsMade}/{rental.queueJob.attempts ?? "?"} | last {formatJobTime(rental.queueJob)}
                            </div>
                            {rental.queueJob.failedReason && (
                              <div className="break-words text-red-600">{rental.queueJob.failedReason}</div>
                            )}
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-muted-foreground">
                            No recent waiting, active, delayed, or failed job matched this rental.
                          </div>
                        )}
                      </div>

                      <div className="rounded-2xl border border-black/5 bg-slate-50/80 p-3">
                        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                          Last Audit
                        </div>
                        {rental.lastAudit ? (
                          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                            <div className="font-medium text-foreground">{rental.lastAudit.action}</div>
                            {rental.lastAudit.detail && <div className="break-words">{rental.lastAudit.detail}</div>}
                            <div>{formatDateTime(rental.lastAudit.createdAt)}</div>
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-muted-foreground">No audit entry found.</div>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 text-xs text-muted-foreground">
                      {rental.canRelease
                        ? "Release is enabled because this row has no IP and no VPS ID."
                        : "Release is disabled because machine data exists; use Force Destroy from the rental detail."}
                    </div>
                  </MiniPanel>
                ))
              )}
            </div>

            <div className="space-y-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
                Recent Queue Activity
              </div>
              {overview.debug.queue.recentJobs.length === 0 ? (
                <EmptyMessage>No recent provision jobs.</EmptyMessage>
              ) : (
                overview.debug.queue.recentJobs.slice(0, 8).map((job) => (
                  <MiniPanel key={`${job.id}-${job.state}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium tracking-tight">{job.name}</div>
                      <Badge variant={job.state === "failed" ? "destructive" : "outline"} className="rounded-full">
                        {job.state}
                      </Badge>
                    </div>
                    <div className="mt-1 font-mono text-xs text-muted-foreground">
                      {job.rentalId || JSON.stringify(job.data)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      attempts {job.attemptsMade}/{job.attempts ?? "?"} | {formatJobTime(job)}
                    </div>
                    {job.failedReason && (
                      <div className="mt-2 break-words text-xs text-red-600">{job.failedReason}</div>
                    )}
                  </MiniPanel>
                ))
              )}
            </div>

            <div className="space-y-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
                Recent Stage Logs
              </div>
              {overview.debug.stageLogs.length === 0 ? (
                <EmptyMessage>No provision stage logs yet.</EmptyMessage>
              ) : (
                overview.debug.stageLogs.slice(0, 12).map((entry) => (
                  <StageLogPanel key={entry.id} entry={entry} onOpen={entry.rentalId ? () => loadRentalDetail(entry.rentalId!) : undefined} />
                ))
              )}
            </div>
          </div>
        </GlassCard>
      )}

      {(showRentals || showCodes) && (
      <div className="grid gap-6 xl:grid-cols-3">
        {showRentals && (
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
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
                  Users
                </div>
                {searchResult.users.length === 0 ? (
                  <EmptyMessage>No users matched</EmptyMessage>
                ) : (
                  searchResult.users.map((user) => (
                    <MiniPanel key={user.userId}>
                      <div className="font-medium tracking-tight">{user.email || "Unknown"}</div>
                      <div className="mt-1 font-mono text-xs text-muted-foreground">{user.userId}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {new Date(user.createdAt).toLocaleString()}
                      </div>
                    </MiniPanel>
                  ))
                )}
              </div>

              <div className="space-y-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
                  Rentals
                </div>
                {searchResult.rentals.length === 0 ? (
                  <EmptyMessage>No rentals matched</EmptyMessage>
                ) : (
                  searchResult.rentals.map((rental) => (
                    <button
                      key={rental.rentalId}
                      onClick={() => loadRentalDetail(rental.rentalId)}
                      className="w-full rounded-2xl border border-black/5 bg-white/95 p-4 text-left text-sm shadow-sm transition hover:-translate-y-0.5 hover:border-black/10 hover:shadow-md"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium tracking-tight">
                          {rental.email || "Unknown user"}
                        </div>
                        <Badge
                          variant={rental.status === "active" ? "default" : "secondary"}
                          className="rounded-full"
                        >
                          {rental.status}
                        </Badge>
                      </div>
                      <div className="mt-1 font-mono text-xs text-muted-foreground">
                        {rental.rentalId}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {rental.protocol} | {rental.ip || "-"}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </GlassCard>
        )}

        {showCodes && (
        <GlassCard>
          <SectionHeader
            title="Code Templates"
            description="Pre-fill the generator with common campaign packages."
            action={<Badge variant="outline" className="rounded-full px-3">{CODE_TEMPLATES.length}</Badge>}
          />

          <div className="space-y-3">
            {CODE_TEMPLATES.map((template) => (
              <button
                key={template.label}
                onClick={() => {
                  setCount(String(template.count));
                  setDurationHours(String(template.durationHours));
                }}
                className="w-full rounded-2xl border border-black/5 bg-white/95 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-black/10 hover:shadow-md"
              >
                <div className="font-medium tracking-tight">{template.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {template.durationHours}h | default {template.count} codes
                </div>
                <div className="mt-2 text-xs text-muted-foreground">{template.note}</div>
              </button>
            ))}
          </div>
        </GlassCard>
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
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium tracking-tight">Provision Stage Log</div>
                  <Badge variant="outline" className="rounded-full px-3">
                    {selectedRental.stageLogs?.length || 0}
                  </Badge>
                </div>
                <div className="space-y-2">
                  {selectedRental.stageLogs?.length ? (
                    selectedRental.stageLogs.map((entry) => (
                      <StageLogPanel key={entry.id} entry={entry} />
                    ))
                  ) : (
                    <EmptyMessage>No stage logs for this rental yet.</EmptyMessage>
                  )}
                </div>
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
                <div className="text-sm font-medium tracking-tight">Recent Rental Audit</div>
                <div className="space-y-2">
                  {selectedRental.recentAuditEntries.length === 0 ? (
                    <EmptyMessage>No audit entries</EmptyMessage>
                  ) : (
                    selectedRental.recentAuditEntries.map((entry) => (
                      <MiniPanel key={entry.id}>
                        <div className="font-medium tracking-tight">{entry.action}</div>
                        {entry.detail && (
                          <div className="mt-1 text-xs text-muted-foreground">{entry.detail}</div>
                        )}
                        <div className="mt-1 text-xs text-muted-foreground">
                          {new Date(entry.createdAt).toLocaleString()}
                        </div>
                      </MiniPanel>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </GlassCard>
        </div>
        )}

        {showProvisioning && (
        <GlassCard>
          <SectionHeader
            title="Recent Failed Jobs"
            description="Provision queue failures and recent stack traces."
            action={<Badge variant="outline" className="rounded-full px-3">{overview?.recentFailedJobs.length || 0}</Badge>}
          />

          <div className="space-y-3">
            {overview?.recentFailedJobs?.length ? (
              overview.recentFailedJobs.map((job) => (
                <MiniPanel key={String(job.id)}>
                  <div className="font-medium tracking-tight">{job.name}</div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">
                    {JSON.stringify(job.data)}
                  </div>
                  <div className="mt-2 text-xs text-red-600">{job.failedReason}</div>
                  {job.stacktrace?.[0] && (
                    <div className="mt-2 text-[11px] text-muted-foreground">{job.stacktrace[0]}</div>
                  )}
                </MiniPanel>
              ))
            ) : (
              <EmptyMessage>No failed jobs.</EmptyMessage>
            )}
          </div>
        </GlassCard>
        )}
      </div>
      )}

      {overview && (showRentals || showActivity) && (
        <div className="grid gap-6 xl:grid-cols-3">
          {showRentals && (
          <GlassCard>
            <SectionHeader
              title="Recent Rentals"
              description="Newest rental records across the system."
              action={<Badge variant="outline" className="rounded-full px-3">{overview.recentRentals.length}</Badge>}
            />
            <div className="space-y-3">
              {overview.recentRentals.map((rental) => (
                <button
                  key={rental.rentalId}
                  onClick={() => loadRentalDetail(rental.rentalId)}
                  className="w-full rounded-2xl border border-black/5 bg-white/95 p-4 text-left text-sm shadow-sm transition hover:-translate-y-0.5 hover:border-black/10 hover:shadow-md"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium tracking-tight">{rental.email || "Unknown user"}</div>
                    <Badge variant={rental.status === "active" ? "default" : "secondary"} className="rounded-full">
                      {rental.status}
                    </Badge>
                  </div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">{rental.rentalId}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {rental.protocol} | ${rental.totalPrice.toFixed(2)}
                  </div>
                </button>
              ))}
            </div>
          </GlassCard>
          )}

          {showActivity && (
          <GlassCard>
            <SectionHeader
              title="Recent Payments"
              description="Latest payment records and settlement state."
              action={<Badge variant="outline" className="rounded-full px-3">{overview.recentPayments.length}</Badge>}
            />
            <div className="space-y-3">
              {overview.recentPayments.length === 0 ? (
                <EmptyMessage>No payments yet.</EmptyMessage>
              ) : (
                overview.recentPayments.map((payment) => (
                  <MiniPanel key={payment.paymentId}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium tracking-tight">{payment.email || "Unknown user"}</div>
                      <Badge variant={payment.status === "completed" ? "default" : "secondary"} className="rounded-full">
                        {payment.status}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      ${payment.amount.toFixed(2)} {payment.currency.toUpperCase()} | {payment.method}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {new Date(payment.createdAt).toLocaleString()}
                    </div>
                  </MiniPanel>
                ))
              )}
            </div>
          </GlassCard>
          )}

          {showActivity && (
          <GlassCard>
            <SectionHeader
              title="Recent Audit"
              description="Latest state-changing events from the platform."
              action={<Badge variant="outline" className="rounded-full px-3">{overview.recentAuditEntries.length}</Badge>}
            />
            <div className="space-y-3">
              {overview.recentAuditEntries.length === 0 ? (
                <EmptyMessage>No audit entries yet.</EmptyMessage>
              ) : (
                overview.recentAuditEntries.map((entry) => (
                  <MiniPanel key={entry.id}>
                    <div className="font-medium tracking-tight">{entry.action}</div>
                    {entry.detail && (
                      <div className="mt-1 text-xs text-muted-foreground">{entry.detail}</div>
                    )}
                    <div className="mt-1 text-xs text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleString()}
                    </div>
                  </MiniPanel>
                ))
              )}
            </div>
          </GlassCard>
          )}
        </div>
      )}

      {showCodes && (
      <GlassCard>
        <SectionHeader
          title="Generate Codes"
          description="Create a fresh code batch with a defined duration and expiry."
        />
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <Label>Count</Label>
            <Input
              value={count}
              onChange={(e) => setCount(e.target.value)}
              type="number"
              min="1"
              max="100"
              className="mt-1 rounded-2xl border-black/10 bg-white/95 shadow-sm"
            />
          </div>
          <div>
            <Label>Duration Hours</Label>
            <Input
              value={durationHours}
              onChange={(e) => setDurationHours(e.target.value)}
              type="number"
              className="mt-1 rounded-2xl border-black/10 bg-white/95 shadow-sm"
            />
          </div>
          <div>
            <Label>Expires At</Label>
            <Input
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              type="datetime-local"
              className="mt-1 rounded-2xl border-black/10 bg-white/95 shadow-sm"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={handleGenerate} disabled={submitting} className="rounded-full px-5 shadow-sm">
            {submitting ? "Generating..." : "Generate and Copy"}
          </Button>
        </div>
      </GlassCard>
      )}

      {showCodes && (
      <GlassCard>
        <SectionHeader
          title="Redeem Codes"
          description="Edit durations, control expiry, filter visible rows, and delete in bulk."
          action={
            <div className="flex flex-wrap gap-2">
              {CODE_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  onClick={() => setCodeFilter(filter.id)}
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
                onClick={() => loadAll()}
                disabled={loading || refreshing}
                className="rounded-full border-black/10 bg-white/90 shadow-sm"
              >
                {loading || refreshing ? "Refreshing..." : "Refresh"}
              </Button>
              <Button
                variant="destructive"
                onClick={handleBulkDelete}
                disabled={bulkDeleting || selectedCodeIds.length === 0}
                className="rounded-full shadow-sm"
              >
                {bulkDeleting ? "Deleting..." : `Delete Selected${selectedCodeIds.length ? ` (${selectedCodeIds.length})` : ""}`}
              </Button>
            </div>
          }
        />

        {loading ? (
          <EmptyMessage>Loading...</EmptyMessage>
        ) : (
          <div className="overflow-hidden rounded-[24px] border border-black/5 bg-white/95 shadow-inner">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-slate-50/80 text-left text-muted-foreground">
                  <tr className="border-b border-black/5">
                    <th className="px-4 py-3 font-medium">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAllVisible}
                        className="h-4 w-4"
                      />
                    </th>
                    <th className="px-4 py-3 font-medium">Code</th>
                    <th className="px-4 py-3 font-medium">Duration</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Used By</th>
                    <th className="px-4 py-3 font-medium">Expires</th>
                    <th className="px-4 py-3 font-medium">Created</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCodes.map((row) => {
                    const code = row.redeem_codes;
                    const used = Boolean(code.usedBy);
                    const isEditing = editingCodeId === code.id;
                    return (
                      <tr key={code.id} className="border-b border-black/5 last:border-0">
                        <td className="px-4 py-4">
                          <input
                            type="checkbox"
                            checked={selectedCodeIds.includes(code.id)}
                            disabled={used}
                            onChange={() => toggleCodeSelection(code.id)}
                            className="h-4 w-4"
                          />
                        </td>
                        <td className="px-4 py-4 font-mono text-xs">{code.code}</td>
                        <td className="px-4 py-4">
                          {isEditing ? (
                            <Input
                              value={editingDuration}
                              onChange={(e) => setEditingDuration(e.target.value)}
                              type="number"
                              className="h-9 w-24 rounded-full border-black/10 bg-white/95 shadow-sm"
                            />
                          ) : (
                            `${code.durationHours}h`
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <Badge variant={used ? "secondary" : "default"} className="rounded-full">
                            {used ? "Used" : "Available"}
                          </Badge>
                        </td>
                        <td className="px-4 py-4 text-xs">{row.users?.email || "-"}</td>
                        <td className="px-4 py-4 text-xs">
                          {isEditing ? (
                            <Input
                              value={editingExpiresAt}
                              onChange={(e) => setEditingExpiresAt(e.target.value)}
                              type="datetime-local"
                              className="h-9 min-w-[180px] rounded-full border-black/10 bg-white/95 shadow-sm"
                            />
                          ) : code.expiresAt ? (
                            new Date(code.expiresAt).toLocaleString()
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="px-4 py-4 text-xs">{new Date(code.createdAt).toLocaleString()}</td>
                        <td className="px-4 py-4 text-right">
                          <div className="flex justify-end gap-2">
                            {isEditing ? (
                              <>
                                <Button size="sm" onClick={handleUpdateCode} className="rounded-full">
                                  Save
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setEditingCodeId(null)}
                                  className="rounded-full border-black/10 bg-white/90"
                                >
                                  Cancel
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => startEditCode(row)}
                                  className="rounded-full border-black/10 bg-white/90"
                                >
                                  Edit
                                </Button>
                                {!used && (
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    onClick={() => handleDeleteCode(row)}
                                    className="rounded-full"
                                  >
                                    Delete
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </GlassCard>
      )}
    </div>
  );
}

export default function AdminPage() {
  return <AdminConsole section="overview" />;
}

function getQueueCount(counts: Record<string, number>, key: string) {
  return Number(counts[key] ?? 0);
}

function formatMinutes(value: number) {
  const rounded = Math.trunc(value);
  const sign = rounded < 0 ? "-" : "";
  const absolute = Math.abs(rounded);
  if (absolute >= 1440) {
    const days = Math.floor(absolute / 1440);
    const hours = Math.floor((absolute % 1440) / 60);
    return `${sign}${days}d ${hours}h`;
  }
  if (absolute >= 60) {
    const hours = Math.floor(absolute / 60);
    const minutes = absolute % 60;
    return `${sign}${hours}h ${minutes}m`;
  }
  return `${sign}${absolute}m`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function formatJobTime(job: Pick<ProvisionDebugJob, "finishedOn" | "processedOn" | "timestamp">) {
  const value = job.finishedOn ?? job.processedOn ?? job.timestamp;
  return value ? new Date(value).toLocaleString() : "-";
}

function getStageBadgeVariant(status: ProvisionStageAuditEntry["status"]) {
  if (status === "failed") return "destructive";
  if (status === "ok") return "default";
  return "outline";
}

function formatStageMeta(meta: Record<string, unknown>) {
  const entries = Object.entries(meta || {});
  if (entries.length === 0) {
    return "";
  }
  return entries.map(([key, value]) => `${key}=${String(value)}`).join(", ");
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

function StageLogPanel({
  entry,
  onOpen,
}: {
  entry: ProvisionStageAuditEntry;
  onOpen?: () => void;
}) {
  const meta = formatStageMeta(entry.meta);
  return (
    <MiniPanel>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={getStageBadgeVariant(entry.status)} className="rounded-full">
              {entry.status}
            </Badge>
            <span className="font-mono text-xs font-semibold">{entry.stage}</span>
          </div>
          <div className="mt-2 text-xs font-medium tracking-tight">{entry.message}</div>
          {entry.rentalId && (
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">{entry.rentalId}</div>
          )}
          {meta && <div className="mt-1 break-words text-[11px] text-muted-foreground">{meta}</div>}
          <div className="mt-1 text-[11px] text-muted-foreground">{formatDateTime(entry.createdAt)}</div>
        </div>
        {onOpen && (
          <Button size="sm" variant="outline" onClick={onOpen} className="rounded-full border-black/10 bg-white/90">
            Inspect
          </Button>
        )}
      </div>
    </MiniPanel>
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

function MiniPanel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white/95 p-4 text-sm shadow-sm">
      {children}
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

function AdminStatusScreen({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <Card className="animate-rise space-y-5 p-8 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          AX
        </div>
        <div className="section-eyebrow">{eyebrow}</div>
        <h1 className="text-3xl font-semibold tracking-[-0.045em]">{title}</h1>
        <p className="mx-auto max-w-2xl text-sm leading-7 text-muted-foreground">{body}</p>
      </Card>
    </div>
  );
}
