import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import { complianceProfiles, db } from "./db/index.js";
import {
  filterComplianceProfilesForRelease,
  isFormalRelease,
  STRICT_COMPLIANCE_PROFILE_ID,
} from "./release-profile.js";

export type ComplianceProfilePayload = {
  id: string;
  name: string;
  mode: "standard" | "restricted";
  version: string;
  description: string | null;
  allowedPorts: number[];
  allowedCidrs: string[];
  blockedProtocols: string[];
  isDefault: boolean;
  status: string;
};

let ensureComplianceSchemaPromise: Promise<void> | null = null;

function parseJsonArray<T>(value: string | null | undefined, fallback: T[]) {
  if (!value) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : fallback;
  } catch {
    return fallback;
  }
}

function stringifyArray(value: unknown[]) {
  return JSON.stringify(value);
}

export function normalizeComplianceProfileId(value: unknown) {
  if (value == null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return /^[A-Za-z0-9._:-]{2,80}$/.test(normalized) ? normalized : null;
}

export function formatComplianceProfile(profile: typeof complianceProfiles.$inferSelect): ComplianceProfilePayload {
  return {
    id: profile.id,
    name: profile.name,
    mode: profile.mode === "restricted" ? "restricted" : "standard",
    version: profile.version,
    description: profile.description || null,
    allowedPorts: parseJsonArray<number>(profile.allowedPorts, []),
    allowedCidrs: parseJsonArray<string>(profile.allowedCidrs, []),
    blockedProtocols: parseJsonArray<string>(profile.blockedProtocols, []),
    isDefault: Boolean(profile.isDefault),
    status: profile.status,
  };
}

export function validateProtocolForCompliance(protocol: string, profile: ComplianceProfilePayload) {
  if (profile.status !== "active") {
    return { ok: false as const, error: "Compliance profile is disabled" };
  }
  if (profile.blockedProtocols.includes(protocol)) {
    return {
      ok: false as const,
      error: `${protocol} is disabled by compliance profile ${profile.id}`,
    };
  }
  return { ok: true as const };
}

export function buildCompliancePolicyPayload(profile: ComplianceProfilePayload) {
  return {
    profileId: profile.id,
    version: profile.version,
    mode: profile.mode,
    allowedPorts: profile.allowedPorts,
    allowedCidrs: profile.allowedCidrs,
    blockedProtocols: profile.blockedProtocols,
  };
}

export async function ensureComplianceSchema() {
  if (!ensureComplianceSchemaPromise) {
    ensureComplianceSchemaPromise = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS compliance_profiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          mode TEXT NOT NULL DEFAULT 'standard',
          version TEXT NOT NULL,
          description TEXT,
          allowed_ports TEXT,
          allowed_cidrs TEXT,
          blocked_protocols TEXT,
          is_default BOOLEAN DEFAULT FALSE,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_compliance_profiles_default ON compliance_profiles(is_default)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_compliance_profiles_status ON compliance_profiles(status)`);
      await db.execute(sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS compliance_profile_id TEXT`);
      await db.execute(sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS compliance_policy_version TEXT`);
      await db.execute(sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS compliance_enforced_at TIMESTAMP WITH TIME ZONE`);

      await seedComplianceProfile({
        id: "standard",
        name: "Standard",
        mode: "standard",
        version: "2026-05-07.standard.v1",
        description: "Default profile. Both supported protocols are available.",
        allowedPorts: [],
        allowedCidrs: [],
        blockedProtocols: [],
        isDefault: false,
      });
      await seedComplianceProfile({
        id: "restricted-egress",
        name: "Restricted Egress",
        mode: "restricted",
        version: "2026-05-07.restricted.v1",
        description: "Compliance-oriented profile. Hysteria2 is disabled and policy metadata is sent to provisioning.",
        allowedPorts: [53, 80, 443],
        allowedCidrs: ["0.0.0.0/0"],
        blockedProtocols: ["hysteria2"],
        isDefault: true,
      });
      await db.execute(sql`
        UPDATE compliance_profiles
        SET is_default = FALSE, updated_at = CURRENT_TIMESTAMP
        WHERE id <> ${STRICT_COMPLIANCE_PROFILE_ID}
          AND is_default = TRUE
      `);
      await db.execute(sql`
        UPDATE compliance_profiles
        SET is_default = TRUE, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${STRICT_COMPLIANCE_PROFILE_ID}
      `);
    })();
  }

  return ensureComplianceSchemaPromise;
}

async function seedComplianceProfile(input: Omit<ComplianceProfilePayload, "status">) {
  await db.execute(sql`
    INSERT INTO compliance_profiles (
      id,
      name,
      mode,
      version,
      description,
      allowed_ports,
      allowed_cidrs,
      blocked_protocols,
      is_default,
      status
    )
    VALUES (
      ${input.id},
      ${input.name},
      ${input.mode},
      ${input.version},
      ${input.description},
      ${stringifyArray(input.allowedPorts)},
      ${stringifyArray(input.allowedCidrs)},
      ${stringifyArray(input.blockedProtocols)},
      ${input.isDefault},
      'active'
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      mode = EXCLUDED.mode,
      version = EXCLUDED.version,
      description = EXCLUDED.description,
      allowed_ports = EXCLUDED.allowed_ports,
      allowed_cidrs = EXCLUDED.allowed_cidrs,
      blocked_protocols = EXCLUDED.blocked_protocols,
      is_default = EXCLUDED.is_default,
      status = EXCLUDED.status,
      updated_at = CURRENT_TIMESTAMP
  `);
}

export async function listComplianceProfiles() {
  await ensureComplianceSchema();
  const rows = await db.select().from(complianceProfiles).where(eq(complianceProfiles.status, "active"));
  return filterComplianceProfilesForRelease(rows.map(formatComplianceProfile), isFormalRelease());
}

export async function resolveComplianceProfile(profileId?: unknown) {
  await ensureComplianceSchema();
  const normalized = isFormalRelease()
    ? STRICT_COMPLIANCE_PROFILE_ID
    : normalizeComplianceProfileId(profileId) || STRICT_COMPLIANCE_PROFILE_ID;
  const rows = normalized
    ? await db.select().from(complianceProfiles).where(eq(complianceProfiles.id, normalized)).limit(1)
    : await db.select().from(complianceProfiles).where(eq(complianceProfiles.isDefault, true)).limit(1);

  if (rows.length === 0) {
    return { ok: false as const, status: 404, error: "Compliance profile not found" };
  }

  const profile = formatComplianceProfile(rows[0]);
  if (profile.status !== "active") {
    return { ok: false as const, status: 409, error: "Compliance profile is disabled" };
  }

  return { ok: true as const, profile };
}

export async function createOrUpdateComplianceProfile(input: {
  id?: unknown;
  name?: unknown;
  mode?: unknown;
  version?: unknown;
  description?: unknown;
  allowedPorts?: unknown;
  allowedCidrs?: unknown;
  blockedProtocols?: unknown;
  isDefault?: unknown;
}) {
  await ensureComplianceSchema();
  const id = normalizeComplianceProfileId(input.id) || randomUUID();
  const mode = input.mode === "restricted" ? "restricted" : "standard";
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 80) : id;
  const version = typeof input.version === "string" && input.version.trim()
    ? input.version.trim().slice(0, 80)
    : `${new Date().toISOString().slice(0, 10)}.${id}`;
  const allowedPorts = Array.isArray(input.allowedPorts)
    ? input.allowedPorts.map(Number).filter((port) => Number.isInteger(port) && port > 0 && port <= 65535)
    : [];
  const allowedCidrs = Array.isArray(input.allowedCidrs)
    ? input.allowedCidrs.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 100)
    : [];
  const blockedProtocols = Array.isArray(input.blockedProtocols)
    ? input.blockedProtocols.map(String).filter((protocol) => ["vless-reality", "hysteria2"].includes(protocol))
    : [];
  const isDefault = Boolean(input.isDefault);

  if (isDefault) {
    await db.update(complianceProfiles).set({ isDefault: false, updatedAt: new Date() });
  }

  await db.execute(sql`
    INSERT INTO compliance_profiles (
      id,
      name,
      mode,
      version,
      description,
      allowed_ports,
      allowed_cidrs,
      blocked_protocols,
      is_default,
      status,
      updated_at
    )
    VALUES (
      ${id},
      ${name},
      ${mode},
      ${version},
      ${typeof input.description === "string" ? input.description.slice(0, 500) : null},
      ${stringifyArray(allowedPorts)},
      ${stringifyArray(allowedCidrs)},
      ${stringifyArray(blockedProtocols)},
      ${isDefault},
      'active',
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      mode = EXCLUDED.mode,
      version = EXCLUDED.version,
      description = EXCLUDED.description,
      allowed_ports = EXCLUDED.allowed_ports,
      allowed_cidrs = EXCLUDED.allowed_cidrs,
      blocked_protocols = EXCLUDED.blocked_protocols,
      is_default = EXCLUDED.is_default,
      status = EXCLUDED.status,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `);

  const rows = await db.select().from(complianceProfiles).where(eq(complianceProfiles.id, id)).limit(1);
  return rows[0] ? formatComplianceProfile(rows[0]) : null;
}
