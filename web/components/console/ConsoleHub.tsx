"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth/store";
import { workerFetch } from "@/lib/api/client";
import { Badge, Button, Card } from "@/components/ui";

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
    profiles?: Array<{ id: string; name: string; mode: string; version: string }>;
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
  address: string;
  expectedAmount: number;
  fiatAmount: number;
  currency: string;
  status: string;
  txHash: string | null;
  createdAt: string | null;
}

type ConsoleData = OverviewData | NodesData | WalletData | AuditData | ReferralsData;

const viewConfig: Record<ConsoleView, { label: string; path: string; title: string }> = {
  overview: { label: "Overview", path: "/api/console/overview", title: "Account Overview" },
  nodes: { label: "Nodes", path: "/api/console/nodes", title: "My Nodes" },
  wallet: { label: "Wallet", path: "/api/console/wallet", title: "Wallet" },
  audit: { label: "Audit", path: "/api/console/audit", title: "Audit" },
  referrals: { label: "Referrals", path: "/api/console/referrals", title: "Referrals" },
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

function shortId(value: string | null | undefined) {
  if (!value) return "-";
  return value.length > 10 ? `${value.slice(0, 8)}...` : value;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (["active", "completed", "paid"].includes(status)) return "default";
  if (["failed", "destroyed", "expired"].includes(status)) return "destructive";
  if (["provisioning", "pending", "paused"].includes(status)) return "secondary";
  return "outline";
}

export function ConsoleHub({ view }: { view: ConsoleView }) {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const email = useAuthStore((s) => s.email);
  const logout = useAuthStore((s) => s.logout);
  const [data, setData] = useState<ConsoleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeConfig = viewConfig[view];

  const load = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await workerFetch(activeConfig.path, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = await res.json();
      if (!res.ok || payload.error) {
        throw new Error(payload.error || "Failed to load console data");
      }
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load console data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) {
      router.push("/");
      return;
    }
    void load();
  }, [token, view]);

  const navItems = useMemo(() => Object.entries(viewConfig) as Array<[ConsoleView, typeof viewConfig[ConsoleView]]>, []);

  if (!token) {
    return null;
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border/40 bg-background/80">
        <div className="container mx-auto flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-3">
          <button onClick={() => router.push("/console")} className="text-left">
            <div className="text-lg font-semibold leading-none">AnixOps Console</div>
            <div className="mt-1 text-xs text-muted-foreground">{email || "Account"}</div>
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push("/")}>Home</Button>
            <Button variant="outline" size="sm" onClick={() => router.push("/payments")}>Payments</Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                logout();
                router.push("/");
              }}
            >
              Logout
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto grid gap-6 px-4 py-6 lg:grid-cols-[220px_1fr]">
        <aside className="space-y-2">
          {navItems.map(([key, item]) => (
            <button
              key={key}
              onClick={() => router.push(key === "overview" ? "/console" : `/console/${key}`)}
              className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                view === key ? "border-primary bg-primary/5 text-primary" : "border-border hover:bg-muted"
              }`}
            >
              {item.label}
            </button>
          ))}
        </aside>

        <section className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{activeConfig.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">Account data is loaded from the self-hosted API.</p>
            </div>
            <Button variant="outline" onClick={load} disabled={loading}>
              {loading ? "Refreshing" : "Refresh"}
            </Button>
          </div>

          {loading && <LoadingState />}
          {error && !loading && <ErrorState message={error} onRetry={load} />}
          {!loading && !error && data && <ConsoleContent view={view} data={data} />}
        </section>
      </div>
    </main>
  );
}

function LoadingState() {
  return (
    <Card className="p-6">
      <div className="h-4 w-40 animate-pulse rounded bg-muted" />
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="h-24 animate-pulse rounded-md bg-muted" />
        <div className="h-24 animate-pulse rounded-md bg-muted" />
        <div className="h-24 animate-pulse rounded-md bg-muted" />
      </div>
    </Card>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="p-6">
      <div className="font-medium text-destructive">Failed to load</div>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      <Button className="mt-4" variant="outline" onClick={onRetry}>Retry</Button>
    </Card>
  );
}

function ConsoleContent({ view, data }: { view: ConsoleView; data: ConsoleData }) {
  if (view === "overview") return <OverviewView data={data as OverviewData} />;
  if (view === "nodes") return <NodesView data={data as NodesData} />;
  if (view === "wallet") return <WalletView data={data as WalletData} />;
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
      <NodeList title="Recent Nodes" nodes={data.recentRentals} empty="No rentals yet." />
      <EntryList title="Recent Payments" entries={data.recentPayments} empty="No payment records yet." />
      <AuditList entries={data.recentAuditEntries} />
    </div>
  );
}

function NodesView({ data }: { data: NodesData }) {
  return <NodeList title="Nodes" nodes={data.nodes} empty="No nodes yet." />;
}

function WalletView({ data }: { data: WalletData }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Balance" value={formatMoney(data.wallet.balance, data.wallet.currency)} />
        <Metric label="Topups" value={String(data.topups.length)} />
        <Metric label="Ledger Entries" value={String(data.ledgerEntries.length)} />
      </div>
      {data.chainMode ? (
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
      <CryptoTopupList topups={data.cryptoTopups || []} />
    </div>
  );
}

function AuditView({ data }: { data: AuditData }) {
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
      {(data.compliance.profiles || []).length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b p-4">
            <div className="font-medium">Compliance Profiles</div>
          </div>
          <div className="divide-y">
            {(data.compliance.profiles || []).map((profile) => (
              <div key={profile.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <div className="font-medium">{profile.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{profile.id} · {profile.version}</div>
                </div>
                <Badge variant="outline">{profile.mode}</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}
      {(data.compliance.rentals || []).length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b p-4">
            <div className="font-medium">Rental Compliance</div>
          </div>
          <div className="divide-y">
            {(data.compliance.rentals || []).map((rental) => (
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
                    {rental.stats?.lastSyncedAt ? `synced ${formatDate(rental.stats.lastSyncedAt)}` : "not synced"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      <AuditList entries={data.auditEntries} />
      {(data.structuredEvents || []).length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b p-4">
            <div className="font-medium">Structured Events</div>
          </div>
          <div className="divide-y">
            {(data.structuredEvents || []).map((event) => (
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

function CryptoTopupList({ topups }: { topups: CryptoTopup[] }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b p-4">
        <div className="font-medium">Crypto Topups</div>
      </div>
      {topups.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">No crypto topups yet.</div>
      ) : (
        <div className="divide-y">
          {topups.map((topup) => (
            <div key={topup.id} className="grid gap-3 p-4 md:grid-cols-[1fr_auto]">
              <div>
                <div className="font-medium">{topup.asset} · {topup.network}</div>
                <div className="mt-1 text-xs text-muted-foreground">{shortId(topup.address)} · {formatDate(topup.createdAt)}</div>
              </div>
              <div className="text-left md:text-right">
                <div className="font-medium">{formatMoney(topup.fiatAmount, topup.currency)}</div>
                <Badge variant={statusVariant(topup.status)}>{topup.status}</Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </Card>
  );
}

function NodeList({ title, nodes, empty }: { title: string; nodes: ConsoleNode[]; empty: string }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b p-4">
        <div className="font-medium">{title}</div>
      </div>
      {nodes.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">{empty}</div>
      ) : (
        <div className="divide-y">
          {nodes.map((node) => (
            <div key={node.id} className="grid gap-3 p-4 md:grid-cols-[1fr_auto]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{node.protocol}</span>
                  <Badge variant={statusVariant(node.status)}>{node.status}</Badge>
                  {node.probeSummary && <Badge variant="outline">Probe: {node.probeSummary.status}</Badge>}
                </div>
                <div className="mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
                  <span>ID: {shortId(node.id)}</span>
                  <span>IP: {node.ip || "pending"}</span>
                  <span>Expires: {formatDate(node.expiresAt)}</span>
                  <span>Remaining: {node.remainingMinutes} min</span>
                </div>
              </div>
              <div className="text-left md:text-right">
                <div className="font-medium">{formatMoney(node.totalPrice)}</div>
                <div className="mt-1 text-xs text-muted-foreground">{node.paymentMethod || "unknown"}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function EntryList({ title, entries, empty }: { title: string; entries: WalletEntry[]; empty: string }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b p-4">
        <div className="font-medium">{title}</div>
      </div>
      {entries.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">{empty}</div>
      ) : (
        <div className="divide-y">
          {entries.map((entry) => (
            <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <div className="font-medium">{entry.type || entry.method || "payment"}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {shortId(entry.rentalId)} - {formatDate(entry.createdAt)}
                </div>
              </div>
              <div className="text-right">
                <div className="font-medium">{formatMoney(entry.amount, entry.currency)}</div>
                <Badge variant={statusVariant(entry.status)}>{entry.status}</Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function AuditList({ entries }: { entries: AuditEntry[] }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b p-4">
        <div className="font-medium">Recent Audit</div>
      </div>
      {entries.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">No audit entries yet.</div>
      ) : (
        <div className="divide-y">
          {entries.map((entry) => (
            <div key={entry.id} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{entry.action}</span>
                <span className="text-xs text-muted-foreground">{formatDate(entry.createdAt)}</span>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {shortId(entry.rentalId)} {entry.detail ? `- ${entry.detail}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
