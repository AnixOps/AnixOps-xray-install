import { sql } from "drizzle-orm";
import { db } from "./db/index.js";

let ensureProbeSchemaPromise: Promise<void> | null = null;

export async function ensureProbeSchema() {
  if (!ensureProbeSchemaPromise) {
    ensureProbeSchemaPromise = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS probe_nodes (
          id TEXT PRIMARY KEY,
          provider TEXT,
          region TEXT,
          province TEXT,
          city TEXT,
          endpoint TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          weight REAL DEFAULT 1,
          version TEXT,
          last_seen_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_probe_nodes_status ON probe_nodes(status)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_probe_nodes_last_seen ON probe_nodes(last_seen_at)`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS probe_runs (
          id TEXT PRIMARY KEY,
          rental_id TEXT,
          attempt_id TEXT,
          ip TEXT NOT NULL,
          port INTEGER NOT NULL,
          protocol TEXT,
          provider TEXT,
          provider_run_id TEXT,
          status TEXT NOT NULL DEFAULT 'running',
          decision TEXT,
          pass_ratio REAL,
          pass_threshold REAL DEFAULT 0.7,
          completed_nodes INTEGER DEFAULT 0,
          required_nodes INTEGER DEFAULT 3,
          detail TEXT,
          completed_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.execute(sql`ALTER TABLE probe_runs ADD COLUMN IF NOT EXISTS provider TEXT`);
      await db.execute(sql`ALTER TABLE probe_runs ADD COLUMN IF NOT EXISTS provider_run_id TEXT`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_probe_runs_rental ON probe_runs(rental_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_probe_runs_status ON probe_runs(status)`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS probe_results (
          id TEXT PRIMARY KEY,
          probe_run_id TEXT NOT NULL,
          probe_node_id TEXT NOT NULL,
          ok BOOLEAN NOT NULL,
          latency_ms INTEGER,
          error_code TEXT,
          raw_detail TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_probe_results_run ON probe_results(probe_run_id)`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_probe_results_run_node ON probe_results(probe_run_id, probe_node_id)`);
    })();
  }

  return ensureProbeSchemaPromise;
}
