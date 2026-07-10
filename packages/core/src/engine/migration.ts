// Database migration system for the Fengru Engine
// Manages versioned schema migrations

interface Migration {
  version: number
  name: string
  up: string
  down?: string
}

export class MigrationRunner {
  private migrations: Migration[] = []
  private currentVersion = 0

  constructor() {
    this.registerMigrations()
  }

  private registerMigrations(): void {
    this.addMigration({
      version: 1,
      name: "create_event_log",
      up: `
        CREATE TABLE IF NOT EXISTS event_log (
          event_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          parent_event_id TEXT,
          event_type TEXT NOT NULL,
          payload TEXT NOT NULL,
          status TEXT CHECK(status IN ('pending','running','success','failed','skipped')),
          token_cost INTEGER DEFAULT 0,
          duration_ms INTEGER DEFAULT 0,
          sequence_index INTEGER NOT NULL,
          timestamp INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_event_session_seq ON event_log(session_id, sequence_index);
        CREATE INDEX IF NOT EXISTS idx_event_parent ON event_log(parent_event_id);
        CREATE INDEX IF NOT EXISTS idx_event_type ON event_log(session_id, event_type, timestamp);
      `,
      down: "DROP TABLE IF EXISTS event_log;",
    })

    this.addMigration({
      version: 2,
      name: "create_checkpoints",
      up: `
        CREATE TABLE IF NOT EXISTS checkpoint (
          checkpoint_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          last_event_id TEXT,
          level TEXT NOT NULL CHECK(level IN ('L1','L2','L3')),
          execution_state TEXT NOT NULL,
          context_hash TEXT NOT NULL,
          git_head_hash TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_cp_session ON checkpoint(session_id, level, created_at);
      `,
      down: "DROP TABLE IF EXISTS checkpoint;",
    })

    this.addMigration({
      version: 3,
      name: "create_capability_graph",
      up: `
        CREATE TABLE IF NOT EXISTS capability_graph (
          capability_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          input_schema TEXT,
          output_schema TEXT,
          tags TEXT,
          risk_level INTEGER CHECK(risk_level BETWEEN 0 AND 3) DEFAULT 0,
          total_calls INTEGER DEFAULT 0,
          success_rate REAL DEFAULT 0.0,
          avg_duration_ms INTEGER DEFAULT 0,
          avg_token_cost INTEGER DEFAULT 0,
          last_used_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_cap_evolution ON capability_graph(total_calls, success_rate);
      `,
      down: "DROP TABLE IF EXISTS capability_graph;",
    })

    this.addMigration({
      version: 4,
      name: "create_memory_tables",
      up: `
        CREATE TABLE IF NOT EXISTS session_memory (
          memory_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          content TEXT NOT NULL,
          token_count INTEGER NOT NULL,
          importance REAL DEFAULT 0.5,
          access_count INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          last_accessed INTEGER,
          retention_score REAL DEFAULT 1.0,
          FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_mem_retention ON session_memory(session_id, retention_score);

        CREATE TABLE IF NOT EXISTS agent_self (
          rule_id TEXT PRIMARY KEY,
          category TEXT NOT NULL,
          content TEXT NOT NULL,
          token_count INTEGER NOT NULL,
          importance REAL DEFAULT 0.8,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        );

        CREATE TABLE IF NOT EXISTS user_profile (
          profile_id TEXT PRIMARY KEY,
          user_hash TEXT NOT NULL,
          category TEXT NOT NULL,
          content TEXT NOT NULL,
          token_count INTEGER NOT NULL,
          importance REAL DEFAULT 0.7,
          frequency_score REAL DEFAULT 0.0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          last_accessed INTEGER
        );
      `,
      down: `
        DROP TABLE IF EXISTS session_memory;
        DROP TABLE IF EXISTS agent_self;
        DROP TABLE IF EXISTS user_profile;
      `,
    })

    this.addMigration({
      version: 5,
      name: "create_repair_memories",
      up: `
        CREATE TABLE IF NOT EXISTS repair_memory (
          repair_id TEXT PRIMARY KEY,
          error_category TEXT NOT NULL,
          exact_hash TEXT NOT NULL,
          fuzzy_hash TEXT NOT NULL,
          error_type TEXT NOT NULL,
          core_symbols TEXT,
          condition TEXT NOT NULL,
          recovery_action TEXT NOT NULL,
          success_rate REAL DEFAULT 0.0,
          hit_count INTEGER DEFAULT 0,
          occurrence_count INTEGER DEFAULT 1,
          specificity INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          last_hit INTEGER,
          retention_score REAL DEFAULT 1.0
        );
        CREATE INDEX IF NOT EXISTS idx_repair_exact ON repair_memory(exact_hash);
        CREATE INDEX IF NOT EXISTS idx_repair_fuzzy ON repair_memory(fuzzy_hash);
        CREATE INDEX IF NOT EXISTS idx_repair_category ON repair_memory(error_category, success_rate);
        CREATE INDEX IF NOT EXISTS idx_repair_fuzzy_lkp ON repair_memory(fuzzy_hash, success_rate);
      `,
      down: "DROP TABLE IF EXISTS repair_memory;",
    })

    this.addMigration({
      version: 6,
      name: "create_skills",
      up: `
        CREATE TABLE IF NOT EXISTS skill (
          skill_id TEXT PRIMARY KEY,
          trigger_condition TEXT NOT NULL,
          prompt_template TEXT NOT NULL,
          priority INTEGER DEFAULT 0,
          scope TEXT CHECK(scope IN ('global','session','task')) DEFAULT 'session',
          hit_count INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        );
      `,
      down: "DROP TABLE IF EXISTS skill;",
    })

    this.addMigration({
      version: 7,
      name: "create_engine_session",
      up: `
        CREATE TABLE IF NOT EXISTS engine_session (
          session_id TEXT PRIMARY KEY,
          title TEXT,
          status TEXT CHECK(status IN ('IDLE','PLANNING','EXECUTING','PAUSED','FAILED','COMPLETED')) DEFAULT 'IDLE',
          workspace_path TEXT,
          current_checkpoint_id TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        );
        CREATE INDEX IF NOT EXISTS idx_es_status ON engine_session(status, updated_at);
      `,
      down: "DROP TABLE IF EXISTS engine_session;",
    })
  }

  private addMigration(migration: Migration): void {
    this.migrations.push(migration)
  }

  getPendingMigrations(): Migration[] {
    return this.migrations
      .filter((m) => m.version > this.currentVersion)
      .sort((a, b) => a.version - b.version)
  }

  getMigration(version: number): Migration | undefined {
    return this.migrations.find((m) => m.version === version)
  }

  getAllMigrations(): Migration[] {
    return [...this.migrations].sort((a, b) => a.version - b.version)
  }

  setCurrentVersion(version: number): void {
    this.currentVersion = version
  }

  getCurrentVersion(): number {
    return this.currentVersion
  }

  getLatestVersion(): number {
    if (this.migrations.length === 0) return 0
    return Math.max(...this.migrations.map((m) => m.version))
  }

  generateMigrationSQL(fromVersion: number, toVersion: number): string {
    const pending = this.migrations
      .filter((m) => m.version > fromVersion && m.version <= toVersion)
      .sort((a, b) => a.version - b.version)
    return pending.map((m) => `-- Migration ${m.version}: ${m.name}\n${m.up}`).join("\n\n")
  }

  generateRollbackSQL(fromVersion: number, toVersion: number): string {
    const toRollback = this.migrations
      .filter((m) => m.version > toVersion && m.version <= fromVersion)
      .sort((a, b) => b.version - a.version)
    return toRollback
      .map((m) => `-- Rollback ${m.version}: ${m.name}\n${m.down ?? "-- No rollback defined"}`)
      .join("\n\n")
  }
}

export const engineMigrations = new MigrationRunner()

export * as Migration from "./migration"
