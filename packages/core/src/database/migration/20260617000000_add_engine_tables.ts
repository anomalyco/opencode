import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260617000000_add_engine_tables",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
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
          timestamp INTEGER NOT NULL,
          CONSTRAINT fk_event_log_session_id_session_id_fk
            FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
        )
      `)
      yield* tx.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_event_session_seq ON event_log(session_id, sequence_index)`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS idx_event_parent ON event_log(parent_event_id)`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS idx_event_type ON event_log(session_id, event_type, timestamp)`)

      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS checkpoint (
          checkpoint_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          last_event_id TEXT,
          level TEXT NOT NULL CHECK(level IN ('L1','L2','L3')),
          execution_state TEXT NOT NULL,
          context_hash TEXT NOT NULL,
          git_head_hash TEXT,
          created_at INTEGER NOT NULL,
          CONSTRAINT fk_checkpoint_session_id_session_id_fk
            FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
        )
      `)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS idx_cp_session ON checkpoint(session_id, level, created_at)`)

      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS capability_graph (
          capability_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          input_schema TEXT,
          output_schema TEXT,
          tags TEXT,
          risk_level INTEGER DEFAULT 0,
          total_calls INTEGER DEFAULT 0,
          success_rate REAL DEFAULT 0,
          avg_duration_ms INTEGER DEFAULT 0,
          avg_token_cost INTEGER DEFAULT 0,
          last_used_at INTEGER
        )
      `)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS idx_cap_evolution ON capability_graph(total_calls, success_rate)`)

      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS session_memory (
          memory_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          content TEXT NOT NULL,
          token_count INTEGER NOT NULL,
          importance REAL DEFAULT 0.5,
          access_count INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          last_accessed INTEGER,
          retention_score REAL DEFAULT 1.0,
          CONSTRAINT fk_session_memory_session_id_session_id_fk
            FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
        )
      `)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS idx_mem_retention ON session_memory(session_id, retention_score)`)

      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS agent_self (
          rule_id TEXT PRIMARY KEY,
          category TEXT NOT NULL,
          content TEXT NOT NULL,
          token_count INTEGER NOT NULL,
          importance REAL DEFAULT 0.8,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `)

      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS user_profile (
          profile_id TEXT PRIMARY KEY,
          user_hash TEXT NOT NULL,
          category TEXT NOT NULL,
          content TEXT NOT NULL,
          token_count INTEGER NOT NULL,
          importance REAL DEFAULT 0.7,
          frequency_score REAL DEFAULT 0.0,
          created_at INTEGER NOT NULL,
          last_accessed INTEGER
        )
      `)

      yield* tx.run(`
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
          specificity INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          last_hit INTEGER,
          retention_score REAL DEFAULT 1.0
        )
      `)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS idx_repair_exact ON repair_memory(exact_hash)`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS idx_repair_fuzzy ON repair_memory(fuzzy_hash)`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS idx_repair_category ON repair_memory(error_category, success_rate)`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS idx_repair_fuzzy_lkp ON repair_memory(fuzzy_hash, success_rate)`)

      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS skill (
          skill_id TEXT PRIMARY KEY,
          trigger_condition TEXT NOT NULL,
          prompt_template TEXT NOT NULL,
          priority INTEGER DEFAULT 0,
          scope TEXT DEFAULT 'session',
          hit_count INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL
        )
      `)

      // Compatible view for TUI integration
      yield* tx.run(`
        CREATE VIEW IF NOT EXISTS compatible_messages AS
        SELECT
          e.event_id AS id,
          e.session_id,
          CASE
            WHEN e.event_type = 'user_input' THEN 'user'
            WHEN e.event_type = 'agent_output' THEN 'assistant'
            WHEN e.event_type = 'tool_call' THEN 'tool'
            WHEN e.event_type = 'tool_result' THEN 'tool_result'
            ELSE 'system'
          END AS role,
          e.payload AS data,
          e.timestamp AS created_at,
          e.sequence_index AS sort_order,
          e.event_type,
          e.status,
          e.token_cost,
          e.duration_ms
        FROM event_log e
        WHERE e.event_type IN (
          'user_input', 'agent_output', 'tool_call', 'tool_result',
          'task_start', 'state_transition'
        )
        ORDER BY e.sequence_index
      `)
    })
  },
} satisfies DatabaseMigration.Migration
