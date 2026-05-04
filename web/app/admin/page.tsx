"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth/store";
import { workerFetch } from "@/lib/api/client";
import { Button, Card, Input, Label, Badge, useToast } from "@/components/ui";

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
}

export default function AdminPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const token = useAuthStore((s) => s.token);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [codes, setCodes] = useState<RedeemCodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [count, setCount] = useState("10");
  const [durationHours, setDurationHours] = useState("24");
  const [expiresAt, setExpiresAt] = useState("");

  const loadCodes = async () => {
    if (!token) return;
    try {
      const res = await workerFetch("/api/admin/redeem-codes", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to load admin data");
      }
      setCodes(data.codes || []);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to load admin data", "error");
    }
  };

  const loadOverview = async () => {
    if (!token) return;
    try {
      const res = await workerFetch("/api/admin/overview", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to load overview");
      }
      setOverview(data);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to load overview", "error");
    }
  };

  const loadAll = async () => {
    setLoading(true);
    await Promise.all([loadOverview(), loadCodes()]);
    setLoading(false);
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
      await loadAll();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to generate redeem codes", "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (!token || !isAdmin) {
    return null;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Admin</h1>
          <p className="text-sm text-muted-foreground">Operations dashboard and redeem code management</p>
        </div>
        <Button variant="outline" onClick={() => router.push("/")}>
          Back
        </Button>
      </div>

      {overview && (
        <div className="grid gap-4 md:grid-cols-3">
          <SummaryCard label="Users" value={String(overview.summary.totalUsers)} />
          <SummaryCard label="Active Rentals" value={String(overview.summary.activeRentals)} />
          <SummaryCard label="Provisioning" value={String(overview.summary.provisioningRentals)} />
          <SummaryCard label="Revenue" value={`$${overview.summary.totalRevenue.toFixed(2)}`} />
          <SummaryCard label="Codes Available" value={String(overview.summary.availableRedeemCodes)} />
          <SummaryCard label="Codes Used" value={String(overview.summary.usedRedeemCodes)} />
        </div>
      )}

      {overview && (
        <div className="grid gap-6 xl:grid-cols-3">
          <Card className="p-6 space-y-4 xl:col-span-1">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Recent Rentals</h2>
              <Badge variant="outline">{overview.recentRentals.length}</Badge>
            </div>
            <div className="space-y-3">
              {overview.recentRentals.map((rental) => (
                <div key={rental.rentalId} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{rental.email || "Unknown user"}</div>
                    <Badge variant={rental.status === "active" ? "default" : "secondary"}>{rental.status}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {rental.protocol} · {rental.durationHours}h · ${rental.totalPrice.toFixed(2)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {new Date(rental.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-6 space-y-4 xl:col-span-1">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Recent Payments</h2>
              <Badge variant="outline">{overview.recentPayments.length}</Badge>
            </div>
            <div className="space-y-3">
              {overview.recentPayments.map((payment) => (
                <div key={payment.paymentId} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{payment.email || "Unknown user"}</div>
                    <Badge variant={payment.status === "completed" ? "default" : "secondary"}>{payment.status}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    ${payment.amount.toFixed(2)} {payment.currency.toUpperCase()} · {payment.method}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {new Date(payment.createdAt).toLocaleString()}
                  </div>
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
              {overview.recentAuditEntries.map((entry) => (
                <div key={entry.id} className="rounded-lg border p-3 text-sm">
                  <div className="font-medium">{entry.action}</div>
                  {entry.detail && (
                    <div className="mt-1 text-xs text-muted-foreground">{entry.detail}</div>
                  )}
                  <div className="mt-1 text-xs text-muted-foreground">
                    {new Date(entry.createdAt).toLocaleString()}
                  </div>
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
          <Button variant="outline" onClick={loadAll} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </Button>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Code</th>
                  <th className="py-2 pr-4 font-medium">Duration</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Used By</th>
                  <th className="py-2 pr-4 font-medium">Expires</th>
                  <th className="py-2 pr-0 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((row) => {
                  const code = row.redeem_codes;
                  const used = Boolean(code.usedBy);
                  return (
                    <tr key={code.id} className="border-b last:border-0">
                      <td className="py-3 pr-4 font-mono text-xs">{code.code}</td>
                      <td className="py-3 pr-4">{code.durationHours}h</td>
                      <td className="py-3 pr-4">
                        <Badge variant={used ? "secondary" : "default"}>
                          {used ? "Used" : "Available"}
                        </Badge>
                      </td>
                      <td className="py-3 pr-4 text-xs">
                        {row.users?.email || "-"}
                      </td>
                      <td className="py-3 pr-4 text-xs">
                        {code.expiresAt ? new Date(code.expiresAt).toLocaleString() : "-"}
                      </td>
                      <td className="py-3 pr-0 text-xs">
                        {new Date(code.createdAt).toLocaleString()}
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
