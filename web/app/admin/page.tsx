"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth/store";
import { workerFetch } from "@/lib/api/client";
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

interface AdminOverviewResponse {
  summary: {
    totalUsers: number;
    activeRentals: number;
    provisioningRentals: number;
    totalRevenue: number;
    availableRedeemCodes: number;
    usedRedeemCodes: number;
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
    data: Record<string, unknown>;
    failedReason: string;
    finishedOn?: number;
    stacktrace: string[];
  }>;
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
}

const CODE_TEMPLATES = [
  { label: "1h Trial", durationHours: 1, count: 10 },
  { label: "6h Burst", durationHours: 6, count: 10 },
  { label: "24h Standard", durationHours: 24, count: 20 },
  { label: "72h Promo", durationHours: 72, count: 5 },
];

export default function AdminPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const token = useAuthStore((s) => s.token);
  const isAdmin = useAuthStore((s) => s.isAdmin);

  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [codes, setCodes] = useState<RedeemCodeRow[]>([]);
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);
  const [selectedRental, setSelectedRental] = useState<RentalDetailResponse | null>(null);
  const [selectedRentalId, setSelectedRentalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [searching, setSearching] = useState(false);
  const [destroying, setDestroying] = useState(false);
  const [count, setCount] = useState("10");
  const [durationHours, setDurationHours] = useState("24");
  const [expiresAt, setExpiresAt] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [editingCodeId, setEditingCodeId] = useState<string | null>(null);
  const [editingDuration, setEditingDuration] = useState("");
  const [editingExpiresAt, setEditingExpiresAt] = useState("");
  const [codeFilter, setCodeFilter] = useState<"all" | "available" | "used">("all");
  const [selectedCodeIds, setSelectedCodeIds] = useState<string[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const selectedConfigText = useMemo(() => {
    if (!selectedRental?.config) {
      return "";
    }
    return JSON.stringify(selectedRental.config, null, 2);
  }, [selectedRental]);

  const filteredCodes = useMemo(() => {
    if (codeFilter === "all") {
      return codes;
    }
    return codes.filter((row) => codeFilter === "used" ? Boolean(row.redeem_codes.usedBy) : !row.redeem_codes.usedBy);
  }, [codes, codeFilter]);

  const selectableVisibleCodeIds = useMemo(
    () => filteredCodes.filter((row) => !row.redeem_codes.usedBy).map((row) => row.redeem_codes.id),
    [filteredCodes],
  );

  const allVisibleSelected = selectableVisibleCodeIds.length > 0 && selectableVisibleCodeIds.every((id) => selectedCodeIds.includes(id));

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

  const loadAll = async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    try {
      await Promise.all([loadOverview(), loadCodes()]);
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
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to load rental detail", "error");
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
      loadAll(true);
      if (selectedRentalId) {
        loadRentalDetail(selectedRentalId);
      }
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
  }, [token, isAdmin, selectedRentalId]);

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
      await loadAll(true);
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
      await Promise.all([loadAll(), loadRentalDetail(selectedRentalId)]);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to destroy rental", "error");
    } finally {
      setDestroying(false);
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
        row.redeem_codes.id === updatedCode.id
          ? { ...row, redeem_codes: updatedCode }
          : row,
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
      showToast("Redeem code updated", "success");
      setEditingCodeId(null);
      await loadAll(true);
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
      await loadAll(true);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to delete redeem code", "error");
    }
  };

  const toggleCodeSelection = (id: string) => {
    setSelectedCodeIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
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
      await loadAll(true);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to delete selected redeem codes", "error");
    } finally {
      setBulkDeleting(false);
    }
  };

  if (!token || !isAdmin) {
    return null;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Admin</h1>
          <p className="text-sm text-muted-foreground">Operations dashboard, search, rental control, and redeem codes</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right text-xs text-muted-foreground">
            <div>Auto refresh: 15s</div>
            <div>{lastUpdatedAt ? `Updated ${new Date(lastUpdatedAt).toLocaleTimeString()}` : "Waiting for first sync"}</div>
          </div>
          <Button variant="outline" onClick={() => router.push("/")}>
            Back
          </Button>
        </div>
      </div>

      {overview && (
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
          <SummaryCard label="Users" value={String(overview.summary.totalUsers)} />
          <SummaryCard label="Active Rentals" value={String(overview.summary.activeRentals)} />
          <SummaryCard label="Provisioning" value={String(overview.summary.provisioningRentals)} />
          <SummaryCard label="Revenue" value={`$${overview.summary.totalRevenue.toFixed(2)}`} />
          <SummaryCard label="Codes Available" value={String(overview.summary.availableRedeemCodes)} />
          <SummaryCard label="Codes Used" value={String(overview.summary.usedRedeemCodes)} />
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="p-6 space-y-4 xl:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Search Users / Rentals</h2>
            <Button variant="outline" onClick={handleSearch} disabled={searching}>
              {searching ? "Searching..." : "Search"}
            </Button>
          </div>
          <div className="flex gap-3">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="email, rental id, IP, protocol, status"
            />
          </div>
          {searchResult && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <div className="text-sm font-medium">Users</div>
                {searchResult.users.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No users matched</div>
                ) : searchResult.users.map((user) => (
                  <div key={user.userId} className="rounded-lg border p-3 text-sm">
                    <div className="font-medium">{user.email || "Unknown"}</div>
                    <div className="mt-1 font-mono text-xs text-muted-foreground">{user.userId}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{new Date(user.createdAt).toLocaleString()}</div>
                  </div>
                ))}
              </div>
              <div className="space-y-3">
                <div className="text-sm font-medium">Rentals</div>
                {searchResult.rentals.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No rentals matched</div>
                ) : searchResult.rentals.map((rental) => (
                  <button
                    key={rental.rentalId}
                    onClick={() => loadRentalDetail(rental.rentalId)}
                    className="w-full rounded-lg border p-3 text-left text-sm transition hover:border-primary/50"
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{rental.email || "Unknown user"}</div>
                      <Badge variant={rental.status === "active" ? "default" : "secondary"}>{rental.status}</Badge>
                    </div>
                    <div className="mt-1 font-mono text-xs text-muted-foreground">{rental.rentalId}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{rental.protocol} · {rental.ip || "-"}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Code Templates</h2>
            <Badge variant="outline">{CODE_TEMPLATES.length}</Badge>
          </div>
          <div className="space-y-3">
            {CODE_TEMPLATES.map((template) => (
              <button
                key={template.label}
                onClick={() => {
                  setCount(String(template.count));
                  setDurationHours(String(template.durationHours));
                }}
                className="w-full rounded-lg border p-3 text-left transition hover:border-primary/50"
              >
                <div className="font-medium">{template.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">{template.durationHours}h · default {template.count} codes</div>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="p-6 space-y-4 xl:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Rental Detail</h2>
            {selectedRentalId && (
              <Button variant="destructive" onClick={handleForceDestroy} disabled={destroying}>
                {destroying ? "Destroying..." : "Force Destroy"}
              </Button>
            )}
          </div>
          {!selectedRental ? (
            <div className="text-sm text-muted-foreground">Select a rental from search results or recent rentals.</div>
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
                <DetailItem label="Payment" value={`${selectedRental.rental.paymentMethod || "-"} / ${selectedRental.rental.paymentStatus || "-"}`} />
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">Config Summary</div>
                <Textarea value={selectedConfigText || "No cached config"} readOnly className="min-h-[180px] font-mono text-xs" />
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">Recent Rental Audit</div>
                <div className="space-y-2">
                  {selectedRental.recentAuditEntries.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No audit entries</div>
                  ) : selectedRental.recentAuditEntries.map((entry) => (
                    <div key={entry.id} className="rounded-lg border p-3 text-sm">
                      <div className="font-medium">{entry.action}</div>
                      {entry.detail && <div className="mt-1 text-xs text-muted-foreground">{entry.detail}</div>}
                      <div className="mt-1 text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent Failed Jobs</h2>
            <Badge variant="outline">{overview?.recentFailedJobs.length || 0}</Badge>
          </div>
          <div className="space-y-3">
            {overview?.recentFailedJobs?.length ? overview.recentFailedJobs.map((job) => (
              <div key={String(job.id)} className="rounded-lg border p-3 text-sm">
                <div className="font-medium">{job.name}</div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">{JSON.stringify(job.data)}</div>
                <div className="mt-2 text-xs text-red-600">{job.failedReason}</div>
                {job.stacktrace?.[0] && (
                  <div className="mt-2 text-[11px] text-muted-foreground">{job.stacktrace[0]}</div>
                )}
              </div>
            )) : (
              <div className="text-sm text-muted-foreground">No failed jobs.</div>
            )}
          </div>
        </Card>
      </div>

      {overview && (
        <div className="grid gap-6 xl:grid-cols-3">
          <Card className="p-6 space-y-4 xl:col-span-1">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Recent Rentals</h2>
              <Badge variant="outline">{overview.recentRentals.length}</Badge>
            </div>
            <div className="space-y-3">
              {overview.recentRentals.map((rental) => (
                <button
                  key={rental.rentalId}
                  onClick={() => loadRentalDetail(rental.rentalId)}
                  className="w-full rounded-lg border p-3 text-left text-sm transition hover:border-primary/50"
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{rental.email || "Unknown user"}</div>
                    <Badge variant={rental.status === "active" ? "default" : "secondary"}>{rental.status}</Badge>
                  </div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">{rental.rentalId}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{rental.protocol} · ${rental.totalPrice.toFixed(2)}</div>
                </button>
              ))}
            </div>
          </Card>

          <Card className="p-6 space-y-4 xl:col-span-1">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Recent Payments</h2>
              <Badge variant="outline">{overview.recentPayments.length}</Badge>
            </div>
            <div className="space-y-3">
              {overview.recentPayments.length === 0 ? (
                <div className="text-sm text-muted-foreground">No payments yet.</div>
              ) : overview.recentPayments.map((payment) => (
                <div key={payment.paymentId} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{payment.email || "Unknown user"}</div>
                    <Badge variant={payment.status === "completed" ? "default" : "secondary"}>{payment.status}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    ${payment.amount.toFixed(2)} {payment.currency.toUpperCase()} · {payment.method}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{new Date(payment.createdAt).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-6 space-y-4 xl:col-span-1">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Recent Audit</h2>
              <Badge variant="outline">{overview.recentAuditEntries.length}</Badge>
            </div>
            <div className="space-y-3">
              {overview.recentAuditEntries.length === 0 ? (
                <div className="text-sm text-muted-foreground">No audit entries yet.</div>
              ) : overview.recentAuditEntries.map((entry) => (
                <div key={entry.id} className="rounded-lg border p-3 text-sm">
                  <div className="font-medium">{entry.action}</div>
                  {entry.detail && <div className="mt-1 text-xs text-muted-foreground">{entry.detail}</div>}
                  <div className="mt-1 text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      <Card className="p-6 space-y-4">
        <h2 className="text-lg font-semibold">Generate Codes</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <Label>Count</Label>
            <Input value={count} onChange={(e) => setCount(e.target.value)} type="number" min="1" max="100" className="mt-1" />
          </div>
          <div>
            <Label>Duration Hours</Label>
            <Input value={durationHours} onChange={(e) => setDurationHours(e.target.value)} type="number" className="mt-1" />
          </div>
          <div>
            <Label>Expires At</Label>
            <Input value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} type="datetime-local" className="mt-1" />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={handleGenerate} disabled={submitting}>
            {submitting ? "Generating..." : "Generate and Copy"}
          </Button>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Redeem Codes</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setCodeFilter("all")}
              className={`rounded-md border px-3 py-1 text-xs ${codeFilter === "all" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              All
            </button>
            <button
              onClick={() => setCodeFilter("available")}
              className={`rounded-md border px-3 py-1 text-xs ${codeFilter === "available" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              Available
            </button>
            <button
              onClick={() => setCodeFilter("used")}
              className={`rounded-md border px-3 py-1 text-xs ${codeFilter === "used" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              Used
            </button>
            <Button variant="outline" onClick={() => loadAll()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </Button>
            <Button variant="destructive" onClick={handleBulkDelete} disabled={bulkDeleting || selectedCodeIds.length === 0}>
              {bulkDeleting ? "Deleting..." : `Delete Selected${selectedCodeIds.length ? ` (${selectedCodeIds.length})` : ""}`}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      className="h-4 w-4"
                    />
                  </th>
                  <th className="py-2 pr-4 font-medium">Code</th>
                  <th className="py-2 pr-4 font-medium">Duration</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Used By</th>
                  <th className="py-2 pr-4 font-medium">Expires</th>
                  <th className="py-2 pr-0 font-medium">Created</th>
                  <th className="py-2 pl-4 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCodes.map((row) => {
                  const code = row.redeem_codes;
                  const used = Boolean(code.usedBy);
                  const isEditing = editingCodeId === code.id;
                  return (
                    <tr key={code.id} className="border-b last:border-0">
                      <td className="py-3 pr-4">
                        <input
                          type="checkbox"
                          checked={selectedCodeIds.includes(code.id)}
                          disabled={used}
                          onChange={() => toggleCodeSelection(code.id)}
                          className="h-4 w-4"
                        />
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs">{code.code}</td>
                      <td className="py-3 pr-4">
                        {isEditing ? (
                          <Input value={editingDuration} onChange={(e) => setEditingDuration(e.target.value)} type="number" className="h-8 w-24" />
                        ) : `${code.durationHours}h`}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant={used ? "secondary" : "default"}>
                          {used ? "Used" : "Available"}
                        </Badge>
                      </td>
                      <td className="py-3 pr-4 text-xs">{row.users?.email || "-"}</td>
                      <td className="py-3 pr-4 text-xs">
                        {isEditing ? (
                          <Input value={editingExpiresAt} onChange={(e) => setEditingExpiresAt(e.target.value)} type="datetime-local" className="h-8 min-w-[180px]" />
                        ) : code.expiresAt ? new Date(code.expiresAt).toLocaleString() : "-"}
                      </td>
                      <td className="py-3 pr-0 text-xs">{new Date(code.createdAt).toLocaleString()}</td>
                      <td className="py-3 pl-4 text-right">
                        <div className="flex justify-end gap-2">
                          {isEditing ? (
                            <>
                              <Button size="sm" onClick={handleUpdateCode}>Save</Button>
                              <Button size="sm" variant="outline" onClick={() => setEditingCodeId(null)}>Cancel</Button>
                            </>
                          ) : (
                            <>
                              <Button size="sm" variant="outline" onClick={() => startEditCode(row)}>Edit</Button>
                              {!used && (
                                <Button size="sm" variant="destructive" onClick={() => handleDeleteCode(row)}>Delete</Button>
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
        )}
      </Card>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-5">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </Card>
  );
}

function DetailItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-sm ${mono ? "font-mono break-all" : ""}`}>{value}</div>
    </div>
  );
}
